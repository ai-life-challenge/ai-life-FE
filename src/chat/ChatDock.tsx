// 오른쪽 아래 AI 질문 창. 진단·대안·메모 화면에서 같이 쓰고, 대화는 화면을 옮겨도 이어진다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ask, suggest, type AgentCtx, type Patch, type Screen } from '../api/agent'
import { goalOf, plansFor, useStore, type ChatMsg } from '../store'

export function ChatDock({ screen }: { screen: Screen }) {
  const s = useStore()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<AgentCtx['pending']>(null)
  const [lastIntent, setLastIntent] = useState<Parameters<typeof suggest>[1]>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const asked = useMemo(() => new Set(s.chat.filter((c) => c.role === 'user').map((c) => c.text)), [s.chat])

  const ctx = (): AgentCtx | null => {
    const st = useStore.getState()
    if (!st.model) return null
    const goal = goalOf(st)
    return { screen, model: st.model, goal, assume: st.assume, plans: plansFor(st.model, goal, st.assume), pending }
  }
  const c = ctx()
  const suggestions = c ? suggest(c, lastIntent, asked) : []

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [s.chat])

  const apply = (p: Patch) => {
    const st = useStore.getState()
    if (p.pending !== undefined) setPending(p.pending)
    const next: Partial<ReturnType<typeof useStore.getState>> = {}
    if (p.target != null) next.target = p.target
    if (p.budget != null) next.budget = p.budget
    if (p.age) next.age = p.age
    if (p.service) next.service = p.service
    if (p.threshold != null && p.service) next.thresholds = { ...st.thresholds, [p.service]: p.threshold }
    if (p.tele != null) next.assume = { ...st.assume, tele: p.tele }
    if (p.planShow !== undefined) { next.planShow = p.planShow; next.replay = st.replay + 1 }
    if (p.memo) {
      const mm = { ...st.memo, overrides: { ...st.memo.overrides }, version: st.memo.version + 1 }
      if (p.memo.recPlan !== undefined) { mm.recPlan = p.memo.recPlan; delete mm.overrides.rec }
      if (p.memo.summaryLine) mm.summaryLine = true
      if (p.memo.shortRec) { mm.shortRec = true; delete mm.overrides.rec }
      if (p.memo.addLimit && !mm.extraLimits.includes(p.memo.addLimit)) { mm.extraLimits = [...mm.extraLimits, p.memo.addLimit]; delete mm.overrides.limits }
      next.memo = mm
    }
    st.set(next)
  }

  const send = async (q: string) => {
    const cx = ctx()
    if (!q.trim() || busy || !cx) return
    setInput('')
    setBusy(true)
    const st = useStore.getState()
    const ai: Extract<ChatMsg, { role: 'ai' }> = { role: 'ai', text: '', tools: [], streaming: true }
    st.set({ chat: [...st.chat, { role: 'user', text: q }, ai] })
    const update = (f: (m: typeof ai) => void) => {
      f(ai)
      const chat = useStore.getState().chat.slice()
      chat[chat.length - 1] = { ...ai, tools: ai.tools.map((t) => ({ ...t })) }
      useStore.getState().set({ chat })
    }
    if (pending) setPending(null)
    for await (const e of ask(q, cx)) {
      if (e.type === 'tool_call') update((m) => m.tools.push({ id: e.id, label: e.label }))
      else if (e.type === 'tool_result') update((m) => { const t = m.tools.find((x) => x.id === e.id); if (t) t.result = e.result })
      else if (e.type === 'text') update((m) => { m.text += e.delta })
      else if (e.type === 'clarify') update((m) => { m.clarify = e.options })
      else if (e.type === 'basis') update((m) => { m.basis = e.text })
      else if (e.type === 'apply') apply(e.patch)
      else if (e.type === 'done') { setLastIntent(e.intent as never); update((m) => { m.streaming = false }) }
    }
    setBusy(false)
  }

  return (
    <>
      <AnimatePresence>
        {!s.chatOpen && (
          <motion.button className="ai-fab" onClick={() => s.set({ chatOpen: true })} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
            <span className="spark">✦</span> AI에게 물어보기
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {s.chatOpen && (
          <motion.section className="dock" initial={{ y: 40, opacity: 0, scale: 0.97 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 30, opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <header>
              <b><span className="spark">✦</span> 정책 질의 AI</b>
              <span className="muted small">{screen === 'memo' ? '메모를 고쳐 달라고 해 보세요' : '답에 맞춰 대안이 다시 계산돼요'}</span>
              <button className="close" onClick={() => s.set({ chatOpen: false })} aria-label="닫기">×</button>
            </header>
            <div className="msgs" ref={listRef}>
              {!s.chat.length && <p className="muted small">숫자는 계산 도구의 결과만 써서 답해요. 시제품은 정해진 규칙으로 흉내 내고, 실제 서비스는 Claude 에이전트가 같은 도구를 불러 답해요.</p>}
              {s.chat.map((msg, i) => msg.role === 'user'
                ? <motion.p key={i} className="me" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{msg.text}</motion.p>
                : <AiMsg key={i} msg={msg} onPick={send} />)}
            </div>
            <div className="suggest">
              <span className="muted small">이렇게 물어볼 수 있어요</span>
              <motion.div className="sugg-list" layout>
                <AnimatePresence mode="popLayout">
                  {suggestions.map((q, k) => (
                    <motion.button key={q} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: k * 0.05 } }} exit={{ opacity: 0, scale: 0.9 }} disabled={busy} onClick={() => send(q)}>
                      {q}
                    </motion.button>
                  ))}
                </AnimatePresence>
              </motion.div>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(input) }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={pending ? '예: 90%' : '말로 물어보세요'} disabled={busy} />
              <button className="primary" disabled={busy || !input.trim()}>보내기</button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}

function AiMsg({ msg, onPick }: { msg: Extract<ChatMsg, { role: 'ai' }>; onPick: (q: string) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <motion.div className="ai" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
      {msg.tools.length > 0 && (
        <div className="tools">
          <button className="tools-head" onClick={() => setOpen(!open)}>계산 도구 {msg.tools.length}번 호출 {open ? '▴' : '▾'}</button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                {msg.tools.map((t) => (
                  <motion.li key={t.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                    <span className={t.result ? 'ok' : 'spin'}>{t.result ? '✓' : ''}</span>
                    <code>{t.label}</code>
                    {t.result && <span className="muted"> → {t.result}</span>}
                  </motion.li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
      )}
      {(msg.text || msg.streaming) && <p>{highlightNumbers(msg.text)}{msg.streaming && <span className="caret" />}</p>}
      {msg.clarify && !msg.streaming && (
        <div className="clarify">{msg.clarify.map((o) => <button key={o} onClick={() => onPick(o)}>{o}</button>)}</div>
      )}
      {msg.basis && !msg.streaming && <p className="basis">{msg.basis}</p>}
    </motion.div>
  )
}

// 답 속 숫자를 눈에 띄게 (모두 도구 결과에서 온 숫자다)
function highlightNumbers(text: string) {
  return text.split(/(\d[\d,.]*\s*(?:%|억|명|분|곳|대)?)/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}
