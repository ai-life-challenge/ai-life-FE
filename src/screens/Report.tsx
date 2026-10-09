// S8 AI 레포트: 섹션 제목이 먼저 깔리고 본문이 스트리밍으로 채워진다. 숫자에 마우스를 올리면 그 숫자를 낸 도구 결과가 보이고,
// 작성이 끝나면 숫자 대조 체크가 하나씩 찍힌다. 문단은 눌러서 고치고, 인쇄 CSS로 PDF 저장, 링크 복사로 같은 조건을 공유한다.
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { DATA_SOURCES, regionOf } from '../data/regions'
import { LEVERS, PRESETS, preset, type CostLevel, type PresetId } from '../sim/model'
import { buildReport, numsOf, segText, type Seg } from '../api/report'
import { useStore } from '../store'
import { tween } from '../motion/tween'
import { fmt } from '../motion/useCountUp'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Tools, type ToolCall } from '../ui/Tools'

const today = new Date().toLocaleDateString('sv-SE')
const typed = new Set<string>() // 이미 타이핑을 보여 준 조건 (다시 들어오면 바로 보여 준다)

export function Report() {
  const { code } = useParams()
  const [q] = useSearchParams()
  const r = regionOf(code)!
  const s = useStore()
  const reduce = useReducedMotion()

  // 공유 링크(?b=&p=&c=)로 들어오면 그 조건을 먼저 적용한다
  useEffect(() => {
    const b = Number(q.get('b')), p = q.get('p') as PresetId, c = q.get('c') as CostLevel
    const patch: Partial<typeof s> = {}
    if (b >= 10 && b <= 300) patch.budget = b
    if (PRESETS.some((x) => x.id === p)) patch.main = p
    if (c === 'low' || c === 'mid' || c === 'high') patch.level = c
    if (Object.keys(patch).length) useStore.getState().set(patch)
  }, [q])

  const minMed = s.minMedOn ? s.minMed : 0
  const rep = useMemo(() => buildReport(r, s.budget, s.main, s.costs, s.level, minMed), [r, s.budget, s.main, s.costs, s.level, minMed])
  const key = JSON.stringify([r.code, s.budget, s.main, s.costs, s.level, minMed])
  const overrides = s.report.key === key ? s.report.overrides : {}

  // 진행: 도구 칩(0.9초) → 본문 타이핑 → 숫자 대조 체크
  const totalChars = rep.sections.reduce((a, x) => a + segText(x.segs).length, 0)
  const instant = reduce || typed.has(key)
  const [phase, setPhase] = useState<'tools' | 'write' | 'done'>(instant ? 'done' : 'tools')
  const [chars, setChars] = useState(instant ? totalChars : 0)
  const numCount = rep.sections.reduce((a, x) => a + x.segs.filter((g) => typeof g !== 'string').length, 0)
  const [checked, setChecked] = useState(instant ? numCount : 0)
  useEffect(() => {
    if (instant) { setPhase('done'); setChars(totalChars); setChecked(numCount); return }
    setPhase('tools'); setChars(0); setChecked(0)
    let stop = () => {}
    const t = setTimeout(() => {
      setPhase('write')
      stop = tween(0, totalChars, Math.min(9000, totalChars * 7), (v) => setChars(Math.round(v)), {
        ease: (x) => x,
        onDone: () => { typed.add(key); setPhase('done'); stop = tween(0, numCount, 1400, (v) => setChecked(Math.round(v)), { ease: (x) => x }) },
      })
    }, 900)
    return () => { clearTimeout(t); stop() }
    // 조건(key)이 바뀌면 다시 쓴다
  }, [key])

  const tools: ToolCall[] = [
    { id: 'd', label: `diagnose(${r.name})`, state: 'done', result: '지표 6개' },
    { id: 'o', label: `optimize × 3 (${s.budget}억)`, state: 'done', result: PRESETS.map((p) => p.icon).join(' ') },
    { id: 'c', label: 'compare(3안)', state: 'done', result: `추천 ${preset(rep.rec.preset).name}` },
    { id: 'w', label: 'write_report(목차 6장)', state: phase === 'tools' ? 'wait' : phase === 'write' ? 'run' : 'done', result: `숫자 ${numCount}개 인용` },
  ]

  // 직접 고친 문단의 숫자가 계산 결과에 있는지
  const unknown = Object.values(overrides).flatMap((t) => numsOf(t).filter((n) => !rep.allowed.has(n)))
  const save = (id: string, text: string, original: string) => {
    const st = useStore.getState()
    const next = { ...(st.report.key === key ? st.report.overrides : {}) }
    if (text === original) delete next[id]
    else next[id] = text
    st.set({ report: { key, overrides: next } })
  }
  const [toast, setToast] = useState<string | null>(null)
  const copy = async () => {
    const url = `${location.origin}/r/${r.code}/report?b=${s.budget}&p=${s.main}&c=${s.level}`
    try { await navigator.clipboard.writeText(url); setToast('링크를 복사했어요') } catch { setToast(url) }
    setTimeout(() => setToast(null), 2200)
  }

  const starts = rep.sections.map((_, i) => rep.sections.slice(0, i).reduce((a, x) => a + segText(x.segs).length, 0))
  return (
    <motion.main className="report-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="report-bar">
        <div className="row">
          <span className="muted small">레포트 기준 목표</span>
          {PRESETS.map((p) => <button key={p.id} className={`chip ${s.main === p.id ? 'on' : ''}`} onClick={() => s.set({ main: p.id })}>{p.icon} {p.name}</button>)}
        </div>
        <div className="row">
          {phase === 'done' && (
            <motion.span key={unknown.length} className={`check ${unknown.length ? 'bad' : 'ok'}`} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              {unknown.length ? `⚠ 계산 결과에 없는 숫자 ${unknown.length}개: ${unknown.join(', ')}` : `숫자 대조 체크 ✓ ${checked}/${numCount}`}
            </motion.span>
          )}
          <button className="ghost" onClick={() => window.print()} disabled={phase !== 'done'}>PDF 저장</button>
          <button className="ghost" onClick={copy}>링크 복사</button>
        </div>
      </div>

      <motion.article className="paper" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}>
        <p className="muted small" style={{ margin: 0 }}>{today} · <span contentEditable suppressContentEditableWarning>○○군 기획예산과</span> <AiBadge>AI 초안</AiBadge> <LevelBadge level={r.level} /></p>
        <h1>{rep.title}</h1>
        <div className="no-print"><Tools calls={tools} /></div>
        {phase === 'write' && <p className="muted small no-print">◌ 레포트 작성 중… 숫자는 위 도구 결과에서만 가져와요.</p>}

        {rep.sections.map((sec, i) => {
          const text = segText(sec.segs)
          const n = Math.max(0, Math.min(text.length, chars - starts[i]))
          return (
            <section key={sec.id}>
              <h2>{sec.title} {sec.id in overrides && <span className="badge assume">직접 고침</span>}</h2>
              {(n > 0 || phase === 'done') && <SectionExtra id={sec.id} rep={rep} />}
              {/* 고친 문단은 DOM을 사용자가 바꿔 놓았으므로 React가 맞추지 않고 통째로 새로 그린다 */}
              <Para key={overrides[sec.id] ?? 'ai'} id={sec.id} segs={sec.segs} n={phase === 'done' ? text.length : n} typing={phase !== 'done'} override={overrides[sec.id]} onSave={(t) => save(sec.id, t, text)} />
            </section>
          )
        })}

        <p className="muted small" style={{ marginTop: 32 }}>문장은 AI 초안이고, 숫자와 표는 계산 결과에서 그대로 가져왔어요. 보라색 숫자에 마우스를 올리면 출처가 보이고, 문단을 눌러 고칠 수 있어요.</p>
      </motion.article>

      <AnimatePresence>{toast && <motion.div className="toast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{toast}</motion.div>}</AnimatePresence>
    </motion.main>
  )
}

// 문단: 타이핑 중엔 n글자까지만, 숫자 토큰은 하이라이트 + 출처 툴팁. 다 쓰면 눌러서 고친다
function Para({ id, segs, n, typing, override, onSave }: { id: string; segs: Seg[]; n: number; typing: boolean; override?: string; onSave: (t: string) => void }) {
  let left = n
  const out: React.ReactNode[] = []
  if (override != null) out.push(override)
  else segs.forEach((g, i) => {
    if (left <= 0) return
    const t = typeof g === 'string' ? g : g.n
    const shown = t.slice(0, left)
    left -= t.length
    out.push(typeof g === 'string' ? shown : <mark key={i} tabIndex={0}>{shown}<span className="tip" role="tooltip">출처 <code>{g.tip}</code></span></mark>)
  })
  return (
    <p className={`para ${typing ? 'typing' : ''}`} contentEditable={!typing} suppressContentEditableWarning data-id={id}
      onBlur={(e) => onSave(e.currentTarget.innerText.trim())}>
      {out}
      {typing && n > 0 && left < 0 && <span className="caret" />}
    </p>
  )
}

// 섹션에 붙는 표
function SectionExtra({ id, rep }: { id: string; rep: ReturnType<typeof buildReport> }) {
  if (id === 's2') return (
    <motion.table className="ltable" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <thead><tr><th>안</th>{LEVERS.map((l) => <th key={l.id} className="r">{l.short}</th>)}<th className="r">종합(전→후)</th><th className="r">수혜</th></tr></thead>
      <tbody>{rep.plans.map((p) => (
        <tr key={p.preset} className={p.recommended ? 'rec' : ''}>
          <td>{preset(p.preset).icon} {preset(p.preset).name}{p.recommended ? ' ⭐' : ''}</td>
          {LEVERS.map((l) => <td key={l.id} className="r">{p.opt.alloc[l.id]}</td>)}
          <td className="r">{Math.round(p.before.v)}→{Math.round(p.after.v)}</td><td className="r">{fmt(p.benefit)}</td>
        </tr>
      ))}</tbody>
    </motion.table>
  )
  if (id === 's5') return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <table className="ltable">
        <thead><tr><th>단가 (억 원/단위·년)</th><th className="r">저</th><th className="r">중</th><th className="r">고</th><th>근거</th></tr></thead>
        <tbody>{LEVERS.map((l) => (
          <tr key={l.id}>
            <td>{l.short} (1{l.unit})</td>
            <td className="r">{rep.costs[l.id].low}</td><td className="r">{rep.costs[l.id].mid}</td><td className="r">{rep.costs[l.id].high}</td>
            <td className="small">{l.sourceOk ? l.source : `⚠ 출처 확인 중 — ${l.source}`}</td>
          </tr>
        ))}</tbody>
      </table>
      <table className="ltable">
        <thead><tr><th>공공데이터</th><th>출처</th><th>기준일</th></tr></thead>
        <tbody>{DATA_SOURCES.map((d) => <tr key={d.id}><td>{d.label}</td><td className="small">{d.source}</td><td className="small">{d.date} (예시값)</td></tr>)}</tbody>
      </table>
    </motion.div>
  )
  if (id === 's6') return (
    <motion.table className="ltable" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <thead><tr><th>군</th><th className="r">종합</th><th className="r">의료</th><th className="r">교통</th><th className="r">수혜</th><th className="r">고령 가중 수혜</th><th>응급취약</th></tr></thead>
      <tbody>{rep.compare.map(({ r, p }) => (
        <tr key={r.code}>
          <td>{r.name}</td>
          <td className="r">{Math.round(p.before.v)}→{Math.round(p.after.v)}</td>
          <td className="r">{Math.round(p.before.mvi)}→{Math.round(p.after.mvi)}</td>
          <td className="r">{Math.round(p.before.tvi)}→{Math.round(p.after.tvi)}</td>
          <td className="r">{fmt(p.benefit)}</td>
          <td className="r">{fmt(p.benefit * (1 + r.elderly))}</td>
          <td>{p.vulnerableBefore ? (p.vulnerableAfter ? '유지' : '해제') : '해당 없음'}</td>
        </tr>
      ))}</tbody>
    </motion.table>
  )
  return null
}
