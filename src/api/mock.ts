// 가상 데이터 계산 모델. DEMO 시제품(VillageCoverage-시제품.html)의 계산을 옮겼다.
// 읍면 경계만 실제(vuski/admdongkor ver20260701)이고 인구·시설·버스는 모두 가상 값이다.
// ponytail: 이동시간은 직선거리 × 우회계수 근사, 실서비스는 OSRM 이동시간 표로 바꾼다.
import type { AgeId, Cell, County, Diagnosis, ModeId, Route, Service, ServiceId, Village } from './types'

export const SERVICES: Service[] = [
  { id: 'med', name: '의료', full: '병원, 보건지소', icon: '🏥', optimizable: true, T: 30 },
  { id: 'pha', name: '약국', full: '약국', icon: '💊', optimizable: true, T: 30 },
  { id: 'gro', name: '식료품', full: '식료품점', icon: '🛒', optimizable: true, T: 20 },
  { id: 'edu', name: '교육', full: '초등학교', icon: '🏫', optimizable: false, T: 10 },
  { id: 'cul', name: '문화', full: '도서관', icon: '📚', optimizable: false, T: 20 },
  { id: 'adm', name: '행정', full: '읍면사무소', icon: '🏛', optimizable: false, T: 30 },
  { id: 'fin', name: '금융', full: '우체국', icon: '🏤', optimizable: false, T: 30 },
]
export const MODES: { id: ModeId; name: string }[] = [
  { id: 'walk', name: '도보' },
  { id: 'bus', name: '버스' },
  { id: 'car', name: '자가용' },
]
export const AGES: { id: AgeId; name: string }[] = [
  { id: 'all', name: '전체' },
  { id: 'a65', name: '65세 이상' },
  { id: 'a80', name: '80세 이상' },
]
export const COUNTIES: County[] = [
  { sgg: '48740', name: '창녕군', level: 'precise', role: '정밀 데모' },
  { sgg: '48720', name: '의령군', level: 'estimated', role: '정책 연결' },
  { sgg: '48730', name: '함안군', level: 'estimated', role: '데이터가 성긴 군' },
]
export const service = (id: ServiceId) => SERVICES.find((s) => s.id === id)!

const VILLAGE_NAMES = ['샘골', '윗말', '아랫말', '새터', '안골', '갈매', '솔미', '양지말', '음지말', '장터말', '다리목', '배나무골', '감나무골', '밤나무골', '대추골', '절골', '서당골', '큰말', '작은말', '가운뎃말', '동녘말', '서녘말', '남촌', '북촌', '산막', '돌모루', '느티골', '버드내', '소나무골', '구룡', '연화', '송정', '신촌', '내동', '외동', '상촌', '하촌', '중촌', '평지', '두메']

export const WALK_KMH = 3 // 고령자 보행 속도 (가정값)
const CELL_KM = 0.5

type Ring = [number, number][]
// 계산용 내부 좌표(km)와 비율을 더한 마을·칸
export interface V extends Village { x: number; y: number; s65: number; s80: number; g80: number }
export interface C extends Cell { cx: number; cy: number; dv: number; f80: number }
export interface Model {
  county: County
  bbox: [number, number, number, number]
  villages: V[]
  cells: C[]
  fac: Record<ServiceId, { village: number; name: string }[]>
  times: Record<ServiceId, Record<ModeId, { t: Float32Array; near: Int32Array }>>
  toLonLat: (x: number, y: number) => [number, number]
}

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

export function buildModel(county: County, myeonFeatures: MyeonFeature[]): Model {
  const feats = myeonFeatures.filter((f) => f.properties.sgg === county.sgg)
  let west = 999, east = -999, south = 999, north = -999
  feats.forEach((f) => ringsOf(f.geometry).forEach((r) => r.forEach(([lon, lat]) => {
    west = Math.min(west, lon); east = Math.max(east, lon); south = Math.min(south, lat); north = Math.max(north, lat)
  })))
  const KX = 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180), KY = 110.9
  const toKm = ([lon, lat]: [number, number]): [number, number] => [(lon - west) * KX, (north - lat) * KY]
  const toLonLat = (x: number, y: number): [number, number] => [west + x / KX, north - y / KY]
  const myeons = feats.map((f) => ({ name: f.properties.adm_nm.split(' ').pop()!, rings: ringsOf(f.geometry).map((r) => r.map(toKm)) }))
  const W = (east - west) * KX, H = (north - south) * KY
  const R = rng([...county.sgg].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261))

  // 500m 격자: 중심점이 어느 읍면 안에 있는지로 자른다
  const raw: { cx: number; cy: number; gx: number; gy: number; m: number }[] = []
  for (let gy = 0; gy < H; gy += CELL_KM)
    for (let gx = 0; gx < W; gx += CELL_KM) {
      const cx = gx + CELL_KM / 2, cy = gy + CELL_KM / 2
      const m = myeons.findIndex((my) => inside(my.rings, cx, cy))
      if (m >= 0) raw.push({ cx, cy, gx, gy, m })
    }

  // 마을 대표점: 읍면마다 소재지 하나 + 면적에 비례한 마을들 (서로 1.2km 이상 떨어지게)
  const villages: V[] = []
  const mainTown = myeons.findIndex((m) => m.name.endsWith('읍'))
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
        g80: isCenter && isTown ? 1.05 : 0.85 + R() * 0.4, // 10년 뒤 80세 이상 증감 (가상)
      })
    })
  })

  // 칸을 같은 읍면에서 가장 가까운 마을에 배정하고, 마을 인구를 가까운 칸일수록 많이 나눈다
  const cells: C[] = raw.map((c, i) => {
    let v = -1, dv = 1e9
    villages.forEach((vl) => {
      if (vl.myeon !== myeons[c.m].name) return
      const d = Math.hypot(vl.x - c.cx, vl.y - c.cy)
      if (d < dv) { dv = d; v = vl.id }
    })
    const [lon, lat] = toLonLat(c.cx, c.cy)
    const polygon = [toLonLat(c.gx, c.gy), toLonLat(c.gx + CELL_KM, c.gy), toLonLat(c.gx + CELL_KM, c.gy + CELL_KM), toLonLat(c.gx, c.gy + CELL_KM)]
    return { i, polygon, lon, lat, cx: c.cx, cy: c.cy, village: v, dv, myeon: myeons[c.m].name, pop: 0, p65: 0, p80: 0, f80: 0, aiFilled: false }
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
      c.f80 = c.p80 * v.g80
      c.aiFilled = c.pop > 0 && c.pop < 5 // SGIS는 5명 미만 칸을 가린다 → AI가 채운 칸
    })
  })

  // 시설: 소재지(읍면 중심) 위주로 둔다
  const centers = villages.filter((v) => v.isCenter)
  const others = villages.filter((v) => !v.isCenter)
  const pick = <T,>(list: T[], n: number) => {
    const pool = list.slice(), out: T[] = []
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(R() * pool.length), 1)[0])
    return out
  }
  const main = centers.find((v) => v.myeon === myeons[mainTown]?.name) ?? centers[0]
  const rest = centers.filter((v) => v !== main)
  const f = (list: V[], name: (v: V) => string) => list.map((v) => ({ village: v.id, name: name(v) }))
  const fac: Model['fac'] = {
    med: [...f([main], () => '군립병원'), ...f(rest, (v) => `${v.myeon} 보건지소`), ...f(pick(others, 3), (v) => `${v.name.split(' ').pop()} 보건진료소`)],
    pha: f([main, ...pick(rest, Math.ceil(rest.length / 3))], (v) => `${v.myeon} 약국`),
    gro: f([main, ...pick(rest, Math.ceil(rest.length / 2)), ...pick(others, 2)], (v) => `${v.name} 마트`),
    edu: f([main, ...pick(rest, Math.ceil(rest.length / 2))], (v) => `${v.myeon} 초등학교`),
    cul: f([main, ...pick(rest, 1)], (v) => `${v.myeon} 도서관`),
    adm: f(centers, (v) => `${v.myeon}사무소`),
    fin: f([main, ...pick(rest, Math.ceil(rest.length / 2))], (v) => `${v.myeon} 우체국`),
  }

  const model: Model = { county, bbox: [west, south, east, north], villages, cells, fac, times: {} as Model['times'], toLonLat }
  for (const s of SERVICES) {
    model.times[s.id] = {} as Record<ModeId, { t: Float32Array; near: Int32Array }>
    for (const md of MODES) {
      const t = new Float32Array(cells.length), near = new Int32Array(cells.length)
      cells.forEach((c, i) => {
        let best = Infinity, bi = -1
        for (const fc of fac[s.id]) {
          const tt = timeTo(model, c, fc.village, md.id)
          if (tt < best) { best = tt; bi = fc.village }
        }
        t[i] = best
        near[i] = bi
      })
      model.times[s.id][md.id] = { t, near }
    }
  }
  return model
}

// 이동시간 (분)
const tWalk = (km: number) => ((km * 1.3) / WALK_KMH) * 60
export const tCar = (km: number) => ((km * 1.4) / 40) * 60 + 3
// 시간표를 보고 나가므로 평균 대기는 짧게, 하루 3번 이하 노선은 놓치면 오래 기다리는 몫을 더한다
const busWait = (runs: number) => (runs <= 3 ? 25 : runs <= 7 ? 10 : 5)
function busParts(m: Model, c: C, fv: V) {
  const home = m.villages[c.village]
  const walk = Math.max(0, c.dv - 0.3)
  return { home, toStop: tWalk(walk), wait: busWait(home.busRuns), ride: (Math.hypot(fv.x - home.x, fv.y - home.y) * 1.3 * 60) / 40 + 3 }
}
export function timeTo(m: Model, c: C, vi: number, mode: ModeId) {
  const fv = m.villages[vi], d = Math.hypot(fv.x - c.cx, fv.y - c.cy)
  if (mode === 'walk') return tWalk(d)
  if (mode === 'car') return tCar(d)
  const walk = tWalk(d)
  if (!m.villages[c.village].busRuns || c.dv > 1.5) return walk
  const b = busParts(m, c, fv)
  return Math.min(b.toStop + b.wait + b.ride, walk)
}

export const weightOf = (c: Cell, age: AgeId) => (age === 'a80' ? c.p80 : age === 'a65' ? c.p65 : c.pop)

export function diagnose(m: Model, sid: ServiceId, mode: ModeId, age: AgeId, threshold: number): Diagnosis {
  const { t, near } = m.times[sid][mode]
  let total = 0, gap = 0, sumT = 0
  const byV = new Map<number, { w: number; tw: number }>()
  m.cells.forEach((c, i) => {
    const w = weightOf(c, age)
    total += w
    sumT += w * Math.min(t[i], 180)
    if (t[i] > threshold) {
      gap += w
      const e = byV.get(c.village) ?? { w: 0, tw: 0 }
      e.w += w
      e.tw += w * Math.min(t[i], 180)
      byV.set(c.village, e)
    }
  })
  const topVillages = [...byV].map(([village, e]) => ({ village, gap: e.w, minutes: e.tw / e.w })).sort((a, b) => b.gap - a.gap)
  return { service: sid, mode, age, threshold, times: t, nearest: near, total, gap, rate: total ? gap / total : 0, avgMinutes: total ? sumT / total : 0, topVillages }
}

// 칸에서 가장 가까운 시설까지 가는 길 (경로 그리기용). 직선 구간을 이은 근사 경로다.
export function routeFrom(m: Model, cellIdx: number, sid: ServiceId, mode: ModeId): Route {
  const c = m.cells[cellIdx], fvId = m.times[sid][mode].near[cellIdx], fv = m.villages[fvId]
  const facility = m.fac[sid].find((f) => f.village === fvId)?.name ?? fv.name
  const start = m.toLonLat(c.cx, c.cy), end: [number, number] = [fv.lon, fv.lat]
  const total = m.times[sid][mode].t[cellIdx]
  const direct = mode !== 'bus' || !m.villages[c.village].busRuns || c.dv > 1.5 || tWalk(Math.hypot(fv.x - c.cx, fv.y - c.cy)) <= total + 0.01
  if (direct) {
    const label = mode === 'car' ? '자가용' : '걸어서'
    return { path: [start, end], timestamps: [0, total], steps: [{ label: `${label} ${facility}까지`, minutes: total }], total, facility }
  }
  const b = busParts(m, c, fv), stop: [number, number] = [b.home.lon, b.home.lat]
  return {
    path: [start, stop, stop, end],
    timestamps: [0, b.toStop, b.toStop + b.wait, total],
    steps: [
      { label: `${b.home.name} 정류장까지 걷기`, minutes: b.toStop },
      { label: `버스 기다리기 (하루 ${b.home.busRuns}번)`, minutes: b.wait },
      { label: `버스 타고 ${facility}까지`, minutes: b.ride },
    ],
    total,
    facility,
  }
}
