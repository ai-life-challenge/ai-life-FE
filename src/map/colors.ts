// 이동시간 ÷ 기준시간 비율 → 색. 0 초록 → 1 노랑(기준선) → 2 이상 빨강
const STOPS: [number, [number, number, number]][] = [
  [0, [26, 152, 80]],
  [0.6, [145, 207, 96]],
  [1, [254, 224, 139]],
  [1.4, [252, 141, 89]],
  [2, [215, 48, 39]],
]
export const AVG_ALPHA = 190

export function timeColor(r: number, alpha = 200): [number, number, number, number] {
  if (!isFinite(r) || r >= 2) return [...STOPS[STOPS.length - 1][1], alpha]
  for (let k = 1; k < STOPS.length; k++) {
    const [r1, c1] = STOPS[k]
    if (r <= r1) {
      const [r0, c0] = STOPS[k - 1], t = (r - r0) / (r1 - r0)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, alpha]
    }
  }
  return [...STOPS[0][1], alpha]
}

export const cssColor = (r: number) => {
  const [a, b, c] = timeColor(r)
  return `rgb(${a | 0},${b | 0},${c | 0})`
}

// 공급 수단 색 (지도·카드·메모 공통)
export const SUPPLY_COLOR = {
  fix: [214, 69, 65],
  tour: [47, 91, 211],
  drt: [124, 77, 196],
  taxi: [233, 151, 20],
  tele: [22, 150, 140],
} as const satisfies Record<string, [number, number, number]>
export const SUPPLY_COLOR_CSS = Object.fromEntries(Object.entries(SUPPLY_COLOR).map(([k, c]) => [k, `rgb(${c.join(',')})`])) as Record<keyof typeof SUPPLY_COLOR, string>
