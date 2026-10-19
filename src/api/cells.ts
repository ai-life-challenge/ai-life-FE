// 마을을 칸(격자)으로 묶어서 보여 주기 위한 집계. 서버에는 칸 단위 자료가 없어서, 마을 좌표와 인구를 칸 안에서 합친 것이다.
// (실제 500m 격자나 이동시간이 아니라 '마을 집계'다.) 랜딩 그림처럼 한눈에 보여 주는 용도로만 쓴다.

export interface CellGrid {
  W: number; H: number // 칸 단위 크기
  pts: { x: number; y: number }[] // 마을마다 칸 좌표계의 위치 (0~W, 0~H)
  cells: { ix: number; iy: number; members: number[] }[] // 마을이 있거나 군 경계 안에 있는 칸. members가 비면 마을이 없는 칸
}

type Ring = [number, number][]
// 군 경계(읍면 폴리곤)에서 바깥 고리들만 꺼낸다
function ringsOf(fc: GeoJSON.FeatureCollection): Ring[] {
  return fc.features.flatMap((f) => {
    const g = f.geometry
    if (g.type === 'Polygon') return [g.coordinates[0] as Ring]
    if (g.type === 'MultiPolygon') return g.coordinates.map((p) => p[0] as Ring)
    return []
  })
}
const inRing = (x: number, y: number, r: Ring) => {
  let ins = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) ins = !ins
  }
  return ins
}

// 가장 긴 변이 cols칸이 되게 나눈다. 위도에 따라 줄어드는 경도 간격은 cos로 보정한다.
// 군 경계(outline)를 주면 그 안의 칸은 마을이 없어도 빈 칸으로 넣어서 군 모양이 이어지게 한다
export function gridOf(villages: { lon: number; lat: number }[], cols = 16, outline?: GeoJSON.FeatureCollection): CellGrid {
  const lat0 = villages.reduce((a, v) => a + v.lat, 0) / villages.length
  const k = Math.cos((lat0 * Math.PI) / 180)
  const rings = (outline ? ringsOf(outline) : []).map((r) => r.map(([lon, lat]) => [lon * k, -lat] as [number, number]))
  const xs = [...villages.map((v) => v.lon * k), ...rings.flat().map((p) => p[0])], ys = [...villages.map((v) => -v.lat), ...rings.flat().map((p) => p[1])]
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)]
  const S = cols / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0 || 1)
  const pts = villages.map((v) => ({ x: (v.lon * k - x0) * S, y: (-v.lat - y0) * S }))
  const W = Math.max(1, Math.ceil((Math.max(...xs) - x0) * S)), H = Math.max(1, Math.ceil((Math.max(...ys) - y0) * S))
  const by = new Map<string, CellGrid['cells'][number]>()
  const at = (ix: number, iy: number) => {
    const key = `${ix},${iy}`
    let c = by.get(key)
    if (!c) by.set(key, (c = { ix, iy, members: [] }))
    return c
  }
  pts.forEach((p, i) => at(Math.min(W - 1, Math.floor(p.x)), Math.min(H - 1, Math.floor(p.y))).members.push(i))
  if (rings.length) {
    const sr = rings.map((r) => r.map(([x, y]) => [(x - x0) * S, (y - y0) * S] as [number, number]))
    for (let iy = 0; iy < H; iy++) for (let ix = 0; ix < W; ix++) if (sr.some((r) => inRing(ix + 0.5, iy + 0.5, r))) at(ix, iy)
  }
  return { W, H, pts, cells: [...by.values()] }
}

// 칸 안에서 닿지 못하는 사람의 비율 (people·gap은 마을 번호 순서). 사는 사람이 없으면 null
export function cellRate(members: number[], people: number[], gap: number[]) {
  const total = members.reduce((a, i) => a + people[i], 0)
  return total > 0 ? members.reduce((a, i) => a + gap[i], 0) / total : null
}

// 비율 → 색: 0 초록 → 0.3 노랑 → 0.6 이상 빨강 (군 전체 평균이 낮아도 공백이 보이게 60%를 끝으로 잡는다)
const STOPS: [number, [number, number, number]][] = [[0, [47, 163, 107]], [0.3, [254, 224, 139]], [0.6, [214, 69, 93]]]
export function rateColor(r: number | null): string {
  if (r == null) return '#e7e4dc'
  for (let i = 1; i < STOPS.length; i++) {
    const [r1, c1] = STOPS[i]
    if (r <= r1 || i === STOPS.length - 1) {
      const [r0, c0] = STOPS[i - 1], t = Math.min(1, Math.max(0, (r - r0) / (r1 - r0)))
      return `rgb(${c0.map((v, j) => Math.round(v + (c1[j] - v) * t)).join(',')})`
    }
  }
  return '#e7e4dc'
}

// 병원까지 걸리는 시간 격자(레퍼런스 지도 방식): 군 경계 안을 정사각형 칸으로 나누고, 칸 가운데에서 가장 가까운 병원급 시설까지의 자가용 시간을 어림한다.
// 서버에 칸 단위 이동시간이 없어서 직선거리 × (1km당 분)으로 어림한다. 1km당 분은 지역마다 서버의 마을별 도로 기준 시간에 맞춰 보정한다(minutesPerKm). cols는 긴 변의 칸 수
// village: 가장 가까운 마을 번호. lived: 마을이 LIVED_KM 안에 있으면 사람이 사는 칸으로 본다(칸 단위 인구가 없어 마을 좌표로 어림). 레퍼런스처럼 안 사는 칸은 옅게 칠한다
export interface TimeCell { polygon: [number, number][]; minutes: number; village: number; people: number; lived: boolean }
// 보정할 자료가 없을 때 쓰는 값: 직선거리 × 1.3(도로 우회) ÷ 시속 40km = 1km당 1.95분
export const DEFAULT_MIN_PER_KM = (1.3 / 40) * 60
const LIVED_KM = 1.2
export const km = (lon1: number, lat1: number, lon2: number, lat2: number) => {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(a))
}
// 병원급 시설(병원·종합병원·보건의료원). 군에 하나도 없으면 모든 시설로 잰다
export const hospitalsOf = <F extends { kind: string }>(fs: F[]) => { const h = fs.filter((f) => /병원|종합|보건의료원/.test(f.kind)); return h.length ? h : fs }
// 한 지점에서 가장 가까운 병원까지 자가용 추정 시간(분)
export const hospitalMinutes = (lon: number, lat: number, hospitals: { lon: number; lat: number }[], perKm = DEFAULT_MIN_PER_KM) =>
  Math.min(...hospitals.map((h) => km(lon, lat, h.lon, h.lat))) * perKm

// 지역 보정값(1km당 분): 마을마다 '서버의 가장 가까운 병의원까지 도로 기준 시간 ÷ 가장 가까운 시설까지 직선거리'를 구해 중앙값을 쓴다.
// 마을 안에 시설이 있거나 직선 500m 안인 마을은 거리 오차가 커서 뺀다. 쓸 마을이 10곳 미만이면 기본값
export function minutesPerKm(villages: { lon: number; lat: number; nearest: { med: { minutes: number } | null } }[], facilities: { lon: number; lat: number }[]) {
  if (!facilities.length) return DEFAULT_MIN_PER_KM
  const ratios = villages.flatMap((v) => {
    if (!v.nearest.med) return []
    const d = Math.min(...facilities.map((f) => km(v.lon, v.lat, f.lon, f.lat)))
    return d >= 0.5 ? [v.nearest.med.minutes / d] : []
  }).sort((a, b) => a - b)
  return ratios.length >= 10 ? ratios[Math.floor(ratios.length / 2)] : DEFAULT_MIN_PER_KM
}

export function timeGrid(villages: { lon: number; lat: number; people: number }[], hospitals: { lon: number; lat: number }[], outline: GeoJSON.FeatureCollection, cols = 60, perKm = DEFAULT_MIN_PER_KM): TimeCell[] {
  const rings = ringsOf(outline)
  if (!rings.length || !hospitals.length) return []
  const pts = rings.flat()
  const [lon0, lon1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))]
  const [lat0, lat1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))]
  const cos = Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180)
  const dLat = Math.max((lon1 - lon0) * cos, lat1 - lat0) / cols, dLon = dLat / cos
  const out: TimeCell[] = []
  for (let lat = lat0; lat < lat1; lat += dLat) {
    for (let lon = lon0; lon < lon1; lon += dLon) {
      const cx = lon + dLon / 2, cy = lat + dLat / 2
      if (!rings.some((r) => inRing(cx, cy, r))) continue
      let village = -1, bd = Infinity, people = 0
      villages.forEach((v, i) => {
        const dv = km(cx, cy, v.lon, v.lat)
        if (dv < bd) { bd = dv; village = i }
        if (v.lon >= lon && v.lon < lon + dLon && v.lat >= lat && v.lat < lat + dLat) people += v.people
      })
      out.push({ polygon: [[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat]], minutes: hospitalMinutes(cx, cy, hospitals, perKm), village, people, lived: bd <= LIVED_KM })
    }
  }
  return out
}

// 분 → 색: 5분 이하 진초록 → 10분 연두 → 15분 노랑 → 25분 이상 주황 (모든 군에 같은 기준이라 지역끼리 비교된다)
export const MINUTE_STOPS: [number, [number, number, number]][] = [[5, [86, 172, 100]], [10, [158, 207, 112]], [15, [246, 214, 120]], [25, [242, 138, 78]]]
export function minuteRgb(m: number): [number, number, number] {
  if (m <= MINUTE_STOPS[0][0]) return MINUTE_STOPS[0][1]
  for (let i = 1; i < MINUTE_STOPS.length; i++) {
    const [m1, c1] = MINUTE_STOPS[i]
    if (m <= m1) {
      const [m0, c0] = MINUTE_STOPS[i - 1], u = (m - m0) / (m1 - m0)
      return c0.map((v, j) => Math.round(v + (c1[j] - v) * u)) as [number, number, number]
    }
  }
  return MINUTE_STOPS[MINUTE_STOPS.length - 1][1]
}
