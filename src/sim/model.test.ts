import { describe, expect, test } from 'vitest'
import { REGIONS, regionOf } from '../data/regions'
import { DEFAULT_COSTS, LEVERS, capEok, costAt, indicators, optimize, planSet, preset, score } from './model'
import { parseGoal } from '../api/agent'
import { buildReport, numsOf } from '../api/report'

const c = costAt(DEFAULT_COSTS, 'mid')
const cn = regionOf('48740')! // 창녕

describe('배분 엔진', () => {
  test('예산을 넘기지 않고, 레버 상한을 지키고, 종합 취약도는 줄어든다', () => {
    for (const r of REGIONS) for (const B of [10, 100, 300]) for (const p of ['med', 'bal', 'safe'] as const) {
      const o = optimize(r, preset(p), B, c)
      const spent = LEVERS.reduce((a, l) => a + o.alloc[l.id], 0)
      expect(spent + o.left).toBeCloseTo(B)
      for (const l of LEVERS) expect(o.alloc[l.id]).toBeLessThanOrEqual(capEok(r, l.id, c) + 1e-9)
      expect(score(o.after, preset(p)).v).toBeLessThan(score(o.before, preset(p)).v)
    }
  })
  test('효과 체감: 1억당 효과가 단계마다 줄어든다', () => {
    const o = optimize(cn, preset('bal'), 200, c)
    expect(o.steps[0].gain).toBeGreaterThan(o.steps.at(-1)!.gain)
  })
  test('구조개선은 100억에선 0원, 200억에서 새로 등장한다 (창녕 균형안, D5 보완)', () => {
    expect(optimize(cn, preset('bal'), 100, c).alloc.struct).toBe(0)
    expect(optimize(cn, preset('bal'), 200, c).alloc.struct).toBeGreaterThan(0)
  })
  test('분야 최소 보장을 켜면 의료 비중이 그 이상이다', () => {
    const o = optimize(cn, preset('safe'), 100, c, 0.6)
    expect(o.alloc.er + o.alloc.doc).toBeGreaterThanOrEqual(60)
  })
  test('교차효과: 버스 증차만 해도 병원 대중교통시간과 의료 점수가 내려간다', () => {
    const x = { er: 0, doc: 0, bus: 20, drt: 0, safety: 0, struct: 0 }
    expect(indicators(cn, x, c).ht).toBeLessThan(indicators(cn).ht)
    expect(score(indicators(cn, x, c), preset('bal')).mvi).toBeLessThan(score(indicators(cn), preset('bal')).mvi)
  })
  test('세 안 중 하나만 추천되고, 단가가 낮으면 결과가 더 좋다', () => {
    const plans = planSet(cn, 100, DEFAULT_COSTS, 'mid')
    expect(plans.filter((p) => p.recommended)).toHaveLength(1)
    for (const p of plans) expect(p.range.low.after.v).toBeLessThanOrEqual(p.range.high.after.v)
  })
})

describe('AI mock', () => {
  test('자연어 → 프리셋, 애매하면 되묻기', () => {
    expect(parseGoal('어르신들이 응급실 가는 시간을 줄이고 싶어요').pick).toBe('med')
    expect(parseGoal('교통사고 사망을 줄이고 싶어요').pick).toBe('safe')
    expect(parseGoal('버스가 너무 안 와요').pick).toBe('bal')
    expect(parseGoal('병원도 멀고 사고도 많아요').pick).toBeNull()
  })
  test('레포트의 모든 숫자는 숫자 대조 기준 안에 있다', () => {
    const rep = buildReport(cn, 100, 'bal', DEFAULT_COSTS, 'mid', 0)
    for (const s of rep.sections) for (const g of s.segs) if (typeof g !== 'string') for (const n of numsOf(g.n)) expect(rep.allowed.has(n)).toBe(true)
    expect(rep.allowed.has('12345')).toBe(false)
  })
})
