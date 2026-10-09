// 결과(S5) 지도: 예산안의 정책을 지도 위 위치로 바꾸고, reveal(0 → 개수)이 올라가면서 하나씩 놓는다.
// 응급 거점·버스 증차·DRT는 이동시간을 바꿔 새로 닿는 칸이 파랗게 번지고, 의료인력·안전시설·구조개선은 위치만 찍는다.
// 위치 고르기는 "공백 인구를 가장 많이 줄이는 곳부터"(탐욕)다.
import { PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import { lever, type LeverId, type OptResult, type UnitCost } from '../sim/model'
import { BASE, DRT_KM, diagnoseGrid, travel, weightOf, type AgeId, type Grid, type ModeId, type Supply } from './grid'

const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
export const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const clampN = (x: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(x)))

export interface MapPick {
  k: number
  type: LeverId
  marks: [number, number][]
  label: string
  route?: { path: [number, number][]; timestamps: number[] }
  zone?: [number, number]
  hotspots?: number[] // 구조개선이 바꾼 다발지점 번호
}
export interface PlanMap { picks: MapPick[]; first: Int16Array; base: Float32Array; after: Float32Array; reached: number }

const gapOf = (g: Grid, mode: ModeId, sup: Supply, T: number) => diagnoseGrid(g, travel(g, mode, sup).t, 'all', T).gap

const cache = new WeakMap<OptResult, Map<string, PlanMap>>()
export function planMap(g: Grid, opt: OptResult, c: UnitCost, mode: ModeId, T: number, age: AgeId): PlanMap {
  const key = `${mode}|${T}|${age}|${Object.values(c).join()}`
  let m = cache.get(opt)
  if (!m) cache.set(opt, (m = new Map()))
  const hit = m.get(key)
  if (hit) return hit

  const ll = (vi: number): [number, number] => [g.villages[vi].lon, g.villages[vi].lat]
  const centers = g.villages.filter((v) => v.isCenter && v.id !== g.hospital).map((v) => v.id)
  // 정책은 배분 단계에서 처음 돈이 들어간 순서대로 놓는다
  const order = [...new Set(opt.steps.map((s) => s.lever))]
  const picks: Omit<MapPick, 'k'>[] = []
  const sups: Supply[] = []
  let sup: Supply = BASE
  const push = (p: Omit<MapPick, 'k'>, next: Supply = sup) => { picks.push(p); sup = next; sups.push(sup) }
  const units = (id: LeverId) => opt.alloc[id] / c[id]

  for (const id of order) {
    const n = units(id)
    if (id === 'er') {
      // 응급 거점: 자가용 30분 공백을 가장 많이 줄이는 면 소재지부터
      for (let j = 0; j < clampN(n, 1, 2); j++) {
        const cand = centers.filter((v) => !sup.centers.includes(v))
        if (!cand.length) break
        const best = cand.reduce((a, b) => (gapOf(g, 'car', { ...sup, centers: [...sup.centers, b] }, 30) < gapOf(g, 'car', { ...sup, centers: [...sup.centers, a] }, 30) ? b : a))
        push({ type: id, marks: [ll(best)], label: `응급 거점 · ${g.villages[best].myeon}${n < 0.8 ? ' (부분 지원)' : ''}` }, { ...sup, centers: [...sup.centers, best] })
      }
    } else if (id === 'bus') {
      // 버스 증차: 대중교통 60분 공백이 큰 면부터 군립병원 가는 노선을 늘린다. 운행 횟수는 노선마다 나눠서 올린다
      const mul = (g.region.buses + n) / g.region.buses
      const t = travel(g, 'bus', sup).t
      const need = centers.map((v) => ({ v, w: g.cells.reduce((a, cl, i) => a + (g.villages[cl.village].myeon === g.villages[v].myeon && t[i] > 60 ? cl.pop : 0), 0) })).sort((a, b) => b.w - a.w)
      const k = clampN(n / 4, 1, Math.max(1, centers.length))
      need.slice(0, k).forEach(({ v }, j) => {
        const a = g.villages[g.hospital], b = g.villages[v]
        push({ type: id, marks: [ll(v)], label: j === 0 ? `버스 증차 +${Math.round(n)}대` : '', route: { path: [ll(g.hospital), ll(v)], timestamps: [0, Math.hypot(a.x - b.x, a.y - b.y)] } }, { ...sup, busMul: 1 + ((mul - 1) * (j + 1)) / k })
      })
    } else if (id === 'drt') {
      // DRT 권역: 버스가 하루 3번 이하인 마을 가운데 대중교통 공백을 가장 많이 줄이는 곳
      const cand = g.villages.filter((v) => !v.isCenter && v.busRuns <= 3).sort((a, b) => b.pop - a.pop).slice(0, 24).map((v) => v.id)
      for (let j = 0; j < clampN(n / 2, 1, 6); j++) {
        const left = cand.filter((v) => !sup.drt.includes(v))
        if (!left.length) break
        const best = left.reduce((a, b) => (gapOf(g, 'bus', { ...sup, drt: [...sup.drt, b] }, 60) < gapOf(g, 'bus', { ...sup, drt: [...sup.drt, a] }, 60) ? b : a))
        push({ type: id, marks: [ll(best)], label: j === 0 ? `DRT ${n.toFixed(1)}대` : '', zone: ll(best) }, { ...sup, drt: [...sup.drt, best] })
      }
    } else if (id === 'doc') {
      // 의료인력(순회진료): 군립병원에서 먼 면 소재지부터
      const h = g.villages[g.hospital], dist = (v: number) => Math.hypot(g.villages[v].x - h.x, g.villages[v].y - h.y)
      const far = [...centers].sort((a, b) => dist(b) - dist(a))
      push({ type: id, marks: far.slice(0, clampN(n / 2, 1, far.length)).map(ll), label: `의료인력 ${Math.round(n)}명 (순회)` })
    } else if (id === 'safety') {
      const vs = g.villages.filter((v) => !v.isCenter)
      const k = clampN(n, 1, Math.min(40, vs.length))
      push({ type: id, marks: Array.from({ length: k }, (_, j) => ll(vs[Math.floor((j * vs.length) / k)].id)), label: `안전시설 ${Math.round(n)}개소` })
    } else if (id === 'struct') {
      const k = clampN(n, 1, g.hotspots.length)
      push({ type: id, marks: g.hotspots.slice(0, k).map((h) => h.at), label: `구조개선 ${k}곳`, hotspots: Array.from({ length: k }, (_, j) => j) })
    }
  }

  // 칸마다 처음 기준 안으로 들어오게 한 공급 순번
  const base = travel(g, mode, BASE).t
  const first = new Int16Array(g.cells.length).fill(-1)
  sups.forEach((s, k) => {
    const t = travel(g, mode, s).t
    for (let i = 0; i < t.length; i++) if (first[i] < 0 && base[i] > T && t[i] <= T) first[i] = k
  })
  const after = travel(g, mode, sup).t
  const reached = g.cells.reduce((a, cl, i) => a + (first[i] >= 0 ? weightOf(cl, age) : 0), 0)
  const r: PlanMap = { picks: picks.map((p, k) => ({ ...p, k })), first, base, after, reached }
  m.set(key, r)
  return r
}

export function planLayers({ g, pm, T, reveal, time, labelsBefore, reduce }: { g: Grid; pm: PlanMap; T: number; reveal: number; time: number | null; labelsBefore?: string; reduce: boolean | null }) {
  const shownK = Math.floor(reveal)
  const placed = pm.picks.filter((p) => p.k < Math.ceil(reveal))
  const marks = placed.flatMap((p) => p.marks.map((at) => ({ at, p })))
  const pulse = time == null ? 0.3 : (time % 1600) / 1600
  const fixed = new Set(placed.flatMap((p) => p.hotspots ?? []))
  return [
    new PolygonLayer({
      id: 'plan-grid',
      data: g.cells,
      getPolygon: (c: any) => c.polygon,
      stroked: true,
      getLineColor: [255, 255, 255, 50],
      lineWidthMinPixels: 0.5,
      getFillColor: (c: any) => {
        const empty = c.pop === 0
        if (pm.base[c.i] <= T) return [130, 185, 145, empty ? 40 : 110] // 이미 닿는 칸
        const k = pm.first[c.i]
        if (k >= 0 && k < shownK) return [47, 91, 211, empty ? 50 : 210] // 이 안으로 새로 닿는 칸
        return [215, 48, 39, empty ? 45 : 185] // 여전히 공백
      },
      updateTriggers: { getFillColor: [pm, shownK, T] },
      transitions: reduce ? {} : { getFillColor: { duration: 650, easing: (x: number) => 1 - Math.pow(1 - x, 3) } },
      beforeId: labelsBefore,
    }),
    new ScatterplotLayer({
      id: 'plan-drt-zone',
      data: placed.filter((p) => p.zone),
      getPosition: (p: any) => p.zone,
      getRadius: DRT_KM * 1000,
      radiusUnits: 'meters',
      getFillColor: [...rgb(lever('drt').color), 28],
      getLineColor: [...rgb(lever('drt').color), 210],
      stroked: true,
      lineWidthMinPixels: 2,
      transitions: reduce ? {} : { getRadius: { duration: 900, easing: (x: number) => 1 - Math.pow(1 - x, 3), enter: () => 0 } },
      parameters: ON_TOP,
    }),
    ...placed.filter((p) => p.route).flatMap((p) => {
      const total = p.route!.timestamps[1]
      const currentTime = Math.max(0, Math.min(1, reveal - p.k)) * total
      const base = { data: [p.route], getPath: (x: any) => x.path, getTimestamps: (x: any) => x.timestamps, capRounded: true, jointRounded: true, trailLength: 1e6, fadeTrail: false, currentTime, parameters: ON_TOP }
      return [
        new TripsLayer({ ...base, id: `plan-bus-casing-${p.k}`, getColor: [255, 255, 255], widthMinPixels: 9 }),
        new TripsLayer({ ...base, id: `plan-bus-${p.k}`, getColor: rgb(lever('bus').color), widthMinPixels: 5 }),
      ]
    }),
    // 다발지점: 아직 손대지 않은 곳은 빨간 고리, 구조개선한 곳은 진한 점
    new ScatterplotLayer({
      id: 'plan-hotspots',
      data: g.hotspots.map((h, i) => ({ ...h, i })).filter((h) => !fixed.has(h.i)),
      getPosition: (h: any) => h.at,
      getRadius: 7,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [215, 48, 39, 230],
      lineWidthMinPixels: 2.5,
      parameters: ON_TOP,
      pickable: true,
    }),
    // 응급 거점은 퍼져 나가는 고리로 '여기서부터 30분'을 보여 준다
    new ScatterplotLayer({
      id: 'plan-er-pulse',
      data: marks.filter((x) => x.p.type === 'er'),
      getPosition: (x: any) => x.at,
      getRadius: 10 + pulse * 26,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: [...rgb(lever('er').color), Math.round(230 * (1 - pulse))],
      lineWidthMinPixels: 2,
      updateTriggers: { getLineColor: pulse, getRadius: pulse },
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'plan-marks',
      data: marks,
      getPosition: (x: any) => x.at,
      getRadius: (x: any) => (x.p.type === 'safety' ? 4 : 9),
      radiusUnits: 'pixels',
      getFillColor: (x: any) => rgb(lever(x.p.type).color),
      getLineColor: [255, 255, 255],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (x: any) => (x.p.type === 'safety' ? 1.5 : 3),
      pickable: true,
      transitions: reduce ? {} : { getRadius: { type: 'spring', stiffness: 0.12, damping: 0.25, enter: () => 0 } },
      parameters: ON_TOP,
    }),
    new TextLayer({
      id: 'plan-labels',
      data: placed.filter((p) => p.label),
      getPosition: (p: any) => p.marks[0],
      getText: (p: any) => p.label,
      characterSet: 'auto',
      fontFamily: 'Pretendard Variable, Pretendard, sans-serif',
      fontWeight: 700,
      getSize: 12,
      getColor: [28, 28, 26],
      getPixelOffset: [0, -20],
      background: true,
      getBackgroundColor: [255, 255, 255, 235],
      backgroundPadding: [5, 2],
      parameters: ON_TOP,
    }),
  ]
}

// 이 안이 그리는 범위 (거점·노선·DRT 권역·새로 닿는 칸)
export function planArea(g: Grid, pm: PlanMap): [number, number, number, number] {
  let w = 999, s = 999, e = -999, n = -999
  const add = ([lon, lat]: [number, number]) => { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); n = Math.max(n, lat) }
  pm.picks.forEach((p) => {
    p.marks.forEach(add)
    p.route?.path.forEach(add)
    if (p.zone) { const dLat = DRT_KM / 110.9, dLon = DRT_KM / (111.32 * Math.cos((p.zone[1] * Math.PI) / 180)); add([p.zone[0] - dLon, p.zone[1] - dLat]); add([p.zone[0] + dLon, p.zone[1] + dLat]) }
  })
  g.cells.forEach((c, i) => { if (pm.first[i] >= 0) c.polygon.forEach(add) })
  return w < e ? [w, s, e, n] : g.bbox
}
