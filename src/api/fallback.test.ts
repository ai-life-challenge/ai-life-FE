import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError, api } from './client'
import { RETRY_AFTER_MS, canProbe, isDown, isRecoverable, markDown, markUp, resetDown, validJudge, validPlans, validSens } from './fallback'
import { estimateJudge, estimatePlans } from './estimatePlans'
import { region, state } from './testRegion'
import type { Plans } from './types'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetDown() })

describe('추정으로 넘길 실패', () => {
  test.each([[500, true], [502, true], [503, true], [400, false], [404, false], [422, false], [429, false]])('HTTP %s → %s', (status, want) => {
    expect(isRecoverable(new ApiError(status, 'x', 'm'))).toBe(want)
  })
  test('연결 실패 · 시간 초과 · 읽을 수 없는 응답은 넘기고, 멈춘 요청과 그 밖의 오류는 넘기지 않는다', () => {
    expect(isRecoverable(new ApiError(0, 'network', 'm'))).toBe(true)
    expect(isRecoverable(new ApiError(0, 'timeout', 'm'))).toBe(true)
    expect(isRecoverable(new ApiError(200, 'bad_response', 'm'))).toBe(true)
    expect(isRecoverable(new ApiError(0, 'stale', 'm'))).toBe(false)
    expect(isRecoverable(new DOMException('aborted', 'AbortError'))).toBe(false)
    expect(isRecoverable(new Error('x'))).toBe(false)
  })
  test('JSON이 아닌 200 응답은 bad_response 오류가 된다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
    await expect(api.health()).rejects.toMatchObject({ code: 'bad_response' })
  })
})

describe('응답 검사', () => {
  const plans = estimatePlans(region(), state()), judge = estimateJudge(region(), state())
  test('정상 응답은 통과한다', () => {
    expect(validPlans(plans, 6)).toBe(true)
    expect(validJudge(judge, 6)).toBe(true)
    expect(validSens({ base: { k: 1, name: 'a', rate: 1, year: 1, summary: '' }, lo: { k: 1, name: 'a', rate: 1, year: 1, summary: '' }, hi: { k: 1, name: 'a', rate: 1, year: 1, summary: '' }, same: true })).toBe(true)
  })
  test('빠지거나 잘못된 값은 통과하지 못한다', () => {
    const bad = (f: (p: Plans) => void) => { const c = JSON.parse(JSON.stringify(plans)) as Plans; f(c); return validPlans(c, 6) }
    expect(validPlans(null)).toBe(false)
    expect(bad((p) => { p.plans.pop() })).toBe(false)
    expect(bad((p) => { p.plans[0].rate = 1.2 })).toBe(false)
    expect(bad((p) => { (p.plans[0] as unknown as { year: unknown }).year = null })).toBe(false)
    expect(bad((p) => { p.plans[0].coverage = [] })).toBe(false) // 마을 수와 다르면 지도에 잇지 못한다
    expect(validJudge({ ...judge, villages: judge.villages.slice(1) }, 6)).toBe(false)
    expect(validJudge({ ...judge, summary: undefined as never })).toBe(false)
    expect(validSens({ same: true } as never)).toBe(false)
  })
})

test('장애 기억: 잠시 다시 묻지 않고, 시간이 지나면 한 번 묻고, 성공하면 지운다', () => {
  vi.useFakeTimers()
  expect(isDown('plans')).toBe(false)
  markDown('plans')
  expect(isDown('plans')).toBe(true)
  expect(isDown('judge')).toBe(false) // 칸마다 따로
  expect(canProbe('plans')).toBe(false)
  vi.advanceTimersByTime(RETRY_AFTER_MS)
  expect(canProbe('plans')).toBe(true)
  markUp('plans')
  expect(isDown('plans')).toBe(false)
})
