import { describe, expect, test } from 'vitest'
import { estimateJudge, estimatePlans } from '../api/estimatePlans'
import { eok, fmt, pct1 } from '../api/meta'
import { region, state } from '../api/testRegion'
import { LOCAL_EXAMPLES, localAnswer, type LocalContext } from './localAnswer'

const data = region()
const st = state()
const ctx: LocalContext = { data, state: st, judge: estimateJudge(data, st), plans: estimatePlans(data, st), snapshot: { capturedAt: '2026-11-06' } as LocalContext['snapshot'], dataSource: 'snapshot' }
const plan = ctx.plans!.plans[st.planShow]

describe('서버 없는 자료 조회', () => {
  test('화면이 계산한 값을 그대로 옮겨 적는다', () => {
    expect(localAnswer('공백 인구는 몇 명이에요?', ctx).text).toContain(`${fmt(ctx.judge!.summary.gap)}명`)
    expect(localAnswer('지금 안의 달성률은요?', ctx).text).toContain(pct1(plan.rate))
    expect(localAnswer('예산과 비용은요?', ctx).text).toContain(eok(plan.year))
    expect(localAnswer('세 안은 어떻게 달라요?', ctx).text).toContain(ctx.plans!.plans[2].name)
  })
  test('수집일과 출처를 밝히고 수집일을 기준 시점이라고 하지 않는다', () => {
    const a = localAnswer('자료 출처는요?', ctx).text
    expect(a).toContain('2026-11-06')
    expect(a).toContain('기준 시점이 아니')
    expect(a).toContain('예시 자료')
  })
  test('마을 이름으로 판정 이유를 찾는다', () => {
    const a = localAnswer('면 v1은 왜 못 가요?', ctx)
    expect(a.supported).toBe(true)
    expect(a.text).toContain('면 v1')
    expect(a.text).toContain('정류장까지 걸어서')
  })
  test('예시 질문은 모두 답할 수 있다', () => {
    for (const q of LOCAL_EXAMPLES) expect(localAnswer(q, ctx).supported, q).toBe(true)
  })
  test('모르는 질문은 지어내지 않고 한계를 알린다', () => {
    const a = localAnswer('내년 의료 정책 방향을 추천해 줘', ctx)
    expect(a.supported).toBe(false)
    expect(a.text).toContain('답할 수 없어요')
    expect(a.text).not.toMatch(/\d+명/)
  })
  test('판정 전이면 공백 인구는 원자료로 같은 규칙의 판정을 계산한다', () => {
    expect(localAnswer('공백 인구는요?', { ...ctx, judge: null }).text).toContain(`${fmt(ctx.judge!.summary.gap)}명`)
  })
  test('자료가 없으면 숫자를 만들지 않는다', () => {
    expect(localAnswer('공백 인구는요?', { ...ctx, data: null, judge: null }).text).not.toMatch(/\d+명/)
  })
  test('계산 전에는 숫자를 만들지 않는다', () => {
    const empty = { ...ctx, judge: null, plans: null }
    for (const q of ['달성률은요?', '비용은요?', '세 안 비교']) expect(localAnswer(q, empty).text).not.toMatch(/\d+(\.\d+)?(%|명|억)/)
  })
  test('서버 값이면 서버 계산, 추정이면 브라우저 추정이라고 적는다', () => {
    expect(localAnswer('달성률은요?', ctx).text).toContain('브라우저 추정')
    const { estimate: _e, ...server } = ctx.plans!
    expect(localAnswer('달성률은요?', { ...ctx, plans: server }).text).toContain('서버 계산')
  })
})
