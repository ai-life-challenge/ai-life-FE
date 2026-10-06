// 대안 화면의 지도 레이어. reveal(0 → 공급 개수)이 올라가면서 공급이 하나씩 놓이고,
// 그 공급이 새로 닿게 하는 칸이 파랗게 번진다. 순회 버스는 경로가 그려지고, 수요응답형은 권역 원이 퍼진다.
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import type { Model } from '../api/mock'
import { SUPPLY, type Pick, type Plan } from '../api/plans'
import { SUPPLY_COLOR } from './colors'

const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const

interface Derived {
  first: Int16Array // 칸마다 처음 닿게 해 준 공급 순번 (-1 = 안에 안 듦)
  tours: { path: [number, number][]; timestamps: number[]; k: number }[]
  drt: { at: [number, number]; k: number }[]
  marks: { at: [number, number]; k: number; pick: Pick }[]
}
const cache = new WeakMap<Plan, Derived>()
function derive(m: Model, p: Plan): Derived {
  const hit = cache.get(p)
  if (hit) return hit
  const first = new Int16Array(m.cells.length).fill(-1)
  const best = new Float32Array(p.baseCov)
  p.picks.forEach((pk, k) => pk.cells.forEach((i) => { if (pk.factor > best[i]) { best[i] = pk.factor; if (first[i] < 0) first[i] = k } }))
  const ll = (vi: number): [number, number] => [m.villages[vi].lon, m.villages[vi].lat]
  const tours = p.picks.flatMap((pk, k) => {
    if (pk.type !== 'tour' || !pk.stops) return []
    const ids = [pk.village, ...pk.stops, pk.village]
    const timestamps = [0]
    for (let i = 1; i < ids.length; i++) {
      const a = m.villages[ids[i - 1]], b = m.villages[ids[i]]
      timestamps.push(timestamps[i - 1] + Math.hypot(a.x - b.x, a.y - b.y))
    }
    return [{ path: ids.map(ll), timestamps, k }]
  })
  const drt = p.picks.flatMap((pk, k) => (pk.type === 'drt' ? [{ at: ll(pk.village), k }] : []))
  // 순회는 정차 마을마다 점을 찍는다
  const marks = p.picks.flatMap((pk, k) => (pk.type === 'tour' && pk.stops ? pk.stops.map((s) => ({ at: ll(s), k, pick: pk })) : [{ at: ll(pk.village), k, pick: pk }]))
  const d = { first, tours, drt, marks }
  cache.set(p, d)
  return d
}

export function planLayers({ m, plan, reveal, time, labelsBefore, reduce }: { m: Model; plan: Plan; reveal: number; time: number | null; labelsBefore?: string; reduce: boolean | null }) {
  const d = derive(m, plan)
  const shownK = Math.floor(reveal) // 이만큼의 공급이 놓였다
  const marks = d.marks.filter((x) => x.k < Math.ceil(reveal))
  // 놓는 동안은 고리가 퍼져 나가고, 다 놓으면 옅은 고리로 멈춘다
  const pulse = time == null ? 0.3 : (time % 1600) / 1600
  return [
    new PolygonLayer({
      id: 'plan-grid',
      data: m.cells,
      getPolygon: (c: any) => c.polygon,
      stroked: true,
      getLineColor: [255, 255, 255, 50],
      lineWidthMinPixels: 0.5,
      getFillColor: (c: any) => {
        const empty = c.pop === 0
        if (plan.baseCov[c.i] >= 1) return [130, 185, 145, empty ? 40 : 110] // 이미 닿는 칸
        const k = d.first[c.i]
        if (k >= 0 && k < shownK) {
          const f = plan.picks[k].factor
          return [47, 91, 211, empty ? 50 : Math.round(110 + 120 * f)] // 이 안으로 새로 닿는 칸 (원격처럼 일부만 닿으면 옅게)
        }
        return [215, 48, 39, empty ? 45 : 185] // 여전히 공백
      },
      updateTriggers: { getFillColor: [plan, shownK] },
      transitions: reduce ? {} : { getFillColor: { duration: 650, easing: (x: number) => 1 - Math.pow(1 - x, 3) } },
      beforeId: labelsBefore,
    }),
    new ScatterplotLayer({
      id: 'plan-drt-zone',
      data: d.drt.filter((x) => x.k < Math.ceil(reveal)),
      getPosition: (x: any) => x.at,
      getRadius: 9000,
      radiusUnits: 'meters',
      getFillColor: [...SUPPLY_COLOR.drt, 28],
      getLineColor: [...SUPPLY_COLOR.drt, 200],
      stroked: true,
      lineWidthMinPixels: 2,
      transitions: reduce ? {} : { getRadius: { duration: 900, easing: (x: number) => 1 - Math.pow(1 - x, 3), enter: () => 0 } },
      parameters: ON_TOP,
    }),
    ...d.tours.flatMap((t, ti) => {
      const total = t.timestamps[t.timestamps.length - 1]
      const currentTime = Math.max(0, Math.min(1, reveal - t.k)) * total
      return [
        new TripsLayer({ id: `plan-tour-casing-${ti}`, data: [t], getPath: (x: any) => x.path, getTimestamps: (x: any) => x.timestamps, getColor: [255, 255, 255], widthMinPixels: 9, capRounded: true, jointRounded: true, trailLength: 1e6, fadeTrail: false, currentTime, parameters: ON_TOP }),
        new TripsLayer({ id: `plan-tour-${ti}`, data: [t], getPath: (x: any) => x.path, getTimestamps: (x: any) => x.timestamps, getColor: [...SUPPLY_COLOR.tour], widthMinPixels: 5, capRounded: true, jointRounded: true, trailLength: 1e6, fadeTrail: false, currentTime, parameters: ON_TOP }),
      ]
    }),
    // 원격 거점은 퍼져 나가는 고리로 '멀리서도 닿는다'를 보여 준다
    new ScatterplotLayer({
      id: 'plan-tele-pulse',
      data: marks.filter((x) => x.pick.type === 'tele'),
      getPosition: (x: any) => x.at,
      getRadius: 9 + pulse * 22,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [...SUPPLY_COLOR.tele, Math.round(220 * (1 - pulse))],
      lineWidthMinPixels: 2,
      updateTriggers: { getLineColor: pulse },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'plan-marks',
      data: marks,
      getPosition: (x: any) => x.at,
      getRadius: 9,
      radiusUnits: 'pixels',
      getFillColor: (x: any) => [...SUPPLY_COLOR[x.pick.type as Pick['type']]],
      getLineColor: [255, 255, 255],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: 3,
      pickable: true,
      transitions: reduce ? {} : { getRadius: { type: 'spring', stiffness: 0.12, damping: 0.25, enter: () => 0 } },
      parameters: ON_TOP,
    }),
    new TextLayer({
      id: 'plan-labels',
      data: marks.filter((x, i, arr) => arr.findIndex((y) => y.k === x.k) === i), // 순회는 첫 정차에만 이름
      getPosition: (x: any) => x.at,
      getText: (x: any) => SUPPLY.find((s) => s.id === x.pick.type)!.short,
      characterSet: 'auto',
      fontFamily: 'Pretendard Variable, Pretendard, sans-serif',
      fontWeight: 700,
      getSize: 12,
      getColor: [28, 28, 26],
      getPixelOffset: [0, -20],
      background: true,
      getBackgroundColor: [255, 255, 255, 230],
      backgroundPadding: [5, 2],
      parameters: ON_TOP,
    }),
  ]
}

// 이 안이 지도에 그리는 모든 것(공급 위치, 순회 정차, 수요응답형 권역 원, 새로 닿는 칸)을 감싸는 범위
export function planArea(m: Model, p: Plan): [number, number, number, number] | null {
  let w = 999, s = 999, e = -999, n = -999
  const add = (lon: number, lat: number) => { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat) }
  for (const pk of p.picks) {
    for (const vi of pk.stops ? [pk.village, ...pk.stops] : [pk.village]) add(m.villages[vi].lon, m.villages[vi].lat)
    if (pk.type === 'drt') {
      const v = m.villages[pk.village], dLat = 9 / 110.9, dLon = 9 / (111.32 * Math.cos((v.lat * Math.PI) / 180))
      add(v.lon - dLon, v.lat - dLat)
      add(v.lon + dLon, v.lat + dLat)
    }
  }
  m.cells.forEach((c, i) => { if (p.cov[i] > p.baseCov[i]) c.polygon.forEach(([lon, lat]) => add(lon, lat)) })
  return w < e ? [w, s, e, n] : null
}
