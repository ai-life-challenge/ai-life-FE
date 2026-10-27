import { describe, expect, test } from 'vitest'
import { compare, judgeCar, judgeLocal } from './judge'
import type { Judge, KindFilter, RawVillage, RegionData } from './types'

const village = (id: string, o: Partial<RawVillage['bus']> = {}, med: number | null = 5, er: number | null = 20, byKind?: Partial<Record<KindFilter, number | null>>): RawVillage => ({
  id, name: id, myeon: 'm', lon: 127, lat: 36, a80In10y: 1, seniorCenter: false,
  pop: { all: 100, a65: 40, a80: 10 },
  bus: { stopWalkMin: 3, noStop: false, dailyRuns: 5, firstToTownMin: 480, firstEstimated: false, ...o },
  nearest: {
    med: med == null ? null : { minutes: med, name: 'x', kind: '의원', outside: false }, school: 1, library: 1,
    er: er == null ? { regional: null, center: null, facility: null } : { regional: null, center: { minutes: er, name: 'e', kind: '지역응급의료센터' }, facility: null },
    ...(byKind && { byKind: Object.fromEntries((['hospital', 'clinic', 'public'] as const).map((k) => [k, byKind[k] == null ? null : { minutes: byKind[k]!, name: 'k', kind: k, outside: false }])) as RawVillage['nearest']['byKind'] }),
  },
})
const data = (tier: 'precise' | 'auto', villages: RawVillage[], facilityVillage: string | null = null): RegionData => ({
  code: '00000', name: 't', sido: 's', tier, town: '', depot: '', sources: [], myeons: [], indicators: {} as RegionData['indicators'], shrinkingArea: false, erVulnerable: false,
  villages, facilities: facilityVillage ? [{ id: 'f', name: 'f', kind: '의원', village: facilityVillage, lon: 0, lat: 0, doctors: 1 }] : [],
})
const rule = { service: 'med', age: 'a80', criteria: { carMinutes: 30, stopWalkMinutes: 15, dailyRuns: 3 } } as const

describe('브라우저 판정', () => {
  test('정밀 지역은 하루 운행 횟수와 읍내행 첫차를 본다', () => {
    const d = data('precise', [village('ok'), village('few', { dailyRuns: 2 }), village('late', { firstToTownMin: 732 }), village('none', { firstToTownMin: null })])
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([0, 1, 1, 1])
  })
  test('읍내행 첫차는 12시 전이어야 한다: 11:59 통과 · 12:00 · 12:01 탈락 (서버와 같은 < 720)', () => {
    const d = data('precise', [village('1159', { firstToTownMin: 719 }), village('1200', { firstToTownMin: 720 }), village('1201', { firstToTownMin: 721 })])
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([0, 1, 1])
  })
  test('자동 추정 지역은 정류장까지 걷는 거리만 본다', () => {
    const d = data('auto', [village('a', { dailyRuns: 0, firstToTownMin: null }), village('far', { stopWalkMin: 16 }), village('nostop', { noStop: true, stopWalkMin: 60 })])
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([0, 1, 1])
  })
  test('자가용 기준 안에 시설이 없으면 2, 마을 안에 병의원이 있으면 버스와 상관없이 0', () => {
    const d = data('auto', [village('far', {}, 31), village('null', {}, null), village('inside', { noStop: true }, 99)], 'inside')
    expect(judgeLocal(d, rule).villages.map((v) => v.state)).toEqual([2, 2, 0])
  })
  test('자가용 이용은 버스를 보지 않고 병의원까지 자가용 시간만 본다', () => {
    const d = data('precise', [village('nobus', { noStop: true }, 10), village('far', {}, 31), village('null', {}, null), village('inside', {}, 99)], 'inside')
    const r = judgeCar(d, 'a80', 30)
    expect(r.villages.map((v) => v.state)).toEqual([0, 2, 2, 0])
    expect(r.summary.noBus).toBe(0)
    expect(r.summary.noFacility).toBe(20)
  })
  test('자가용 이용 · 응급실 기준은 마을 안 병의원을 보지 않고, 응급센터 시간이 없으면 못 간다', () => {
    const d = data('auto', [village('near', {}, 99, 20), village('far', {}, 5, 45), village('none', {}, 5, null), village('inside', {}, 99, 45)], 'inside')
    expect(judgeCar(d, 'a80', 30, 'er').villages.map((v) => v.state)).toEqual([0, 2, 2, 2])
    expect(judgeCar(d, 'a80', 30, 'med').villages.map((v) => v.state)).toEqual([2, 0, 0, 0])
  })
  test('자가용 이용 · 종류별(병원급 · 의원 · 보건기관)은 서버 byKind와 마을 안 그 종류 시설만 본다', () => {
    const d: RegionData = {
      ...data('auto', [village('a', {}, 5, 20, { hospital: 40, clinic: 5, public: 40 }), village('b', {}, 5, 20, { hospital: 10, clinic: 50, public: 10 }), village('c', {}, 5, 20, { hospital: 99, clinic: 99, public: 99 }), village('none', {}, 5, 20)], 'c'),
      facilities: [{ id: 'f', name: '의원', kind: '의원', village: 'c', lon: 0, lat: 0, doctors: 1 }, { id: 'g', name: '보건지소', kind: '보건지소', village: 'a', lon: 0, lat: 0, doctors: 0 }],
    }
    const st = (t: Parameters<typeof judgeCar>[3]) => judgeCar(d, 'a80', 30, t).villages.map((v) => v.state)
    expect(st('hospital')).toEqual([2, 0, 2, 2]) // 병원급은 마을 안 시설이 없어서 거리만: a 40분 · c 99분 못 감, byKind가 없는 마을도 못 감
    expect(st('clinic')).toEqual([0, 2, 0, 2]) // c는 마을 안에 의원이 있어 갈 수 있음
    expect(st('public')).toEqual([0, 0, 2, 2]) // a는 마을 안에 보건지소가 있어 갈 수 있음(40분이어도)
  })
  test('대중교통 탭에도 필터가 든다: 병원급이 멀면 버스가 있어도 못 감, 응급은 버스를 안 본다', () => {
    const d = data('auto', [village('a', {}, 5, 20, { hospital: 40, clinic: 5, public: 5 }), village('b', { noStop: true }, 5, 20, { hospital: 5, clinic: 5, public: 5 })])
    const st = (t: Parameters<typeof judgeLocal>[2]) => judgeLocal(d, rule, t).villages.map((v) => v.state)
    expect(st('hospital')).toEqual([2, 1]) // a는 병원급 40분이라 멂, b는 가깝지만 버스 정류장이 없음
    expect(st('clinic')).toEqual([0, 1])
    expect(st('er')).toEqual([0, 0]) // 응급: er.center만 보고 버스는 안 봄(20분 ≤ 30)
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
