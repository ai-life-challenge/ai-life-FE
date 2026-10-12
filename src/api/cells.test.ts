import { describe, expect, test } from 'vitest'
import { cellRate, gridOf, rateColor } from './cells'

const vs = [{ lon: 127.0, lat: 36.0 }, { lon: 127.001, lat: 36.001 }, { lon: 127.1, lat: 36.1 }, { lon: 127.05, lat: 36.05 }]

describe('마을 집계 격자', () => {
  test('모든 마을이 칸 하나에만 들어간다', () => {
    const g = gridOf(vs, 8)
    expect(g.cells.flatMap((c) => c.members).sort()).toEqual([0, 1, 2, 3])
    expect(new Set(g.cells.map((c) => `${c.ix},${c.iy}`)).size).toBe(g.cells.length)
    for (const c of g.cells) { expect(c.ix).toBeLessThan(g.W); expect(c.iy).toBeLessThan(g.H) }
  })
  test('가까운 마을은 한 칸으로 묶인다', () => {
    const g = gridOf(vs, 8)
    expect(g.cells.find((c) => c.members.includes(0))!.members).toContain(1)
  })
  test('군 경계 안의 빈 칸도 넣는다(마을이 없는 칸은 members가 비어 있다)', () => {
    const outline = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[127.0, 36.0], [127.1, 36.0], [127.1, 36.1], [127.0, 36.1], [127.0, 36.0]]] } }] } as GeoJSON.FeatureCollection
    const plain = gridOf(vs, 8), g = gridOf(vs, 8, outline)
    expect(g.cells.length).toBeGreaterThan(plain.cells.length)
    expect(g.cells.flatMap((c) => c.members).sort()).toEqual([0, 1, 2, 3])
    expect(g.cells.some((c) => c.members.length === 0)).toBe(true)
  })
  test('마을이 하나뿐이어도 칸 하나가 된다', () => expect(gridOf([vs[0]], 8).cells).toHaveLength(1))
  test('칸의 비율은 인구로 가중한다', () => {
    expect(cellRate([0, 1], [30, 10], [0, 10])).toBe(0.25)
    expect(cellRate([0], [0], [0])).toBeNull()
  })
  test('색은 비율이 클수록 붉어진다', () => {
    const red = (c: string) => +c.match(/\d+/g)![0]
    expect(red(rateColor(0))).toBeLessThan(red(rateColor(0.3)))
    expect(rateColor(null)).toBe('#e7e4dc')
  })
})
