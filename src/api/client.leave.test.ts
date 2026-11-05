// @vitest-environment jsdom
// 페이지를 떠날 때 가는 중인 요청을 끊는다: 뒤로 가기 캐시에 얼린 페이지의 요청이 살아남아 복구 뒤 새 요청을 막지 않게.
// 끊는 표시는 페이지가 새로 불러올 때까지 남으므로 차례대로 확인한다
import { afterEach, expect, test, vi } from 'vitest'
import { api } from './client'

const hang = () => vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
const pageshow = (persisted: boolean) => { const e = new Event('pageshow') as PageTransitionEvent; Object.defineProperty(e, 'persisted', { value: persisted }); window.dispatchEvent(e) }
const reload = vi.fn()
vi.stubGlobal('location', { ...window.location, reload })
afterEach(() => { reload.mockClear(); vi.stubGlobal('location', { ...window.location, reload }) })

test('끝난 요청만 있으면 뒤로 가기로 돌아와도 새로 불러오지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}')))
  await api.health()
  window.dispatchEvent(new Event('pagehide'))
  pageshow(true)
  expect(reload).not.toHaveBeenCalled()
})

test('떠날 때 가는 중인 요청을 끊는다', async () => {
  const f = hang()
  vi.stubGlobal('fetch', f)
  const p = api.regions()
  const check = expect(p).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  expect((f.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(false)
  window.dispatchEvent(new Event('pagehide'))
  expect((f.mock.calls[0][1] as RequestInit).signal!.aborted).toBe(true)
  await check
})

test('뒤로 가기 캐시에서 돌아올 때만 새로 불러온다(처음 열 때는 아니다)', () => {
  pageshow(false)
  expect(reload).not.toHaveBeenCalled()
  pageshow(true)
  expect(reload).toHaveBeenCalledTimes(1)
})
