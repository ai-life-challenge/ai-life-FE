import { describe, expect, test } from 'vitest'
import { cellRate, erGrid, gridOf, minuteRgb, rateColor } from './cells'

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

describe('응급실까지 시간 격자', () => {
  const outline = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[127.0, 36.0], [127.1, 36.0], [127.1, 36.1], [127.0, 36.1], [127.0, 36.0]]] } }] } as GeoJSON.FeatureCollection
  const vs = [{ lon: 127.005, lat: 36.005, people: 10, minutes: 10 }, { lon: 127.095, lat: 36.095, people: 20, minutes: 50 }]
  const g = erGrid(vs, outline, 10)
  const at = (lon: number, lat: number) => g.find((c) => c.polygon[0][0] <= lon && lon < c.polygon[2][0] && c.polygon[0][1] <= lat && lat < c.polygon[2][1])!
  test('경계 안만 칸으로 채우고, 칸 시간은 가까운 마을 값을 따른다', () => {
    expect(g.length).toBeGreaterThan(50)
    expect(at(127.005, 36.005).minutes).toBeLessThan(15)
    expect(at(127.095, 36.095).minutes).toBeGreaterThan(45)
    for (const c of g) { expect(c.minutes).toBeGreaterThanOrEqual(10); expect(c.minutes).toBeLessThanOrEqual(50) }
  })
  test('칸에는 가장 가까운 마을과 칸 안 인구가 붙는다', () => {
    expect(at(127.095, 36.095).village).toBe(1)
    expect(at(127.095, 36.095).people).toBe(20)
    expect(at(127.05, 36.05).people).toBe(0)
  })
  test('마을에서 1.2km 안 칸만 사람이 사는 칸', () => {
    expect(at(127.095, 36.095).lived).toBe(true)
    expect(at(127.05, 36.05).lived).toBe(false)
  })
  test('시간이 없는 마을은 퍼뜨리지 않고, 전부 없으면 칸을 만들지 않는다', () => {
    const half = erGrid([vs[0], { ...vs[1], minutes: null }], outline, 10)
    expect(Math.max(...half.map((c) => c.minutes))).toBeCloseTo(10)
    expect(erGrid([{ ...vs[0], minutes: null }], outline, 10)).toEqual([])
  })
  test('외딴 마을의 아주 큰 값은 180분으로 자른다', () => expect(Math.max(...erGrid([{ ...vs[0], minutes: 1600 }], outline, 10).map((c) => c.minutes))).toBeCloseTo(180))
  test('색은 10분 이하 진초록, 45분 이상 주황', () => {
    expect(minuteRgb(0)).toEqual([86, 172, 100])
    expect(minuteRgb(90)).toEqual([242, 138, 78])
    expect(minuteRgb(40)[1]).toBeLessThan(minuteRgb(15)[1])
  })
})
