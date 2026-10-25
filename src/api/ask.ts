// 질문 API(POST /api/ask) 연결. 요청은 계산 API와 같은 {region, state}에 stage·question·history를 더한 것이고, 답은 SSE로 흘려 받는다(Accept: text/event-stream).
// 서버는 도구가 화면 값(state)을 바꾸면 state 이벤트로 state 전체를 보낸다. 우리는 그 state로 화면을 다시 그린다.
// 스트림을 열기 전 오류(400 · 413 · 429 · 503)와 연결 실패, 끝 이벤트 없이 닫힌 스트림은 모두 error 이벤트로 바꿔 낸다. 부른 쪽이 signal로 멈추면 아무것도 내지 않는다.
import { API_URL } from './client'
import type { Note, Stage, State, Turn } from './types'

export type AskEvent =
  | { type: 'tool_call'; id: string; label: string }
  | { type: 'tool_result'; id: string; result: string }
  | { type: 'text'; delta: string; footnotes?: boolean } // 마크다운 조각. footnotes면 서버가 붙인 각주 정의
  | { type: 'clarify'; options: string[] } // 되묻기 버튼: 누르면 그 글을 그대로 질문으로 보낸다
  | { type: 'state'; state: State } // 도구가 화면 값을 바꿨다(state 전체)
  | { type: 'notes'; notes: Note[] } // 답 끝 각주(done 바로 앞). 같은 내용이 글의 각주 정의로도 와서 화면은 글만 그려도 된다
  | { type: 'done'; state: State; remainingToday: number | null; cached: boolean }
  | { type: 'error'; error: string; message: string }

export interface AskBody { region: string; state: State; stage: Stage; question: string; history: Turn[] } // question 300자 · history 20개 안

// 질문 창 단계: 레포트는 검토 메모, 대안 만들기·결과·What-if는 대안, 나머지(진단 · 목표)는 현황 진단
export const stageOf = (path: string): Stage => (/\/report$/.test(path) ? 'memo' : /\/(sim|result|whatif)$/.test(path) ? 'alt' : 'diag')
export const STAGE_NAME: Record<Stage, string> = { diag: '현황 진단', alt: '대안', memo: '검토 메모' }

export const buildAskBody = (a: { code: string; state: State; stage: Stage; question: string; history: Turn[] }): AskBody =>
  ({ region: a.code, state: a.state, stage: a.stage, question: a.question, history: a.history.slice(-20) })

const FAILED = '답을 만들지 못했어요. 다시 물어봐 주세요.'
const SLOW = '답이 늦어지고 있어요. 다시 물어봐 주세요.'

export async function* askServer(body: AskBody, signal?: AbortSignal, base = API_URL): AsyncGenerator<AskEvent> {
  const ac = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, 60_000) // 서버가 40초에서 끊으니 넉넉히 둔다(서버 권고 60초)
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let res: Response
    try {
      res = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal: ac.signal })
    } catch {
      if (signal?.aborted) return
      yield { type: 'error', error: timedOut ? 'timeout' : 'network', message: timedOut ? SLOW : '서버에 연결하지 못했어요. 잠시 뒤 다시 물어봐 주세요.' }
      return
    }
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}))
      yield { type: 'error', error: j.error ?? 'http_error', message: j.message ?? FAILED }
      return
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = ''
    let ended = false // done이나 error를 받았는지
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const data = chunk.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n')
          if (!data) continue
          const event = JSON.parse(data) as AskEvent
          if (event.type === 'done' || event.type === 'error') ended = true
          yield event
        }
      }
    } catch {
      if (signal?.aborted) return
      yield { type: 'error', error: timedOut ? 'timeout' : 'network', message: timedOut ? SLOW : FAILED }
      return
    }
    // 프록시나 서버가 끝 이벤트 없이 닫았다. 말풍선이 '작성 중'에 멈추지 않게 error로 끝낸다
    if (!ended && !signal?.aborted) yield { type: 'error', error: 'network', message: FAILED }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
