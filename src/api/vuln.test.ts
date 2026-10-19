import { expect, test } from 'vitest'
import { overLimit, vulnOf } from './vuln'
import type { RegionData } from './types'

// 병원 하나(127.0, 36.0)와 마을 둘: 가까운 마을(약 0.6km)과 먼 마을(약 33km → 약 64분)
const village = (id: string, lon: number, lat: number, all: number) => ({ id, name: id, myeon: 'm', lon, lat, pop: { all, a65: all / 2, a80: all / 4 }, nearest: { med: null } }) as RegionData['villages'][number]
const data = {
  villages: [village('near', 127.005, 36.003, 300), village('far', 127.3, 36.15, 100)],
  facilities: [{ id: 'h', name: '군립병원', kind: '병원', village: null, lon: 127.0, lat: 36.0, doctors: 10 }],
  indicators: { pop: 10000, doctors: 4.55, stopShare: 0.7, runsShare: 0.9, walkMin: 6 },
} as unknown as RegionData

test('병원 30분 밖 주민 비율과 응급의료 취약지 판정', () => {
  const v = vulnOf(data)
  expect(v.e30).toBeCloseTo(0.25) // 먼 마을 100명 / 400명
  expect(v.vulnerable).toBe(false) // 27% 미만
})

test('기준선이 50점이 되게 지표 점수를 낸다', () => {
  const v = vulnOf(data)
  expect(v.parts.e30).toBeCloseTo(0.25 / 0.54) // 27% → 0.5
  expect(v.doctors).toBeCloseTo(0.455)
  expect(v.parts.d).toBeCloseTo(0.75) // 군 평균 0.91명의 절반 → 75점
  expect(v.ms).toBeCloseTo(0.8)
  expect(v.parts.ms).toBeCloseTo(0.5) // 확보 기준 80% 딱 → 50점
  expect(v.parts.walk).toBeCloseTo(0.2) // 6 / 30
  expect(v.mvi).toBeCloseTo(100 * (0.57 * (0.25 / 0.54) + 0.43 * 0.75))
  expect(v.tvi).toBeCloseTo(100 * (0.57 * 0.5 + 0.43 * 0.2))
  expect(vulnOf({ ...data, indicators: { ...data.indicators, doctors: 20 } }).parts.d).toBe(0) // 평균의 2배 넘으면 0점
})

test('T분 넘는 사람 수와 사람 수로 가중한 평균 시간', () => {
  const r = overLimit([{ id: 'a', name: 'a', minutes: 10, people: 30 }, { id: 'b', name: 'b', minutes: 40, people: 10 }], 30)
  expect(r.gap).toBe(10)
  expect(r.rate).toBeCloseTo(0.25)
  expect(r.avg).toBeCloseTo(17.5)
})
