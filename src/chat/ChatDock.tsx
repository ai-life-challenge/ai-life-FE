// 오른쪽 아래 'AI에게 물어보기' 버튼과 질문 창. 질문은 서버 에이전트(POST /api/ask)가 SSE로 답한다(api/ask.ts).
// 도구 호출 · 글(마크다운, 표와 각주 포함) · 되묻기 버튼이 오는 대로 말풍선에 이어 붙이고, 도구가 화면 값을 바꾸면(state 이벤트) 지금 화면이 그 state로 다시 그려진다.
// 에이전트를 쓸 수 없거나(키 없음 · 하루 비용 상한 · 동시 실행 상한) 횟수를 다 쓰면 서버가 준 안내 문구를 그대로 보여 주고, 계산 화면은 그대로 쓸 수 있다.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { api, cached } from '../api/client'
import { askServer, buildAskBody, stageOf, STAGE_NAME } from '../api/ask'
import { historyOf, useStore, type ChatMsg } from '../store'
import { Md } from '../ui/Md'
import { hidePendingRefs } from '../ui/mdText'

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
            <div className="msgs" ref={listRef}>
              {off && <p className="check bad" role="status">지금은 에이전트를 쓸 수 없어요. 계산 화면은 그대로 쓸 수 있어요.</p>}
              {!s.chat.length && !off && <p className="muted small">숫자는 서버가 계산한 결과만 써서 답해요. 답에 따라 예산이나 기준이 바뀌면 화면이 바로 다시 그려져요.</p>}
              {s.chat.map((msg, i) => msg.role === 'user'
                ? <motion.p key={i} className="me" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{msg.text}</motion.p>
                : <AiMsg key={i} id={`chat${i}`} msg={msg} last={i === s.chat.length - 1} busy={busy} onPick={(t) => void send(t)} />)}
              {busy && !s.chat.at(-1)?.text && <p className="muted small" role="status"><span className="spin" /> 답을 만들고 있어요…</p>}
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
  const [open, setOpen] = useState(true)
  const streaming = last && busy
  return (
    <motion.div className={`ai ${msg.error ? 'err' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {msg.tools.length > 0 && (
        <div className="dock-tools">
          <button className="tools-head" onClick={() => setOpen(!open)}>계산 도구 {msg.tools.length}번 호출 {open ? '▴' : '▾'}</button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {msg.tools.map((t) => <li key={t.id}><span className={t.result ? 'ok' : 'muted'}>{t.result ? '✓' : '…'}</span><code>{t.label}</code>{t.result && <span className="muted small"> → {t.result}</span>}</li>)}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      {/* 답은 HTML이 아니라 마크다운 글이다(줄바꿈 · 목록 · 표 · 각주). 글이 흘러오는 중엔 정의가 아직 안 온 각주 표시를 감춘다 */}
      {msg.text && (msg.error ? <p style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</p> : <Md text={streaming ? hidePendingRefs(msg.text) : msg.text} prefix={id} />)}
      {msg.options && last && !busy && (
        <div className="sugg-list" style={{ marginTop: 8 }}>
          {msg.options.map((o) => <button key={o} onClick={() => onPick(o)}>{o}</button>)}
        </div>
      )}
      {msg.cached && <p className="muted small" style={{ margin: '4px 0 0' }}>앞서 만든 답이에요 (횟수에 안 세요)</p>}
    </motion.div>
  )
}
