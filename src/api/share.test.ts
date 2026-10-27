import { describe, expect, test } from 'vitest'
import { readShare, shareQuery } from './share'
import type { State } from './types'

// 서버 /api/regions의 defaultState와 같은 모양
const defaults: State = {
  service: 'med', age: 'a80', criteria: { carMinutes: 30, stopWalkMinutes: 15, dailyRuns: 3 },
  assumptions: {
    version: 1, teleEffect: 0.5, tourWeekly: 2,
    costs: { fix: { install: 12, yearly: 2.4, years: 20 }, tour: { install: 2.5, yearly: 1.1, years: 8 }, drt: { install: 0.9, yearly: 0.8, years: 8 }, tele: { install: 0.03, yearly: 0.05, years: 5 } },
  },
  allowedSupply: { fix: true, tour: true, drt: true, tele: true },
  budget: 6, target: 0.95, planShow: 1, selectedVillage: null,
  report: { form: 'official', sections: {} },
}
const changed: State = {
  ...defaults, age: 'all', budget: 12.5, target: 0.8, planShow: 2,
  criteria: { carMinutes: 45, stopWalkMinutes: 8, dailyRuns: 6 },
  allowedSupply: { fix: false, tour: true, drt: false, tele: true },
  assumptions: { ...defaults.assumptions, teleEffect: 0.3, tourWeekly: 5, costs: { ...defaults.assumptions.costs, tour: { install: 3.1, yearly: 1.4, years: 10 } } },
}
// 링크를 주소로 만들었다가 새 탭에서 여는 것처럼 문자열을 거쳐 읽는다
const roundTrip = (st: State) => readShare(new URLSearchParams(shareQuery(st).toString()), defaults)

describe('레포트 공유 링크', () => {
  test('바꾼 기준 · 공급수단 · 단가가 그대로 되살아난다', () => {
    expect(roundTrip(changed)).toEqual(changed)
  })
  test('기본값 링크는 기본값 그대로다', () => {
    expect(roundTrip(defaults)).toEqual(defaults)
  })
  test('예전 링크(s · a · b · t · p만)는 그 값만 바꾸고 나머지는 기본값', () => {
    const r = readShare(new URLSearchParams('s=med&a=a65&b=10&t=0.9&p=0'), defaults)
    expect(r).toEqual({ ...defaults, age: 'a65', budget: 10, target: 0.9, planShow: 0 })
  })
  test('쿼리가 없으면 그대로다', () => {
    expect(readShare(new URLSearchParams(''), changed)).toEqual(changed)
  })
  test('잘못된 값은 버리고 나머지는 읽는다', () => {
    const q = new URLSearchParams('a=x&b=99&t=abc&p=1.5&cm=7&sw=&dr=4&sup=fix,boat&c_fix=1,2&c_tour=-1,1,8&c_drt=1,1,8.5&te=0.55&tw=3')
    expect(readShare(q, defaults)).toEqual({ ...defaults, criteria: { ...defaults.criteria, dailyRuns: 4 }, assumptions: { ...defaults.assumptions, tourWeekly: 3 } })
  })
  test('공급수단을 모두 끈 링크는 받지 않는다', () => {
    expect(readShare(new URLSearchParams('sup='), defaults).allowedSupply).toEqual(defaults.allowedSupply)
  })
  test('다른 쿼리는 지우지 않고, 예전 공유 값은 새 값으로 바꾼다', () => {
    const q = shareQuery(changed, new URLSearchParams('utm=x&b=1&cm=20'))
    expect(q.get('utm')).toBe('x')
    expect(q.getAll('b')).toEqual(['12.5'])
    expect(q.getAll('cm')).toEqual(['45'])
  })
  test('고쳐 쓴 문단은 링크에 담지 않는다', () => {
    const q = shareQuery({ ...changed, report: { form: 'official', sections: { 현황: '직접 쓴 글' } } })
    expect(q.toString()).not.toContain(encodeURIComponent('직접'))
  })
})
