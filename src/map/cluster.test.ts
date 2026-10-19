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
