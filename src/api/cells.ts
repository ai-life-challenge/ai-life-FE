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
