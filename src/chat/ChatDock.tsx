// 오른쪽 아래 'AI에게 물어보기' 버튼과 질문 창. 질문은 서버 에이전트(POST /api/ask)가 답하고, 도구가 바꾼 state를 함께 돌려주면 지금 화면이 그 state로 다시 그려진다.
// 에이전트를 쓸 수 없거나(키 없음 · 하루 비용 상한 · 동시 실행 상한) 횟수를 다 쓰면 서버가 준 안내 문구를 그대로 보여 주고, 계산 화면은 그대로 쓸 수 있다.
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { api, ApiError, cached } from '../api/client'
import type { Stage } from '../api/types'
import { errText, historyOf, useStore, type ChatMsg } from '../store'

const stageOf = (path: string): Stage => (/\/report$/.test(path) ? 'memo' : /\/(sim|result|whatif)$/.test(path) ? 'alt' : 'diag')
const STAGE_NAME: Record<Stage, string> = { diag: '현황 진단', alt: '대안', memo: '검토 메모' }

export function ChatDock({ code }: { code: string }) {
  const s = useStore()
  const stage = stageOf(useLocation().pathname)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [examples, setExamples] = useState<string[]>([])
  const [agent, setAgent] = useState<boolean | null>(null) // null = 아직 모름
  const listRef = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)

  // 열 때 한 번: 에이전트를 쓸 수 있는지(health)와 이 단계의 예시 질문
  useEffect(() => {
    if (!s.chatOpen) return
    let live = true
    cached('health', () => api.health()).then((h) => live && setAgent(h.agent || (h.examples[code] ?? 0) > 0), () => live && setAgent(null))
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
    const history = historyOf(st.chat)
    st.set({ chat: [...st.chat, { role: 'user', text: q }] })
    const ac = (abort.current = new AbortController())
    const timer = setTimeout(() => ac.abort(), 45_000) // 서버는 40초 안에 답한다
    let reply: ChatMsg
    try {
      const a = await api.ask({ region: code, state: st.state, stage, question: q, history }, ac.signal)
      reply = { role: 'ai', text: a.answer, tools: a.toolLog.map((l, i) => ({ id: String(i), label: l.replace(/^▸\s*/, '') })) }
      // 도구가 바꾼 state로 화면을 다시 그린다 (예산 · 목표 · 기준 등)
      useStore.getState().set({ state: a.state, remainingToday: a.remainingToday })
    } catch (e) {
      const timeout = (e as Error).name === 'AbortError'
      reply = { role: 'ai', text: timeout ? '답이 늦어지고 있어요. 다시 물어봐 주세요.' : errText(e), tools: [], error: true }
      if (e instanceof ApiError && e.code === 'agent_unavailable') setAgent(false)
    } finally { clearTimeout(timer) }
    useStore.getState().set({ chat: [...useStore.getState().chat, reply] })
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
                : <AiMsg key={i} msg={msg} />)}
              {busy && <p className="muted small" role="status"><span className="spin" /> 답을 만들고 있어요…</p>}
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

function AiMsg({ msg }: { msg: Extract<ChatMsg, { role: 'ai' }> }) {
  const [open, setOpen] = useState(true)
  return (
    <motion.div className={`ai ${msg.error ? 'err' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {msg.tools.length > 0 && (
        <div className="dock-tools">
          <button className="tools-head" onClick={() => setOpen(!open)}>계산 도구 {msg.tools.length}번 호출 {open ? '▴' : '▾'}</button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {msg.tools.map((t) => <li key={t.id}><span className="ok">✓</span><code>{t.label}</code></li>)}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      {/* answer는 HTML이 아니라 글이다: 그대로 텍스트로 넣는다 */}
      <p style={{ whiteSpace: 'pre-wrap' }}>{msg.error ? msg.text : highlightNumbers(msg.text)}</p>
    </motion.div>
  )
}

// 답 속 숫자를 눈에 띄게 (모두 서버가 계산한 숫자다)
function highlightNumbers(text: string) {
  return text.split(/(\d[\d,.]*\s*(?:%|억|명|분|곳|대|점|배|번)?)/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}
