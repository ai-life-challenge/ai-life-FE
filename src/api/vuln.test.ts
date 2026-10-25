import { expect, test } from 'vitest'
import { overLimit, ratioScore, villageTimes, vulnOf } from './vuln'
import type { RegionData } from './types'

const er = (minutes: number | null) => ({ regional: null, center: minutes == null ? null : { minutes, name: 'e', kind: '지역응급의료센터' }, facility: null })
const village = (id: string, all: number, erMin: number | null) => ({ id, name: id, myeon: 'm', lon: 127, lat: 36, pop: { all, a65: all / 2, a80: all / 4 }, nearest: { med: null, school: null, library: null, er: er(erMin) } })
const base = { pop: 1000, doctors: 5, doctorsPer1k: 0.45, stopShare: 0.7, runsShare: 0.9, walkMin: 6, e30: 0.25, e60: 0.1 }
const data = (ind: Record<string, number | null> = {}) => ({ villages: [village('a', 300, 10), village('b', 100, 50), village('c', 100, null)], facilities: [], indicators: { ...base, ...ind } }) as unknown as RegionData

test('비율 지표 점수: 기준 → 50점, 100% → 100점 (두 구간 선형)', () => {
  expect(ratioScore(0, 0.3)).toBe(0)
  expect(ratioScore(0.3, 0.3)).toBeCloseTo(0.5)
  expect(ratioScore(0.65, 0.3)).toBeCloseTo(0.75)
  expect(ratioScore(1, 0.3)).toBe(1)
})

test('서버 E30·E60·의사 수로 의료 취약도를 원래 가중치(0.4·0.3·0.3)로 낸다', () => {
  const v = vulnOf(data())
  expect(v.e30).toBe(0.25)
  expect(v.parts.e30).toBeCloseTo(0.5 * 0.25 / 0.3)
  expect(v.parts.e60).toBeCloseTo(0.5 * 0.1 / 0.3)
  expect(v.parts.d).toBeCloseTo(1 - 0.45 / (2 * 0.9)) // 군 평균의 절반 → 75점
  expect(v.mvi).toBeCloseTo(100 * (0.4 * v.parts.e30! + 0.3 * v.parts.e60! + 0.3 * v.parts.d))
  expect(v.vulnerable).toBe(false)
})

test('응급의료 취약지: E30 또는 E60이 30% 이상', () => {
  expect(vulnOf(data({ e30: 0.3 })).vulnerable).toBe(true)
  expect(vulnOf(data({ e30: 0.1, e60: 0.31 })).vulnerable).toBe(true)
})

test('응급 자료가 없으면(null) 그 지표를 빼고 남은 가중치로 다시 나눈다', () => {
  const v = vulnOf(data({ e30: null, e60: null }))
  expect(v.parts.e30).toBeNull()
  expect(v.mvi).toBeCloseTo(100 * v.parts.d) // 의사 수 하나만 남는다
  expect(v.vulnerable).toBe(false)
})

test('교통: 정밀 지역은 (공간 + 시간) / 2, 간이 판정 지역은 시간이 없어 공간만', () => {
  expect(vulnOf(data()).ms).toBeCloseTo(0.8)
  const auto = vulnOf(data({ runsShare: null }))
  expect(auto.tp).toBeNull()
  expect(auto.ms).toBeCloseTo(0.7)
  expect(auto.parts.ms).toBeCloseTo(ratioScore(0.3, 0.2))
  expect(vulnOf(data()).parts.walk).toBeCloseTo(0.2) // 6 / 30
})

test('마을별 응급실 시간은 서버 값, T분 넘거나 길이 없는 마을 인구를 센다', () => {
  const t = villageTimes(data(), 'all')
  expect(t.map((x) => x.minutes)).toEqual([10, 50, null])
  const r = overLimit(t, 30)
  expect(r.gap).toBe(200) // 50분 마을 100명 + 길 없는 마을 100명
  expect(r.rate).toBeCloseTo(0.4)
  expect(r.avg).toBeCloseTo((10 * 300 + 50 * 100) / 400) // 길 없는 마을은 평균에서 뺀다
})
