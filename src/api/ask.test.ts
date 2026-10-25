import { afterEach, describe, expect, test, vi } from 'vitest'
import { askServer, buildAskBody, stageOf, type AskEvent } from './ask'
import type { State } from './types'

// 서버가 data: {JSON} + 빈 줄로 보내는 SSE를 작은 조각(글자 한가운데서 끊기기도 함)으로 흘려 주는 가짜 응답
const sse = (events: object[], chunk = 5) => {
  const bytes = new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close() } }), { headers: { 'Content-Type': 'text/event-stream' } })
}
const run = async (res: Response | (() => never), signal?: AbortSignal) => {
  vi.stubGlobal('fetch', vi.fn(async () => (typeof res === 'function' ? res() : res)))
  const out: AskEvent[] = []
  for await (const e of askServer({} as never, signal, 'http://x')) out.push(e)
  return out
}
afterEach(() => vi.unstubAllGlobals())

const state = { budget: 10 } as unknown as State

describe('SSE 읽기', () => {
  test('서버가 실제로 보낸 이벤트(도구 · state · 글 · notes · done)를 순서대로 낸다', async () => {
    const evs = [
      { type: 'tool_call', id: 't1', label: '대안 계산 (예산 연 10억, 닿는 사람을 가장 많이)' },
      { type: 'state', state }, { type: 'tool_result', id: 't1', result: '가장 높은 달성률 99.9%, 추천 균형안' },
      { type: 'text', delta: '연 예산을 `10억`으로 바꿨어요.[^b4]' },
      { type: 'text', delta: '\n\n[^b4]: 계산: 적극 투자안', footnotes: true },
      { type: 'notes', notes: [{ n: 1, kind: 'calc', title: '적극 투자안', id: 'b4' }] },
      { type: 'done', state, remainingToday: 195, cached: false },
    ]
    expect(await run(sse(evs))).toEqual(evs)
  })
  test('스트림 앞 오류(JSON)는 서버 message 그대로 error 이벤트 하나', async () => {
    for (const [status, error, message] of [[429, 'ip_limit', '오늘 횟수를 다 썼어요.'], [413, 'too_large', '요청이 너무 커요.'], [503, 'busy', '질문이 몰려 있어요.']] as const) {
      const out = await run(new Response(JSON.stringify({ error, message }), { status }))
      expect(out).toEqual([{ type: 'error', error, message }])
    }
  })
  test('연결 실패는 error 이벤트', async () => {
    const out = await run(() => { throw new TypeError('fail') })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'error', error: 'network' })
  })
  test('끝(done · error) 이벤트 없이 닫히면 error로 끝낸다', async () => {
    expect((await run(sse([{ type: 'text', delta: '글' }]))).map((e) => e.type)).toEqual(['text', 'error'])
  })
  test('스트림 도중 서버가 보낸 error는 그대로 마지막에 낸다', async () => {
    const out = await run(sse([{ type: 'text', delta: '글' }, { type: 'error', error: 'timeout', message: '늦어요' }]))
    expect(out).toEqual([{ type: 'text', delta: '글' }, { type: 'error', error: 'timeout', message: '늦어요' }])
  })
  test('부른 쪽이 멈추면 아무것도 내지 않는다', async () => {
    const ac = new AbortController()
    ac.abort()
    expect(await run(() => { throw new DOMException('aborted', 'AbortError') }, ac.signal)).toEqual([])
  })
})

describe('요청 만들기(서버 AskRequest)', () => {
  test('서버가 허용하는 칸만 보낸다 (옛 sim · diag · screen은 400)', () => {
    const b = buildAskBody({ code: '48740', state, stage: 'alt', question: '왜요?', history: [] })
    expect(Object.keys(b).sort()).toEqual(['history', 'question', 'region', 'stage', 'state'])
    expect(b).toMatchObject({ region: '48740', stage: 'alt', question: '왜요?', state })
  })
  test('앞선 대화는 최근 20개만', () => {
    const history = Array.from({ length: 25 }, (_, i) => ({ role: 'user' as const, text: String(i) }))
    const h = buildAskBody({ code: '1', state, stage: 'diag', question: 'q', history }).history
    expect(h).toHaveLength(20)
    expect(h[0].text).toBe('5')
  })
  test('질문 창 단계는 주소에서 정한다: 레포트 → 검토 메모, 대안 만들기 · 결과 · What-if → 대안, 나머지 → 현황 진단', () => {
    expect(['/r/48740', '/r/48740/goal', '/r/48740/sim', '/r/48740/result', '/r/48740/whatif', '/r/48740/report'].map(stageOf)).toEqual(['diag', 'diag', 'alt', 'alt', 'alt', 'memo'])
  })
})
