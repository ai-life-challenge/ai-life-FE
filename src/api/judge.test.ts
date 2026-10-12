import { describe, expect, test } from 'vitest'
import { compare, judgeLocal } from './judge'
import type { Judge, RawVillage, RegionData } from './types'

const village = (id: string, o: Partial<RawVillage['bus']> = {}, med: number | null = 5): RawVillage => ({
  id, name: id, myeon: 'm', lon: 127, lat: 36, a80In10y: 1, seniorCenter: false,
  pop: { all: 100, a65: 40, a80: 10 },
  bus: { stopWalkMin: 3, noStop: false, dailyRuns: 5, firstToTownMin: 480, firstEstimated: false, ...o },
  nearest: { med: med == null ? null : { minutes: med, name: 'x', kind: '의원', outside: false }, school: 1, library: 1 },
})
const data = (tier: 'precise' | 'auto', villages: RawVillage[], facilityVillage: string | null = null): RegionData => ({
  code: '00000', name: 't', sido: 's', tier, town: '', depot: '', sources: [], myeons: [], indicators: {},
  villages, facilities: facilityVillage ? [{ id: 'f', name: 'f', kind: '의원', village: facilityVillage, lon: 0, lat: 0, doctors: 1 }] : [],
})
const rule = { service: 'med', age: 'a80', criteria: { carMinutes: 30, stopWalkMinutes: 15, dailyRuns: 3 } } as const

describe('브라우저 판정', () => {
  test('정밀 지역은 하루 운행 횟수와 읍내행 첫차를 본다', () => {
    const d = data('precise', [village('ok'), village('few', { dailyRuns: 2 }), village('late', { firstToTownMin: 732 }), village('none', { firstToTownMin: null }), village('edge', { firstToTownMin: 720 })])
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([0, 1, 1, 1, 0])
  })
  test('자동 추정 지역은 정류장까지 걷는 거리만 본다', () => {
    const d = data('auto', [village('a', { dailyRuns: 0, firstToTownMin: null }), village('far', { stopWalkMin: 16 }), village('nostop', { noStop: true, stopWalkMin: 60 })])
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([0, 1, 1])
  })
  test('자가용 기준 안에 시설이 없으면 2, 마을 안에 병의원이 있으면 버스와 상관없이 0', () => {
    const d = data('auto', [village('far', {}, 31), village('null', {}, null), village('inside', { noStop: true }, 99)], 'inside')
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([2, 2, 0])
  })
  test('버스 서비스는 시설을 보지 않는다', () => {
    const d = data('auto', [village('far', {}, 99), village('nostop', { noStop: true })])
    expect(judgeLocal(d, { ...rule, service: 'bus' }).villages.map((v) => v.state)).toEqual([0, 1])
  })
  test('나이대별 인구로 합계를 낸다', () => {
    const d = data('auto', [village('a'), village('b', { noStop: true }), village('c', {}, 99)])
    const s = judgeLocal(d, { ...rule, age: 'a65' }).summary
    expect(s).toMatchObject({ total: 120, gap: 80, rate: 0.6667, noBus: 40, noFacility: 40, villagesNoBus: 1, villagesNoFacility: 1, gapVillages: 2 })
  })
})

describe('서버 판정과 대조', () => {
  const d = data('auto', [village('a'), village('b', { noStop: true })])
  const mine = judgeLocal(d, rule)
  const server = (states: [number, number]): Judge => ({ summary: { ...mine.summary }, villages: mine.villages.map((v, i) => ({ ...v, state: states[i] as 0 })) } as Judge)
  test('같으면 same', () => expect(compare(server([0, 1]), mine)).toEqual({ same: true, diff: [] }))
  test('마을 판정이 다르면 그 마을을 알려 준다', () => expect(compare(server([0, 0]), mine)).toEqual({ same: false, diff: ['b'] }))
})
