import fs from 'node:fs'
import { describe, expect, test } from 'vitest'
import { EstimateError, TOUR_MAX_MINUTES, TOUR_MAX_STOPS, coverageById, estimateJudge, estimatePlans, estimateSensitivity, yearCost } from './estimatePlans'
import { judgeLocal } from './judge'
import { only, region, state, village } from './testRegion'
import type { Plan, Plans, RegionData } from './types'

const costs = state().assumptions.costs
const withCost = (o: Partial<typeof costs>) => ({ ...state().assumptions, costs: { ...costs, ...o } })
const covOf = (ps: Plans, plan: Plan, id: string) => coverageById(ps, plan, null)!.get(id)
const reach = (ps: Plans, plan: Plan, data: RegionData, age: 'a80' = 'a80') => data.villages.reduce((a, v) => a + v.pop[age] * covOf(ps, plan, v.id)!, 0)

describe('기준 접근성', () => {
  test('기본 달성률 = 1 − 공백 비율 (summary.rate는 공백 비율이다)', () => {
    const data = region(), st = state()
    const { summary } = judgeLocal(data, st)
    const ps = estimatePlans(data, st)
    expect(summary.gap).toBe(140)
    expect(ps.plans[0].baseRate).toBeCloseTo(1 - 140 / 300, 4)
    expect(ps.plans[0].baseRate).not.toBeCloseTo(summary.rate, 2)
    expect(ps.plans[0].gapBefore).toBe(140)
  })
  test('전체 인구 0이면 숫자를 만들지 않고 추정 불가로 알린다', () => {
    const data = region([village('v0', { people: 0, walk: 5 }), village('v1', { people: 0 })])
    expect(() => estimatePlans(data, state())).toThrow(EstimateError)
  })
  test('마을 자료가 없거나 잘못되면 추정하지 않는다', () => {
    expect(() => estimatePlans(region([]), state())).toThrow(EstimateError)
    const dup = region([village('v0'), village('v0')])
    expect(() => estimatePlans(dup, state())).toThrow(EstimateError)
    const bad = region([village('v0')]); bad.villages[0].pop.a80 = Number.NaN
    expect(() => estimatePlans(bad, state())).toThrow(EstimateError)
  })
  test('음수 · NaN 값은 추정하지 않는다', () => {
    expect(() => estimatePlans(region(), state({ budget: Number.NaN }))).toThrow(EstimateError)
    expect(() => estimatePlans(region(), state({ budget: -1 }))).toThrow(EstimateError)
    expect(() => estimatePlans(region(), state({ assumptions: withCost({ fix: { install: -1, yearly: 1, years: 1 } }) }))).toThrow(EstimateError)
    expect(() => estimatePlans(region(), state({ assumptions: withCost({ fix: { install: 1, yearly: 1, years: 0 } }) }))).toThrow(EstimateError)
  })
  test('서버 대안처럼 service와 상관없이 병원 가는 길 판정에서 출발한다', () => {
    const data = region()
    expect(estimatePlans(data, state({ service: 'bus' })).plans[0].gapBefore).toBe(estimatePlans(data, state()).plans[0].gapBefore)
  })
  test('판정 대체값은 브라우저 판정과 같고 읍면 이름으로 준다', () => {
    const data = region(), st = state()
    const j = estimateJudge(data, st)
    expect(j.summary).toEqual(judgeLocal(data, st).summary)
    expect(j.villages.map((v) => v.id)).toEqual(data.villages.map((v) => v.id))
    expect(j.villages[1].myeon).toBe('가면')
  })
})

describe('예산', () => {
  test('예산 0이면 아무것도 놓지 않고, 세 안이 같으면 sameAs로 잇는다', () => {
    const ps = estimatePlans(region(), state({ budget: 0 }))
    for (const p of ps.plans) { expect(p.picks).toEqual([]); expect(p.year).toBe(0); expect(p.withinBudget).toBe(true); expect(p.meetsTarget).toBe(false) }
    expect(ps.plans.map((p) => p.sameAs)).toEqual([null, 0, 0])
    expect(ps.recommended).toBe(0)
  })
  test.each([0, 0.05, 0.1, 0.5, 1, 1.5, 3, 6, 30])('예산 %s억을 넘지 않는다', (budget) => {
    for (const p of estimatePlans(region(), state({ budget, target: 1 })).plans) {
      expect(p.year).toBeLessThanOrEqual(budget + 1e-9)
      expect(p.withinBudget).toBe(true)
      expect(p.year).toBeCloseTo(p.picks.reduce((a, x) => a + x.year, 0), 5)
    }
  })
  test('연 비용 = 설치비 ÷ 기간 + 운영비, 설치비는 따로 더한다', () => {
    expect(yearCost(costs.drt)).toBeCloseTo(0.9125, 6)
    const ps = estimatePlans(region(), state({ allowedSupply: only('drt'), budget: 30, target: 1 }))
    const p = ps.plans[2]
    expect(p.picks.length).toBeGreaterThan(0)
    expect(p.year).toBeCloseTo(p.picks.length * 0.9125, 5)
    expect(p.install).toBeCloseTo(p.picks.length * 0.9, 5)
  })
  test('0원 단가도 안전하게 계산한다', () => {
    const zero = { install: 0, yearly: 0, years: 1 }
    const ps = estimatePlans(region(), state({ budget: 0, target: 1, assumptions: withCost({ fix: zero, tour: zero, drt: zero, tele: zero }) }))
    for (const p of ps.plans) { expect(Number.isFinite(p.rate)).toBe(true); expect(p.year).toBe(0) }
    expect(ps.plans[2].rate).toBe(1) // 비용이 없으면 다 놓을 수 있다
  })
  test('단가를 올리면 조합이 달라진다', () => {
    const data = region(), st = state({ allowedSupply: only('drt', 'tele'), budget: 1, target: 1 })
    const cheap = estimatePlans(data, st)
    const dear = estimatePlans(data, { ...st, assumptions: withCost({ drt: { install: 0, yearly: 5, years: 1 } }) })
    expect(cheap.plans[2].picks.some((x) => x.type === 'drt')).toBe(true)
    expect(dear.plans[2].picks.some((x) => x.type === 'drt')).toBe(false)
  })
})

describe('공급수단 규칙', () => {
  test('고르지 않은 공급수단은 쓰지 않는다', () => {
    const kinds = (ps: Plans) => new Set(ps.plans.flatMap((p) => p.picks.map((x) => x.type)))
    expect([...kinds(estimatePlans(region(), state({ allowedSupply: only('tele'), budget: 30, target: 1 })))]).toEqual(['tele'])
    expect([...kinds(estimatePlans(region(), state({ allowedSupply: only('drt'), budget: 30, target: 1 })))]).toEqual(['drt'])
    expect([...kinds(estimatePlans(region(), state({ allowedSupply: only('fix'), budget: 30, target: 1 })))]).toEqual(['fix'])
    expect([...kinds(estimatePlans(region(), state({ allowedSupply: only('tour'), budget: 30, target: 1 })))]).toEqual(['tour'])
  })
  test('경로당이 없는 마을에는 원격진료를 놓지 않는다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('tele'), budget: 30, target: 1 }))
    const p = ps.plans[2]
    expect(p.picks.flatMap((x) => x.villages)).not.toContain('v2')
    expect(covOf(ps, p, 'v2')).toBe(0)
    expect(covOf(ps, p, 'v1')).toBe(0.5)
  })
  test('원격진료 효과를 바꾸면 달성률이 그만큼 바뀐다', () => {
    const data = region()
    const a = estimatePlans(data, state({ allowedSupply: only('tele'), budget: 30, target: 1 })).plans[2]
    const assumptions = { ...state().assumptions, teleEffect: 0.8 }
    const ps = estimatePlans(data, state({ allowedSupply: only('tele'), budget: 30, target: 1, assumptions }))
    const b = ps.plans[2]
    expect(b.rate).toBeGreaterThan(a.rate)
    expect(covOf(ps, b, 'v1')).toBe(0.8)
    const none = estimatePlans(data, state({ allowedSupply: only('tele'), budget: 30, target: 1, assumptions: { ...state().assumptions, teleEffect: 0 } })).plans[2]
    expect(none.picks).toEqual([])
  })
  test('수요응답형 버스는 자가용으로도 먼 마을을 개선하지 않는다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('drt'), budget: 30, target: 1 }))
    const p = ps.plans[2]
    expect(covOf(ps, p, 'v4')).toBe(0)
    expect(covOf(ps, p, 'v3')).toBe(1)
    expect(covOf(ps, p, 'v1')).toBe(1)
    expect(p.meetsTarget).toBe(false)
    expect(p.picks.map((x) => x.myeon).sort()).toEqual(['가면', '나면']) // 읍면 이름: 지도가 경계를 이 이름으로 찾는다
  })
  test('수요응답형 버스 구역을 고를 때 자가용으로도 먼 주민을 닿는 주민으로 세지 않는다', () => {
    const data = region([village('v0', { walk: 5, people: 100 }), village('v1', { people: 30, m: 'm1' }), village('v2', { people: 10, m: 'm2' }), village('v3', { people: 100, m: 'm2', medMin: 50 })])
    const ps = estimatePlans(data, state({ allowedSupply: only('drt'), budget: 1, target: 1 }))
    expect(ps.plans[2].picks.map((x) => x.myeon)).toEqual(['가면']) // 나면은 버스로 닿는 주민이 10명뿐이다
  })
  test('다른 수단으로 닿은 주민을 원격진료 효과로 또 세어 목표를 채운 것처럼 만들지 않는다', () => {
    const data = region([village('v0', { walk: 5, people: 100 }), village('v1', { people: 50, m: 'm1' }), village('v3', { people: 20, m: 'm2' }), village('v4', { people: 20, m: 'm2' })])
    // 버스 1대 + 원격 2곳 = 170명으로 목표(171명)에 못 미친다. 버스 2대만 목표를 채운다
    const ps = estimatePlans(data, state({ allowedSupply: only('drt', 'tele'), budget: 30, target: 171 / 190 }))
    expect(ps.plans[0].meetsTarget).toBe(true)
    expect(ps.plans[0].picks.map((x) => x.type)).toEqual(['drt', 'drt'])
  })
  test('거점은 버스 없는 이웃 마을에 닿지 않고, 순회는 너무 먼 마을도 개선한다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('fix'), budget: 3, target: 1 }))
    const p = ps.plans[2]
    expect(p.picks).toHaveLength(1)
    expect(p.picks[0].villages).toEqual(['v1']) // 공백 주민이 가장 많은 마을
    expect(covOf(ps, p, 'v2')).toBe(0)
    const t = estimatePlans(region(), state({ allowedSupply: only('tour'), budget: 30, target: 1 }))
    expect(covOf(t, t.plans[2], 'v4')).toBe(1)
  })
  describe('거점이 함께 닿는 먼 마을', () => {
    // 응급실까지 시간을 공유해 진료소 후보(a1) ↔ 먼 마을의 도로 시간 상한을 정한다. a1이 공백 주민이 가장 많아 먼저 놓인다
    const scene = (farErMinutes: number, farWalk: number) => {
      const a1 = village('v1', { people: 50 }), far = village('v4', { people: 20, medMin: 50, walk: farWalk }), o = village('v0', { walk: 5, people: 100 })
      a1.nearest.er!.center!.minutes = 5; far.nearest.er!.center!.minutes = farErMinutes
      return region([o, a1, far])
    }
    const st = state({ allowedSupply: only('fix'), budget: 3, target: 1 })
    test('버스로 갈 수 있고 새 진료소까지 자가용 기준 안이면 닿는다', () => {
      const ps = estimatePlans(scene(10, 5), st), p = ps.plans[2]
      expect(p.picks.flatMap((x) => x.villages)).toEqual(['v1'])
      expect(covOf(ps, p, 'v4')).toBe(1)
      expect(p.rate).toBeCloseTo(1, 4)
    })
    test('버스로 갈 수 없으면 닿지 않는다', () => {
      const ps = estimatePlans(scene(10, 30), st)
      expect(covOf(ps, ps.plans[2], 'v4')).toBe(0)
    })
    test('도로 시간 상한이 자가용 기준을 넘으면 닿지 않는다', () => {
      const ps = estimatePlans(scene(40, 5), st)
      expect(covOf(ps, ps.plans[2], 'v4')).toBe(0)
    })
    test('버스가 없어 못 가는 이웃 마을은 함께 닿지 않는다', () => {
      const a1 = village('v1', { people: 50 }), near = village('v2', { people: 20 })
      const ps = estimatePlans(region([village('v0', { walk: 5, people: 100 }), a1, near]), st)
      expect(covOf(ps, ps.plans[2], 'v2')).toBe(0)
    })
  })
  test('순회 진료는 주 2회 미만이면 넣지 않는다(서버 규칙)', () => {
    const assumptions = { ...state().assumptions, tourWeekly: 1 }
    const ps = estimatePlans(region(), state({ allowedSupply: only('tour'), budget: 30, target: 1, assumptions }))
    expect(ps.plans[2].picks).toEqual([])
    expect(ps.estimate!.notes.join(' ')).toContain('주 2회')
  })
  test('순회 노선은 정차 8곳까지, 도로 시간을 확인 못 한 마을은 정차에서 뺀다', () => {
    const vs = [village('v0', { walk: 5, people: 100 }), ...Array.from({ length: 12 }, (_, i) => village(`v${i + 1}`, { people: 10 + i })), village('v20', { people: 90, anchor: false })]
    const data = region(vs)
    const ps = estimatePlans(data, state({ allowedSupply: only('tour'), budget: 30, target: 1 }))
    const p = ps.plans[2], tours = p.picks.filter((x) => x.type === 'tour')
    expect(tours.length).toBeGreaterThan(1)
    for (const t of tours) expect(t.villages.length).toBeLessThanOrEqual(TOUR_MAX_STOPS)
    expect(tours.flatMap((t) => t.villages)).not.toContain('v20')
    expect(covOf(ps, p, 'v20')).toBe(0)
    expect(ps.estimate!.notes.join(' ')).toContain('공백 마을 1곳')
    // 노선 왕복 시간 상한: 모든 마을이 공유의원까지 5분이라 구간마다 10분
    for (const t of tours) expect((t.villages.length + 1) * 10).toBeLessThanOrEqual(TOUR_MAX_MINUTES)
  })
  test('왕복 165분 상한으로 구간이 길면 한 대의 정차 수가 줄어든다', () => {
    const longLeg = (id: string) => { const v = village(id, { people: 10 }); v.nearest.med = { minutes: 40, name: '공유의원', kind: '의원', outside: false }; v.nearest.er = null; return v }
    const depot = village('v0', { walk: 5, people: 100 }); depot.nearest.med = { minutes: 40, name: '공유의원', kind: '의원', outside: false }; depot.nearest.er = null
    const data = region([depot, ...Array.from({ length: 4 }, (_, i) => longLeg(`v${i + 1}`))])
    const ps = estimatePlans(data, state({ allowedSupply: only('tour'), budget: 30, target: 1 }))
    const tours = ps.plans[2].picks.filter((x) => x.type === 'tour')
    // 구간마다 상한 80분: 왕복 165분 안에는 1곳(160분)만 들어간다
    expect(tours.map((t) => t.villages.length)).toEqual([1, 1, 1, 1])
  })
  test('도로 시간 상한이 왕복 165분을 넘는 마을은 정차하지 않는다', () => {
    const far = village('v9', { people: 50, medMin: 100 })
    far.nearest.er!.center!.minutes = 100
    const ps = estimatePlans(region([village('v0', { walk: 5, people: 100 }), far]), state({ allowedSupply: only('tour'), budget: 30, target: 1 }))
    expect(ps.plans[2].picks).toEqual([])
    expect(ps.plans[2].rate).toBeCloseTo(100 / 150, 3) // 놓지 못하면 달성률도 그대로
  })
})

describe('달성률과 중복', () => {
  const data = region(), ps = estimatePlans(data, state({ budget: 30, target: 1 }))
  test('달성률은 coverage로 다시 계산한 값과 같고 0~100% 안이다', () => {
    for (const p of ps.plans) {
      expect(p.rate).toBeGreaterThanOrEqual(0); expect(p.rate).toBeLessThanOrEqual(1)
      expect(p.rate).toBeCloseTo(reach(ps, p, data) / 300, 3)
      expect(p.gapAfter).toBeCloseTo(300 - reach(ps, p, data), 5)
      expect(p.gapAfter).toBeGreaterThanOrEqual(0)
      for (const c of p.coverage) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1) }
    }
  })
  test('같은 주민을 두 번 세지 않는다: 다른 수단이 닿은 마을에는 원격진료를 놓지 않는다', () => {
    const mix = estimatePlans(data, state({ budget: 6, target: 1 }))
    for (const p of mix.plans) {
      const teleIds = p.picks.filter((x) => x.type === 'tele').flatMap((x) => x.villages)
      const fullIds = p.picks.filter((x) => x.type === 'fix' || x.type === 'tour').flatMap((x) => x.villages)
      expect(teleIds.filter((x) => fullIds.includes(x))).toEqual([])
      const all = p.picks.filter((x) => x.type !== 'drt').flatMap((x) => x.villages)
      expect(new Set(all).size).toBe(all.length) // 같은 마을에 두 번 놓지 않는다
      for (const id of teleIds) expect(covOf(mix, p, id)).toBe(0.5)
    }
  })
  test('원래 갈 수 있는 마을은 1, 추가한 수단이 없는 공백 마을은 0', () => {
    const none = estimatePlans(data, state({ budget: 0 }))
    expect(none.plans[0].coverage).toEqual([1, 0, 0, 0, 0, 1])
  })
})

describe('세 안과 추천', () => {
  test('같은 입력이면 같은 결과', () => {
    const a = estimatePlans(region(), state()), b = estimatePlans(region(), state())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
  test('coverage 길이와 순서는 원자료 마을 순서와 같고 id로 이을 수 있다', () => {
    const data = region()
    data.villages.reverse()
    const ps = estimatePlans(data, state({ budget: 0 }))
    expect(ps.estimate!.basis.map((v) => v.id)).toEqual(data.villages.map((v) => v.id))
    expect(ps.plans[0].coverage).toHaveLength(data.villages.length)
    expect(covOf(ps, ps.plans[0], 'v0')).toBe(1)
    expect(covOf(ps, ps.plans[0], 'v1')).toBe(0)
    expect(coverageById({ ...ps, estimate: undefined }, ps.plans[0], [{ id: 'short' }])).toBeNull() // 길이가 다르면 잇지 않는다
  })
  test('k는 0 · 1 · 2 순서고, 균형안은 원격진료를 쓰지 않는다', () => {
    const ps = estimatePlans(region(), state({ budget: 30, target: 1 }))
    expect(ps.plans.map((p) => [p.k, p.name])).toEqual([[0, '비용 절감안'], [1, '균형안'], [2, '적극 투자안']])
    expect(ps.plans[1].picks.some((x) => x.type === 'tele')).toBe(false)
    for (const p of ps.plans) expect(p.timedOut).toBe(false)
  })
  test('sameAs는 실제 배치를 비교한다: 요약이 같아도 다른 마을이면 같은 조합이 아니다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('tele'), budget: 30, target: 0.5 }))
    expect(ps.plans[0].picks).toEqual([]) // 기본 달성률(53.3%)이 목표를 넘는다
    expect(ps.plans[1].sameAs).toBe(0)
    expect(ps.plans[2].sameAs).toBeNull()
    const a = estimatePlans(region(), state({ allowedSupply: only('fix'), budget: 3, target: 1 }))
    expect(a.plans[1].sameAs).toBe(0)
    expect(a.plans[2].sameAs).toBe(0)
  })
  test('목표를 못 채우면 그대로 미달로 두고, 달성률이 가장 높은 안을 추천한다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('tele'), budget: 30, target: 1 }))
    expect(ps.plans.every((p) => !p.meetsTarget)).toBe(true)
    expect(ps.plans[1].picks).toEqual([]) // 균형안은 원격진료를 못 쓴다
    expect(ps.recommended).toBe(0)
    expect(ps.plans.filter((p) => p.recommended).map((p) => p.k)).toEqual([0])
  })
  test('추천 순서: 균형안이 목표를 채우면 균형안, 아니면 비용 절감안', () => {
    const a = estimatePlans(region(), state({ budget: 30, target: 0.6 }))
    expect(a.plans[1].meetsTarget).toBe(true)
    expect(a.recommended).toBe(1)
    const b = estimatePlans(region(), state({ allowedSupply: only('tele'), budget: 30, target: 0.6 }))
    expect(b.plans[1].meetsTarget).toBe(false)
    expect(b.plans[0].meetsTarget).toBe(true)
    expect(b.recommended).toBe(0)
  })
  test('비용 절감안은 목표를 채우는 조합 중 적극 투자안보다 비싸지 않다', () => {
    const ps = estimatePlans(region(), state({ budget: 30, target: 0.7 }))
    expect(ps.plans[0].meetsTarget).toBe(true)
    expect(ps.plans[0].year).toBeLessThanOrEqual(ps.plans[2].year)
    expect(ps.plans[2].rate).toBeGreaterThanOrEqual(ps.plans[0].rate)
  })
  test('요약 · 이름표는 서버 형식과 같다', () => {
    const ps = estimatePlans(region(), state({ allowedSupply: only('drt', 'tele'), budget: 1, target: 1 }))
    expect(ps.plans[2].summary).toMatch(/수요응답형 버스 1대|경로당 원격진료 \d+곳/)
    expect(estimatePlans(region(), state({ budget: 0 })).plans[0].summary).toBe('추가 공급 없음')
    const drt = estimatePlans(region(), state({ allowedSupply: only('drt'), budget: 1, target: 1 })).plans[2].picks[0]
    expect(drt.label).toBe('수요응답형 버스 (가면 권역)')
    expect(drt.villages).toEqual([])
  })
})

describe('10년 뒤와 민감도', () => {
  test('10년 뒤 달성률은 80세 이상에서만, 서버와 같은 식으로 계산한다', () => {
    const data = region()
    data.villages[1].a80In10y = 3
    const ps = estimatePlans(data, state({ budget: 0 }))
    const w = data.villages.map((v) => v.pop.a80 * v.a80In10y)
    expect(ps.plans[0].future).toBeCloseTo((w[0] + w[5]) / w.reduce((a, x) => a + x, 0), 3)
    expect(estimatePlans(data, state({ budget: 0, age: 'a65' })).plans[0].future).toBeNull()
  })
  test('민감도는 곱셈이 아니라 단가를 바꿔 다시 계산한다: 추천 조합이 바뀌는 경우를 잡는다', () => {
    // 수요응답형 1대(연 1억)가 예산 1억에 딱 맞다. 단가 +20%면 놓을 수 없어 조합이 바뀐다
    const assumptions = { ...state().assumptions, costs: { ...costs, drt: { install: 0, yearly: 1, years: 1 } } }
    const st = state({ allowedSupply: only('drt', 'tele'), budget: 1, target: 0.7, assumptions })
    const s = estimateSensitivity(region(), st)
    expect(s.same).toBe(false)
    expect(s.hi.summary).not.toBe(s.base.summary)
    expect(s.hi.year).not.toBeCloseTo(s.base.year * 1.2, 5)
  })
  test('조합이 그대로면 연 비용만 ±20% 달라진다', () => {
    const st = state({ allowedSupply: only('drt'), budget: 30, target: 0.6 })
    const s = estimateSensitivity(region(), st)
    expect(s.same).toBe(true)
    expect(s.lo.year).toBeCloseTo(s.base.year * 0.8, 5)
    expect(s.hi.year).toBeCloseTo(s.base.year * 1.2, 5)
  })
})

// 로컬에 저장한 실제 지역 자료(snapshot.local, Git 제외)로 불변식과 계산량을 확인한다(폴더가 없으면 건너뛴다)
const snap = (code: string) => { try { return (JSON.parse(fs.readFileSync(`snapshot.local/${code}.json`, 'utf8')) as { data: RegionData }).data } catch { return null } }
describe.skipIf(!snap('48740'))('실제 지역 자료', () => {
  const data = snap('48740')!
  test('예산이 늘면 적극 투자안 달성률이 떨어지지 않는다(곡선 역전 없음)', () => {
    let prev = -1
    for (const budget of [0, 0.5, 1, 2, 3, 4, 6, 10, 20, 30]) {
      const p = estimatePlans(data, state({ budget, target: 1 })).plans[2]
      expect(p.rate).toBeGreaterThanOrEqual(prev)
      expect(p.year).toBeLessThanOrEqual(budget + 1e-9)
      prev = p.rate
    }
  })
  test('예산을 바꾸면 조합을 다시 찾는다(달성률에 비율을 곱하지 않는다)', () => {
    const a = estimatePlans(data, state({ budget: 1, target: 1 })).plans[2], b = estimatePlans(data, state({ budget: 6, target: 1 })).plans[2]
    expect(b.summary).not.toBe(a.summary)
    expect(b.rate).toBeGreaterThan(a.rate)
  })
  test('계산은 충분히 빠르다: 가장 큰 예산과 싼 단가에서도', () => {
    const t0 = performance.now()
    estimatePlans(data, state({ budget: 30, target: 1 }))
    const cheap = { install: 0.01, yearly: 0.01, years: 1 }
    estimatePlans(data, state({ budget: 30, target: 1, criteria: { carMinutes: 10, stopWalkMinutes: 5, dailyRuns: 10 }, assumptions: withCost({ fix: cheap, tour: cheap, drt: cheap }) }))
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
