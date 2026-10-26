import { expect, test } from 'vitest'
import { clusterByPixel } from './cluster'

const pts: [number, number][] = [[128.49, 35.54], [128.4901, 35.5401], [128.6, 35.4]]
const at = (p: [number, number]) => p

test('가까운 점은 묶이고 먼 점은 따로 남는다', () => {
  const cs = clusterByPixel(pts, at, 10)
  expect(cs).toHaveLength(2)
  expect(cs.map((c) => c.items.length).sort()).toEqual([1, 2])
  expect(cs.flatMap((c) => c.items)).toHaveLength(pts.length)
})

test('많이 확대하면 가까운 점도 풀린다', () => expect(clusterByPixel(pts, at, 20)).toHaveLength(3))

test('묶음 위치는 점들의 평균', () => {
  const two = clusterByPixel(pts.slice(0, 2), at, 10)[0]
  expect(two.lon).toBeCloseTo(128.49005)
  expect(two.lat).toBeCloseTo(35.54005)
})

test('칸 경계에 걸친 바로 옆 두 점도 묶인다(거리 기반)', () => {
  // 줌 10에서 약 20px 떨어진 두 점(예전 칸 방식이면 경계에 따라 따로 남을 수 있었다)
  const two: [number, number][] = [[128.4999, 35.5], [128.5003, 35.5]]
  expect(clusterByPixel(two, at, 10)).toHaveLength(1)
})

test('묶음 바로 옆에 낱개가 남지 않는다', () => {
  const row: [number, number][] = [0, 1, 2, 3].map((i) => [128.5 + i * 0.006, 35.5])
  const cs = clusterByPixel(row, at, 12)
  const scale = 512 * 2 ** 12
  const x = (lon: number) => ((lon + 180) / 360) * scale
  // 어떤 두 묶음(낱개 포함)도 서로 바짝 붙어 있지 않다(30px 이상 떨어진다)
  for (const a of cs) for (const b of cs) if (a !== b) expect(Math.abs(x(a.lon) - x(b.lon))).toBeGreaterThanOrEqual(30)
})
