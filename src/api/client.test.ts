import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiError, api } from './client'
import type { State } from './types'

// 서버가 답을 안 주는 척하는 fetch: 멈추라는 신호(abort)가 오면 AbortError로 끝난다
const hang = () => vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
const calc = { region: '48740', state: {} as State }
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('대안 계산(plans)은 30초까지 기다리고, 넘으면 timeout 오류', async () => {
  vi.stubGlobal('fetch', hang())
  const p = api.plans(calc)
  const check = expect(p).rejects.toMatchObject({ code: 'timeout' })
  await vi.advanceTimersByTimeAsync(29_999)
  let settled = false
  void p.catch(() => { settled = true })
  await Promise.resolve()
  expect(settled).toBe(false) // 29.999초까지는 아직 기다린다
  await vi.advanceTimersByTimeAsync(1)
  await check
})

test('나머지 호출(judge)은 20초', async () => {
  vi.stubGlobal('fetch', hang())
  const p = api.judge(calc)
  const check = expect(p).rejects.toBeInstanceOf(ApiError)
  await vi.advanceTimersByTimeAsync(20_000)
  await check
})

test('부른 쪽이 멈추면 timeout이 아니라 AbortError 그대로', async () => {
  vi.stubGlobal('fetch', hang())
  const ac = new AbortController()
  const p = api.plans(calc, ac.signal)
  const check = expect(p).rejects.toMatchObject({ name: 'AbortError' })
  ac.abort()
  await check
})

test('정상 응답은 그대로 돌려준다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, agent: true }))))
  expect(await api.health()).toMatchObject({ agent: true })
})
