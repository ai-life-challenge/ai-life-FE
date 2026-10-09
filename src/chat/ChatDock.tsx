// 오른쪽 아래 'AI에게 물어보기' 버튼과 질문 창 (VillageCoverage 시제품과 같은 UI). 대화는 화면을 옮겨도 이어지고,
// 답에 따라 예산·목표·단가가 바뀌면 지금 화면이 바로 다시 계산된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { ask, suggestAsk, type AgentCtx, type Patch, type Screen } from '../api/agent'
import { regionOf } from '../data/regions'
import { planSet } from '../sim/model'
import { useStore, type ChatMsg } from '../store'

const screenOf = (path: string): Screen => (/\/goal$/.test(path) ? 'goal' : /\/sim$/.test(path) ? 'sim' : /\/result$/.test(path) ? 'result' : /\/whatif$/.test(path) ? 'whatif' : /\/report$/.test(path) ? 'report' : 'diag')

export function ChatDock({ code }: { code: string }) {
  const s = useStore()
  const screen = screenOf(useLocation().pathname)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<AgentCtx['pending']>(null)
  const [lastIntent, setLastIntent] = useState<Parameters<typeof suggestAsk>[1]>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const asked = useMemo(() => new Set(s.chat.filter((c) => c.role === 'user').map((c) => c.text)), [s.chat])
  const region = regionOf(code)

  const ctx = (): AgentCtx | null => {
    const st = useStore.getState()
    if (!region) return null
    const minMed = st.minMedOn ? st.minMed : 0
    return { region, screen, budget: st.budget, main: st.main, level: st.level, costs: st.costs, minMed, plans: planSet(region, st.budget, st.costs, st.level, minMed), pending }
  }
  const c = useMemo(ctx, [region, screen, s.budget, s.main, s.level, s.costs, s.minMedOn, s.minMed, pending])
  const suggestions = c ? suggestAsk(c, lastIntent, asked) : []

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [s.chat])

  const apply = (p: Patch) => {
    if (p.pending !== undefined) setPending(p.pending)
    const next: Partial<ReturnType<typeof useStore.getState>> = {}
    if (p.budget != null) next.budget = p.budget
    if (p.main) next.main = p.main
    if (p.level) next.level = p.level
    if (p.aiPick) next.aiPick = p.aiPick
    if (p.detail !== undefined) { next.detail = p.detail; next.replay = useStore.getState().replay + 1 }
    useStore.getState().set(next)
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
      else if (e.type === 'done') { setLastIntent(e.intent); update((m) => { m.streaming = false }) }
    }
    setBusy(false)
  }

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
              <span className="muted small">답에 맞춰 예산안이 다시 계산돼요</span>
              <button className="close" onClick={() => s.set({ chatOpen: false })} aria-label="닫기">×</button>
            </header>
            <div className="msgs" ref={listRef}>
              {!s.chat.length && <p className="muted small">숫자는 계산 도구의 결과만 써서 답해요. 시제품은 정해진 규칙으로 흉내 내고, 실제 서비스는 AI 에이전트가 같은 도구(diagnose · optimize · compare)를 불러 답해요.</p>}
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
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={pending ? '골라 주세요' : screen === 'goal' ? '예) 어르신들이 응급실 가는 시간을 줄이고 싶어요' : '말로 물어보세요'} disabled={busy} aria-label="AI에게 질문" />
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
        <div className="dock-tools">
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
  return text.split(/(\d[\d,.]*\s*(?:%|억|명|분|곳|대|점|배)?)/).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))
}
