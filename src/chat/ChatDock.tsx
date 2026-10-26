// 오른쪽 아래 'AI에게 물어보기' 버튼과 질문 창. 질문은 서버 에이전트(POST /api/ask)가 SSE로 답한다(api/ask.ts).
// 도구 호출 · 글(마크다운, 표와 각주 포함) · 되묻기 버튼이 오는 대로 말풍선에 이어 붙이고, 도구가 화면 값을 바꾸면(state 이벤트) 지금 화면이 그 state로 다시 그려진다.
// 에이전트를 쓸 수 없거나(키 없음 · 하루 비용 상한 · 동시 실행 상한) 횟수를 다 쓰면 서버가 준 안내 문구를 그대로 보여 주고, 계산 화면은 그대로 쓸 수 있다.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { api, cached } from '../api/client'
import { askServer, buildAskBody, stageOf, STAGE_NAME } from '../api/ask'
import { historyOf, useStore, type ChatMsg, type ToolCallMsg } from '../store'
import { Tools, type ToolCall } from '../ui/Tools'
import { Md } from '../ui/Md'
import { hidePendingRefs } from '../ui/mdText'
import { Basis } from '../ui/Basis'

const TOOL_MIN = 900 // 도구 한 개를 '계산 중'으로 보여 주는 최소 시간(ms)

export function ChatDock({ code }: { code: string }) {
  const s = useStore()
  const stage = stageOf(useLocation().pathname)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [agent, setAgent] = useState<boolean | null>(null) // null = 아직 모름
  const [examples, setExamples] = useState<string[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  // 열 때: 에이전트를 쓸 수 있는지(health)와 이 단계의 예시 질문(서버가 주고, 모델을 부르지 않는다)
  useEffect(() => {
    if (!s.chatOpen) return
    let live = true
    cached('health', () => api.health()).then((h) => live && setAgent(h.agent), () => live && setAgent(null))
    cached(`examples:${code}`, () => api.examples(code)).then((e) => live && setExamples(e.examples[stage] ?? []), () => live && setExamples([]))
    return () => { live = false }
  }, [s.chatOpen, code, stage])
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [s.chat])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async (q: string) => {
    q = q.trim()
    const st = useStore.getState()
    if (!q || busy || !st.state) return
    if (q.length > 300) {
      st.set({ chat: [...st.chat, { role: 'user', text: q }, { role: 'ai', text: '질문을 300자 안으로 짧게 다시 써 주세요.', tools: [], error: true }] })
      return
    }
    setInput('')
    setBusy(true)
    const sent = st.state
    const body = buildAskBody({ code, state: sent, stage, question: q, history: historyOf(st.chat) })
    // 말풍선을 먼저 하나 놓고, 이벤트가 오는 대로 마지막 말풍선을 고친다
    st.set({ chat: [...st.chat, { role: 'user', text: q }, { role: 'ai', text: '', tools: [] }] })
    const edit = (fn: (m: Extract<ChatMsg, { role: 'ai' }>) => Extract<ChatMsg, { role: 'ai' }>) => {
      const chat = useStore.getState().chat
      const last = chat[chat.length - 1]
      if (last?.role === 'ai') useStore.getState().set({ chat: [...chat.slice(0, -1), fn(last)] })
    }
    const ac = (abort.current = new AbortController())
    let changed = false // state 이벤트로 화면 값을 이미 바꿨는지
    for await (const ev of askServer(body, ac.signal)) {
      if (ev.type === 'tool_call') edit((m) => ({ ...m, tools: [...m.tools, { id: ev.id, label: ev.label }] }))
      else if (ev.type === 'tool_result') edit((m) => ({ ...m, tools: m.tools.map((t) => (t.id === ev.id ? { ...t, result: ev.result } : t)) }))
      else if (ev.type === 'text') edit((m) => ({ ...m, text: m.text + ev.delta }))
      else if (ev.type === 'clarify') edit((m) => ({ ...m, options: ev.options }))
      else if (ev.type === 'state') { changed = true; useStore.getState().set({ state: ev.state }) } // 실패하기 전에 온 state도 서버가 끝낸 정상 값이라 그대로 둔다
      else if (ev.type === 'done') {
        // state 이벤트를 못 받았어도 done의 state가 보낸 것과 다르면 반영한다(바꾼 것이 없으면 보낸 state 그대로 온다)
        if (!changed && JSON.stringify(ev.state) !== JSON.stringify(sent)) useStore.getState().set({ state: ev.state })
        if (typeof ev.remainingToday === 'number') useStore.getState().set({ remainingToday: ev.remainingToday })
        edit((m) => ({ ...m, cached: ev.cached }))
      } else if (ev.type === 'error') {
        edit((m) => ({ ...m, error: true, text: m.text ? `${m.text}\n\n${ev.message}` : ev.message }))
        if (ev.error === 'agent_unavailable') setAgent(false)
      }
    }
    // 끝 이벤트 없이 멈췄는데 말풍선이 비어 있으면(창을 닫아 멈춘 경우) 치운다
    const last = useStore.getState().chat.at(-1)
    if (last?.role === 'ai' && !last.text && !last.tools.length) useStore.getState().set({ chat: useStore.getState().chat.slice(0, -1) })
    setBusy(false)
  }

  const off = agent === false
  return (
    <>
      <AnimatePresence>
        {!s.chatOpen && (
          <motion.button className="ai-fab no-print" onClick={() => s.set({ chatOpen: true })} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <span className="spark">✦</span> AI에게 물어보기
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s.chatOpen && (
          <motion.section className="dock no-print" initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <header>
              <b><span className="spark">✦</span> 예산 질의 AI</b>
              <span className="muted small">{STAGE_NAME[stage]} 단계{s.remainingToday != null ? ` · 오늘 ${s.remainingToday}번 더 물어볼 수 있어요` : ''}</span>
              <button className="close" onClick={() => s.set({ chatOpen: false })} aria-label="닫기">×</button>
            </header>
            <Basis className="basis" style={{ margin: 0, padding: '6px 16px', borderTop: 0, borderBottom: '1px solid var(--gray-2)' }} />
            <div className="msgs" ref={listRef}>
              {off && <p className="check bad" role="status">지금은 에이전트를 쓸 수 없어요. 계산 화면은 그대로 쓸 수 있어요.</p>}
              {!s.chat.length && !off && <p className="muted small">숫자는 서버가 계산한 결과만 써서 답해요. 답에 따라 예산이나 기준이 바뀌면 화면이 바로 다시 그려져요.</p>}
              {s.chat.map((msg, i) => msg.role === 'user'
                ? <motion.p key={i} className="me" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{msg.text}</motion.p>
                : <AiMsg key={i} id={`chat${i}`} msg={msg} last={i === s.chat.length - 1} busy={busy} onPick={(t) => void send(t)} />)}
            </div>
            {!!examples.length && !off && (
              <div className="suggest">
                <span className="muted small">이렇게 물어볼 수 있어요</span>
                <div className="sugg-list">
                  {examples.map((q) => <button key={q} disabled={busy} onClick={() => send(q)}>{q}</button>)}
                </div>
              </div>
            )}
            <form onSubmit={(e) => { e.preventDefault(); void send(input) }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={300} placeholder={off ? '지금은 질문할 수 없어요' : '말로 물어보세요'} disabled={busy || off} aria-label="AI에게 질문" />
              <button className="primary" disabled={busy || off || !input.trim()}>보내기</button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

function AiMsg({ id, msg, last, busy, onPick }: { id: string; msg: Extract<ChatMsg, { role: 'ai' }>; last: boolean; busy: boolean; onPick: (text: string) => void }) {
  const streaming = last && busy
  // 서버 답이 빨라도 도구마다 TOOL_MIN만큼은 ✓ 자리에 돌아가는 표시가 보인 뒤에 ✓와 결과가 나온다.
  const reduce = useReducedMotion() === true
  const seen = useRef(new Map<string, number>())
  const [done, setDone] = useState<Set<string>>(() => (streaming ? new Set() : new Set(msg.tools.filter((t) => t.result).map((t) => t.id))))
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const t of msg.tools) {
      if (!seen.current.has(t.id)) seen.current.set(t.id, Date.now())
      if (t.result && !done.has(t.id)) {
        const wait = reduce ? 0 : Math.max(0, TOOL_MIN - (Date.now() - seen.current.get(t.id)!))
        timers.push(setTimeout(() => setDone((d) => new Set(d).add(t.id)), wait))
      }
    }
    return () => timers.forEach(clearTimeout)
  }, [msg.tools, done, reduce])
  const running = (t: ToolCallMsg) => !done.has(t.id) && (streaming || !!t.result) // 결과가 이미 왔어도 최소 시간 동안은 계산 중으로 보인다
  const working = msg.tools.some(running)
  // 도구가 다 끝나면 답 글이 타이핑하듯 쭉 나온다(방금 만든 말풍선만. 지난 대화는 바로 다 보인다)
  const live = useRef(streaming).current
  const [typed, setTyped] = useState(live && !reduce ? 0 : Infinity)
  const typing = live && typed < msg.text.length
  useEffect(() => {
    if (!typing || working) return
    const id = setInterval(() => setTyped((n) => Math.min(msg.text.length, n + 3)), 18)
    return () => clearInterval(id)
  }, [typing, working, msg.text.length])
  // 예산안 만들기와 같은 도구 칩(돌아가는 표시 → ✓). 도구가 오기 전에는 '질문을 읽는 중' 한 줄이 돈다
  const calls: ToolCall[] = msg.tools.map((t) => ({ id: t.id, label: t.label, state: done.has(t.id) ? 'done' : running(t) ? 'run' : 'wait', result: t.result }))
  if (streaming && !msg.tools.length && !msg.text) calls.push({ id: 'pending', label: '질문을 읽는 중', state: 'run' })
  return (
    <motion.div className={`ai ${msg.error ? 'err' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {calls.length > 0 && <div className="dock-tools"><Tools calls={calls} /></div>}
      {/* 답은 HTML이 아니라 마크다운 글이다(줄바꿈 · 목록 · 표 · 각주). 글이 흘러오는 중엔 정의가 아직 안 온 각주 표시를 감춘다 */}
      {msg.text && !working && (msg.error ? <p style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</p> : <Md text={streaming || typing ? hidePendingRefs(msg.text.slice(0, typed)) : msg.text} prefix={id} />)}
      {msg.options && last && !busy && (
        <div className="sugg-list" style={{ marginTop: 8 }}>
          {msg.options.map((o) => <button key={o} onClick={() => onPick(o)}>{o}</button>)}
        </div>
      )}
      {msg.cached && <p className="muted small" style={{ margin: '4px 0 0' }}>앞서 만든 답이에요 (횟수에 안 세요)</p>}
    </motion.div>
  )
}
