// 500m 격자 지도 모델. VillageCoverage 시제품의 가상 데이터 계산(mock.ts)을 옮겨 응급실 접근만 남기고,
// 예산안의 정책(응급 거점·버스 증차·DRT)이 이동시간을 바꾸도록 공급(Supply)을 넣을 수 있게 했다.
// 읍면 경계만 실제(vuski/admdongkor ver20260701)이고 마을·인구·버스는 모두 가상 값이다.
// ponytail: 이동시간은 직선거리 × 우회계수 근사, 실서비스는 OSRM 이동시간 표로 바꾼다.
import type { Region } from '../data/regions'

export type ModeId = 'car' | 'bus'
export type AgeId = 'all' | 'a65' | 'a80'
export const AGES: { id: AgeId; name: string }[] = [
  { id: 'all', name: '전체' },
  { id: 'a65', name: '65세 이상' },
  { id: 'a80', name: '80세 이상' },
]

const VILLAGE_NAMES = ['샘골', '윗말', '아랫말', '새터', '안골', '갈매', '솔미', '양지말', '음지말', '장터말', '다리목', '배나무골', '감나무골', '밤나무골', '대추골', '절골', '서당골', '큰말', '작은말', '가운뎃말', '동녘말', '서녘말', '남촌', '북촌', '산막', '돌모루', '느티골', '버드내', '소나무골', '구룡', '연화', '송정', '신촌', '내동', '외동', '상촌', '하촌', '중촌', '평지', '두메']
const WALK_KMH = 3 // 고령자 보행 속도 (가정값)
const CELL_KM = 0.5
export const DRT_KM = 6 // DRT 권역 반경

type Ring = [number, number][]
export interface Village { id: number; name: string; myeon: string; lon: number; lat: number; x: number; y: number; pop: number; isCenter: boolean; busRuns: number; s65: number; s80: number }
export interface Cell { i: number; polygon: [number, number][]; lon: number; lat: number; cx: number; cy: number; village: number; dv: number; myeon: string; pop: number; p65: number; p80: number; aiFilled: boolean }
export interface Grid {
  region: Region
  bbox: [number, number, number, number]
  villages: Village[]
  cells: Cell[]
  hospital: number // 응급실이 있는 군립병원 (읍 소재지)
  hotspots: { at: [number, number]; village: number }[] // 교통사고 다발지점 (개수 = 지역 지표)
  toLonLat: (x: number, y: number) => [number, number]
}
// 예산안이 놓는 공급
export interface Supply { centers: number[]; busMul: number; drt: number[] }
export const BASE: Supply = { centers: [], busMul: 1, drt: [] }

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function inside(rings: Ring[], x: number, y: number) {
  let hit = false
  for (const r of rings)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
    }
  return hit
}
type MyeonFeature = { properties: { sgg: string; adm_nm: string }; geometry: { type: string; coordinates: any } }
const ringsOf = (g: MyeonFeature['geometry']): Ring[] => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat(1))

export function buildGrid(region: Region, myeonFeatures: MyeonFeature[]): Grid {
  const feats = myeonFeatures.filter((f) => f.properties.sgg === region.code)
  let west = 999, east = -999, south = 999, north = -999
  feats.forEach((f) => ringsOf(f.geometry).forEach((r) => r.forEach(([lon, lat]) => {
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat)
  })))
  const KX = 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180), KY = 110.9
  const toKm = ([lon, lat]: [number, number]): [number, number] => [(lon - west) * KX, (north - lat) * KY]
  const toLonLat = (x: number, y: number): [number, number] => [west + x / KX, north - y / KY]
  const myeons = feats.map((f) => ({ name: f.properties.adm_nm.split(' ').pop()!, rings: ringsOf(f.geometry).map((r) => r.map(toKm)) }))
  const W = (east - west) * KX, H = (north - south) * KY
  const R = rng([...region.code].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261))

  const raw: { cx: number; cy: number; gx: number; gy: number; m: number }[] = []
  for (let gy = 0; gy < H; gy += CELL_KM)
    for (let gx = 0; gx < W; gx += CELL_KM) {
      const cx = gx + CELL_KM / 2, cy = gy + CELL_KM / 2
      const m = myeons.findIndex((my) => inside(my.rings, cx, cy))
      if (m >= 0) raw.push({ cx, cy, gx, gy, m })
    }

  // 마을 대표점: 읍면마다 소재지 하나 + 면적에 비례한 마을들 (서로 1.2km 이상 떨어지게)
  const villages: Village[] = []
  const mainTown = Math.max(0, myeons.findIndex((m) => m.name.endsWith('읍')))
  myeons.forEach((my, mi) => {
    const mine = raw.filter((c) => c.m === mi)
    if (!mine.length) return
    const mx = mine.reduce((s, c) => s + c.cx, 0) / mine.length, my2 = mine.reduce((s, c) => s + c.cy, 0) / mine.length
    const center = mine.reduce((b, c) => (Math.hypot(c.cx - mx, c.cy - my2) < Math.hypot(b.cx - mx, b.cy - my2) ? c : b))
    const pts = [{ x: center.cx, y: center.cy }]
    const need = Math.max(3, Math.round((mine.length * CELL_KM * CELL_KM) / 6))
    for (let tries = 0; pts.length < need && tries < 4000; tries++) {
      const c = mine[Math.floor(R() * mine.length)]
      const p = { x: c.cx + (R() - 0.5) * 0.3, y: c.cy + (R() - 0.5) * 0.3 }
      if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 1.2)) pts.push(p)
    }
    const isTown = my.name.endsWith('읍')
    pts.forEach((p, k) => {
      const isCenter = k === 0
      const [lon, lat] = toLonLat(p.x, p.y)
      const pop = isCenter
        ? mi === mainTown ? 6000 + Math.round(R() * 3000) : isTown ? 2500 + Math.round(R() * 1500) : 500 + Math.round(R() * 600)
        : 40 + Math.round(R() * 220)
      villages.push({
        id: villages.length, x: p.x, y: p.y, lon, lat, myeon: my.name, isCenter, pop,
        name: isCenter ? `${my.name} 소재지` : `${my.name} ${VILLAGE_NAMES[(villages.length * 7) % VILLAGE_NAMES.length]}`,
        s65: isCenter && isTown ? 0.3 : 0.36 + R() * 0.18,
        s80: isCenter && isTown ? 0.09 : 0.1 + R() * 0.12,
        busRuns: isCenter ? (isTown ? 30 : 8 + Math.floor(R() * 6)) : R() < 0.78 ? 2 + Math.floor(R() * 7) : 0,
      })
    })
  })

  const cells: Cell[] = raw.map((c, i) => {
    let v = -1, dv = 1e9
    villages.forEach((vl) => {
      if (vl.myeon !== myeons[c.m].name) return
      const d = Math.hypot(vl.x - c.cx, vl.y - c.cy)
      if (d < dv) { dv = d; v = vl.id }
    })
    const [lon, lat] = toLonLat(c.cx, c.cy)
    const polygon = [toLonLat(c.gx, c.gy), toLonLat(c.gx + CELL_KM, c.gy), toLonLat(c.gx + CELL_KM, c.gy + CELL_KM), toLonLat(c.gx, c.gy + CELL_KM)]
    return { i, polygon, lon, lat, cx: c.cx, cy: c.cy, village: v, dv, myeon: myeons[c.m].name, pop: 0, p65: 0, p80: 0, aiFilled: false }
  })
  villages.forEach((v) => {
    const mine = cells.filter((c) => c.village === v.id)
    const w = mine.map((c) => Math.exp((-c.dv * c.dv) / 0.5))
    const tot = w.reduce((a, b) => a + b, 0) || 1
    mine.forEach((c, k) => {
      c.pop = (v.pop * w[k]) / tot
      if (c.pop < 0.5) c.pop = 0
      c.p65 = c.pop * v.s65
      c.p80 = c.pop * v.s80
      c.aiFilled = c.pop > 0 && c.pop < 5 // SGIS는 5명 미만 칸을 가린다 → AI가 채운 칸
    })
  })

  const hospital = villages.find((v) => v.isCenter && v.myeon === myeons[mainTown]?.name)?.id ?? 0
  // 다발지점: 군립병원과 면 소재지를 잇는 길 위 아무 데나 (가상 위치, 개수만 실제 지표)
  const centers = villages.filter((v) => v.isCenter && v.id !== hospital)
  const hv = villages[hospital]
  const hotspots = Array.from({ length: region.hotspots }, (_, k) => {
    const to = centers[k % Math.max(1, centers.length)] ?? hv
    const f = 0.3 + R() * 0.5
    return { at: toLonLat(hv.x + (to.x - hv.x) * f + (R() - 0.5) * 0.6, hv.y + (to.y - hv.y) * f + (R() - 0.5) * 0.6), village: to.id }
  })
  return { region, bbox: [west, south, east, north], villages, cells, hospital, hotspots, toLonLat }
}

// ---------- 이동시간 (분) ----------
const tWalk = (km: number) => ((km * 1.3) / WALK_KMH) * 60
const tCar = (km: number) => ((km * 1.4) / 40) * 60 + 3
// 시간표를 보고 나가므로 평균 대기는 짧게, 하루 3번 이하 노선은 놓치면 오래 기다리는 몫을 더한다
const busWait = (runs: number) => (runs <= 3 ? 25 : runs <= 7 ? 10 : 5)
const DRT_WAIT = 12 // 호출 후 기다림
const inDrt = (g: Grid, c: Cell, sup: Supply) => sup.drt.some((vi) => Math.hypot(g.villages[vi].x - c.cx, g.villages[vi].y - c.cy) <= DRT_KM)

function busParts(g: Grid, c: Cell, fv: Village, sup: Supply) {
  const home = g.villages[c.village]
  return { home, toStop: tWalk(Math.max(0, c.dv - 0.3)), wait: busWait(home.busRuns * sup.busMul), ride: (Math.hypot(fv.x - home.x, fv.y - home.y) * 1.3 * 60) / 40 + 3 }
}
function timeTo(g: Grid, c: Cell, vi: number, mode: ModeId, sup: Supply) {
  const fv = g.villages[vi], d = Math.hypot(fv.x - c.cx, fv.y - c.cy)
  if (mode === 'car') return tCar(d)
  let best = tWalk(d)
  if (g.villages[c.village].busRuns && c.dv <= 1.5) {
    const b = busParts(g, c, fv, sup)
    best = Math.min(best, b.toStop + b.wait + b.ride)
  }
  if (inDrt(g, c, sup)) best = Math.min(best, DRT_WAIT + tCar(d) * 1.15)
  return best
}

const cache = new WeakMap<Grid, Map<string, { t: Float32Array; near: Int32Array }>>()
export function travel(g: Grid, mode: ModeId, sup: Supply = BASE) {
  const key = `${mode}|${sup.centers.join()}|${sup.busMul.toFixed(3)}|${sup.drt.join()}`
  let m = cache.get(g)
  if (!m) cache.set(g, (m = new Map()))
  const hit = m.get(key)
  if (hit) return hit
  const fac = [g.hospital, ...sup.centers]
  const t = new Float32Array(g.cells.length), near = new Int32Array(g.cells.length)
  g.cells.forEach((c, i) => {
    let best = Infinity, bi = -1
    for (const vi of fac) {
      const tt = timeTo(g, c, vi, mode, sup)
      if (tt < best) { best = tt; bi = vi }
    }
    t[i] = best
    near[i] = bi
  })
  const r = { t, near }
  m.set(key, r)
  return r
}

export const weightOf = (c: Cell, age: AgeId) => (age === 'a80' ? c.p80 : age === 'a65' ? c.p65 : c.pop)

export function diagnoseGrid(g: Grid, t: Float32Array, age: AgeId, T: number) {
  let total = 0, gap = 0, sumT = 0
  const byV = new Map<number, { w: number; tw: number }>()
  g.cells.forEach((c, i) => {
    const w = weightOf(c, age)
    total += w
    sumT += w * Math.min(t[i], 180)
    if (t[i] > T) {
      gap += w
      const e = byV.get(c.village) ?? { w: 0, tw: 0 }
      e.w += w
      e.tw += w * Math.min(t[i], 180)
      byV.set(c.village, e)
    }
  })
  const topVillages = [...byV].map(([village, e]) => ({ village, gap: e.w, minutes: e.tw / e.w })).sort((a, b) => b.gap - a.gap)
  return { total, gap, rate: total ? gap / total : 0, avgMinutes: total ? sumT / total : 0, topVillages }
}

export interface Route { path: [number, number][]; timestamps: number[]; steps: { label: string; minutes: number }[]; total: number; facility: string }
export const facilityName = (g: Grid, vi: number) => (vi === g.hospital ? '군립병원 응급실' : `${g.villages[vi].myeon} 응급 거점`)

// 칸에서 가장 가까운 응급실까지 가는 길 (경로 그리기용). 직선 구간을 이은 근사 경로다.
export function routeFrom(g: Grid, cellIdx: number, mode: ModeId, sup: Supply = BASE): Route {
  const c = g.cells[cellIdx], tr = travel(g, mode, sup), fvId = tr.near[cellIdx], fv = g.villages[fvId]
  const facility = facilityName(g, fvId)
  const start = g.toLonLat(c.cx, c.cy), end: [number, number] = [fv.lon, fv.lat]
  const total = tr.t[cellIdx]
  const d = Math.hypot(fv.x - c.cx, fv.y - c.cy)
  if (mode === 'car') return { path: [start, end], timestamps: [0, total], steps: [{ label: `자가용으로 ${facility}까지`, minutes: total }], total, facility }
  if (inDrt(g, c, sup) && Math.abs(DRT_WAIT + tCar(d) * 1.15 - total) < 0.01)
    return { path: [start, start, end], timestamps: [0, DRT_WAIT, total], steps: [{ label: 'DRT 호출하고 기다리기', minutes: DRT_WAIT }, { label: `DRT 타고 ${facility}까지`, minutes: total - DRT_WAIT }], total, facility }
  const b = g.villages[c.village].busRuns && c.dv <= 1.5 ? busParts(g, c, fv, sup) : null
  if (!b || tWalk(d) <= total + 0.01) return { path: [start, end], timestamps: [0, total], steps: [{ label: `걸어서 ${facility}까지`, minutes: total }], total, facility }
  const stop: [number, number] = [b.home.lon, b.home.lat]
  return {
    path: [start, stop, stop, end],
    timestamps: [0, b.toStop, b.toStop + b.wait, total],
    steps: [
      { label: `${b.home.name} 정류장까지 걷기`, minutes: b.toStop },
      { label: `버스 기다리기 (하루 ${Math.round(b.home.busRuns * sup.busMul)}번)`, minutes: b.wait },
      { label: `버스 타고 ${facility}까지`, minutes: b.ride },
    ],
    total,
    facility,
  }
}

// 지도 데이터는 한 번만 불러오고 군마다 한 번만 만든다
let myeonCache: Promise<any> | null = null
export const loadMyeon = () => (myeonCache ??= fetch('/data/myeon.geojson').then((r) => r.json()))
const grids = new Map<string, Grid>()
export async function loadGrid(region: Region) {
  let g = grids.get(region.code)
  if (!g) {
    const geo = await loadMyeon()
    g = buildGrid(region, geo.features)
    grids.set(region.code, g)
  }
  return g
}
