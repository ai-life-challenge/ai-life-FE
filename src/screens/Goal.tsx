// S3 목표·예산 입력: 자연어 목표 → AI가 가장 가까운 프리셋에 추천 배지, 프리셋 3개 카드, 총예산 슬라이더, 고급 설정(분야 최소 보장).
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { regionOf } from '../data/regions'
import { PRESETS, preset, type PresetId } from '../sim/model'
import { mapGoal, type AgentEvent } from '../api/agent'
import { useStore } from '../store'
import { fmt } from '../motion/useCountUp'
import { AiBadge } from '../ui/Badges'
import { Tools, type ToolCall } from '../ui/Tools'

const EXAMPLES = ['어르신들이 응급실 가는 시간을 줄이고 싶어요', '교통사고 사망을 줄이고 싶어요', '버스가 너무 안 와요', '병원도 멀고 사고도 많아요']

export function Goal() {
  const { code } = useParams()
  const nav = useNavigate()
  const r = regionOf(code)!
  const s = useStore()
  const [text, setText] = useState(s.goalText)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<{ tools: ToolCall[]; text: string; clarify?: Extract<AgentEvent, { type: 'clarify' }> } | null>(null)

  const ask = async (q: string) => {
    if (!q.trim() || busy) return
    setBusy(true)
    s.set({ goalText: q })
    let cur: NonNullable<typeof reply> = { tools: [], text: '' }
    const push = (p: Partial<typeof cur>) => { cur = { ...cur, ...p }; setReply(cur) }
    push({})
    for await (const ev of mapGoal(q)) {
      if (ev.type === 'tool_call') push({ tools: [...cur.tools, { id: ev.id, label: ev.label, state: 'run' }] })
      else if (ev.type === 'tool_result') push({ tools: cur.tools.map((t) => (t.id === ev.id ? { ...t, state: 'done', result: ev.result, detail: `입력: "${q}"\n결과: ${ev.result}` } : t)) })
      else if (ev.type === 'text') push({ text: cur.text + ev.delta })
      else if (ev.type === 'clarify') push({ clarify: ev })
      else if (ev.type === 'apply') useStore.getState().set({ aiPick: { preset: ev.preset, reason: ev.reason }, main: ev.preset })
    }
    setBusy(false)
  }
  const choose = (id: PresetId) => s.set({ main: id })
  const perCapita = (s.budget * 1e8) / r.pop / 1e4

  return (
    <motion.main className="page narrow" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <p className="eyebrow">3단계 · 목표와 예산 · {r.name}</p>
      <h1>무엇을 가장 개선하고 싶으세요?</h1>

      <form className="ask" onSubmit={(e) => { e.preventDefault(); ask(text) }}>
        <span className="bubble" aria-hidden>💬</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="예) 어르신들이 응급실 가는 시간을 줄이고 싶어요" aria-label="개선하고 싶은 점"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); ask(text) } }} />
        <button className="primary" disabled={busy || !text.trim()}>AI에게 묻기</button>
      </form>
      <div className="chips" style={{ marginTop: 8 }}>
        {EXAMPLES.map((q) => <button key={q} className="chip" onClick={() => { setText(q); ask(q) }} disabled={busy}>{q}</button>)}
      </div>

      <AnimatePresence>
        {reply && (
          <motion.div className="ai-reply" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="row"><AiBadge>목표 해석</AiBadge></div>
            <Tools calls={reply.tools} />
            {reply.text && <p>{reply.text}{busy && <span className="caret" />}</p>}
            {reply.clarify && !busy && (
              <div className="chips">
                {reply.clarify.options.map((o) => (
                  <button key={o.label} className="chip dark" onClick={() => { s.set({ main: o.preset, aiPick: { preset: o.preset, reason: `‘${o.label}’를 고르셨어요` } }); setReply({ ...reply, clarify: undefined, text: `${reply.text}\n→ ${o.label}: ‘${preset(o.preset).icon} ${preset(o.preset).name}’으로 정했어요.` }) }}>{o.label}</button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <p className="or">또는 목표를 직접 고르세요</p>
      <div className="grid3">
        {PRESETS.map((p) => (
          <motion.button key={p.id} className={`preset ${s.main === p.id ? 'on' : ''}`} onClick={() => choose(p.id)} whileTap={{ scale: 0.98 }} aria-pressed={s.main === p.id}>
            <span className="ico" aria-hidden>{p.icon}</span>
            <b>{p.name}</b>
            <span className="muted small">의료 {Math.round(p.gamma * 100)}% · 교통 {Math.round((1 - p.gamma) * 100)}%</span>
            <span className="mix" aria-hidden><span style={{ width: `${p.gamma * 100}%` }} /></span>
            {s.aiPick?.preset === p.id && <motion.span layoutId="ai-pick" className="ai-pick"><AiBadge>추천</AiBadge></motion.span>}
          </motion.button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>※ 고른 목표가 ‘주 시나리오’가 되지만, 3개 모두 계산해서 비교해 드려요.</p>

      <div className="slider-box">
        <div className="row">
          <b>총예산</b><span className="spacer" />
          <span className="big num">{fmt(s.budget)}<small>억</small></span>
        </div>
        <input type="range" min={10} max={300} step={5} value={s.budget} onChange={(e) => s.set({ budget: +e.target.value })} aria-label="총예산(억 원)" />
        <div className="slider-ends"><span>10억</span><span>주민 1인당 약 <b className="num">{perCapita.toFixed(perCapita < 10 ? 1 : 0)}만 원</b></span><span>300억</span></div>
      </div>

      <details className="adv">
        <summary>고급 설정: 분야 최소 보장 [{s.minMedOn ? `켬 · 의료 ${Math.round(s.minMed * 100)}% 이상` : '끔'}]</summary>
        <div className="adv-body">
          <label className="switch"><input type="checkbox" checked={s.minMedOn} onChange={(e) => s.set({ minMedOn: e.target.checked })} /> 의료 분야에 최소 금액을 보장</label>
          {s.minMedOn && (
            <label className="row">의료 최소 비율 <input type="range" min={0.1} max={0.7} step={0.05} value={s.minMed} onChange={(e) => s.set({ minMed: +e.target.value })} style={{ flex: 1 }} /> <b className="num">{Math.round(s.minMed * 100)}%</b></label>
          )}
          <p className="muted small" style={{ margin: 0 }}>기본은 꺼 둬요. 효과가 체감하는 함수라 제약 없이도 예산이 자연스럽게 나뉘어요. 정책 의지를 넣고 싶을 때만 켜세요.</p>
        </div>
      </details>

      <div className="next-row">
        <button className="ghost" onClick={() => nav(`/r/${r.code}`)}>← 현황 진단</button>
        <button className="primary big-btn" onClick={() => nav(`/r/${r.code}/sim`)}>✦ AI로 예산안 만들기 →</button>
      </div>
    </motion.main>
  )
}
