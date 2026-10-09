// S6 What-if: 예산을 바꾸면 증감분이 어느 정책으로 가는지 실시간으로. 새로 등장하는 정책은 ✨, 예산-효과 곡선에 체감 구간 표시.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { regionOf } from '../data/regions'
import { LEVERS, PRESETS, curve, optimize, preset, score, type PresetId } from '../sim/model'
import { usePlans, useStore, useUnitCost } from '../store'
import { explainWhatIf } from '../api/agent'
import { fmt } from '../motion/useCountUp'
import { AiBadge } from '../ui/Badges'

const BUDGETS = Array.from({ length: 13 }, (_, i) => i * 25) // 0~300억

export function WhatIf() {
  const { code } = useParams()
  const nav = useNavigate()
  const r = regionOf(code)!
  const s = useStore()
  const c = useUnitCost()
  const plans = usePlans(r)!
  const [pid, setPid] = useState<PresetId>(plans.find((p) => p.recommended)!.preset)
  const [raw, setRaw] = useState(Math.min(300, s.budget + 50))
  const [next, setNext] = useState(raw)
  useEffect(() => { const t = setTimeout(() => setNext(raw), 150); return () => clearTimeout(t) }, [raw])

  const p = preset(pid)
  const minMed = s.minMedOn ? s.minMed : 0
  const base = useMemo(() => optimize(r, p, s.budget, c, minMed), [r, p, s.budget, c, minMed])
  const nx = useMemo(() => optimize(r, p, next, c, minMed), [r, p, next, c, minMed])
  const pts = useMemo(() => curve(r, p, c, BUDGETS, minMed), [r, p, c, minMed])
  const v = { now: score(base.before, p).v, base: score(base.after, p).v, next: score(nx.after, p).v }
  const slope0 = (pts[0].v - pts[2].v) / 50
  const slopeRatio = Math.abs(next - s.budget) >= 1 ? (v.base - v.next) / (next - s.budget) / (slope0 || 1) : 1
  const knee = pts.findIndex((q, i) => i > 0 && (pts[i - 1].v - q.v) / 25 < slope0 * 0.5)

  const deltas = LEVERS.map((l) => ({ l, b: base.alloc[l.id], n: nx.alloc[l.id], d: nx.alloc[l.id] - base.alloc[l.id] })).filter((x) => Math.abs(x.d) >= 1).sort((a, b) => b.d - a.d)

  // 곡선 SVG
  const W = 460, H = 220, pad = 34
  const vMax = Math.max(...pts.map((q) => q.v)), vMin = Math.min(...pts.map((q) => q.v))
  const X = (B: number) => pad + ((W - pad - 14) * B) / 300
  const Y = (val: number) => 16 + ((H - pad - 16) * (vMax - val)) / Math.max(1, vMax - vMin)
  const d = pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.B).toFixed(1)},${Y(q.v).toFixed(1)}`).join(' ')

  return (
    <motion.main className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <p className="eyebrow">5단계 · 결과 · What-if</p>
      <h1>예산이 바뀌면 어떻게 될까요?</h1>
      <div className="chips">
        {PRESETS.map((x) => <button key={x.id} className={`chip ${pid === x.id ? 'on' : ''}`} onClick={() => setPid(x.id)}>{x.icon} {x.name}안{plans.find((q) => q.preset === x.id)!.recommended ? ' ⭐' : ''}</button>)}
      </div>

      <div className="slider-box">
        <div className="row">
          <b>총예산</b><span className="spacer" />
          <span className="big num">{fmt(raw)}<small>억</small></span>
          <span className={`num ${raw >= s.budget ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>({raw >= s.budget ? '+' : ''}{fmt(raw - s.budget)}억)</span>
        </div>
        <input type="range" min={10} max={300} step={5} value={raw} onChange={(e) => setRaw(+e.target.value)} aria-label="바꿔 볼 총예산(억 원)" />
        <div className="slider-ends"><span>10억</span><span>기준 {fmt(s.budget)}억</span><span>300억</span></div>
      </div>

      <div className="wi">
        <section className="card">
          <h3>{next >= s.budget ? `추가 ${fmt(next - s.budget)}억은 여기로 가요` : `${fmt(s.budget - next)}억 줄이면 여기서 빠져요`}</h3>
          <ul className="delta-list">
            <AnimatePresence initial={false}>
              {deltas.map(({ l, b, n, d: dd }) => (
                <motion.li key={l.id} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}>
                  <span><span className="sw" style={{ background: l.color }} />{l.short}</span>
                  <span className={`amt ${dd > 0 ? 'up' : 'down'}`}>{dd > 0 ? '+' : ''}{dd}억 {dd > 0 ? '▲' : '▼'}</span>
                  <span>{b < 1 && n >= 1 ? <span className="badge new">✨ 새로 등장</span> : n < 1 ? <span className="badge">빠짐</span> : <span className="muted small">{b}→{n}억</span>}</span>
                </motion.li>
              ))}
            </AnimatePresence>
            {!deltas.length && <li className="muted">변화 없음</li>}
          </ul>
          <p className="path" style={{ marginTop: 18 }}>
            종합 취약도 <b>{Math.round(v.now)}</b>→<b>{Math.round(v.base)}</b>→<b className="grad">{Math.round(v.next)}</b>
          </p>
          <p className="muted small" style={{ margin: 0 }}>(현재) → ({fmt(s.budget)}억) → ({fmt(next)}억) · {p.icon} {p.name} 가중치</p>
          {nx.left >= 1 && <p className="small bad">모든 정책이 실행 상한에 닿아 {nx.left}억은 쓸 곳이 없어요.</p>}
        </section>

        <section className="card curve">
          <h3>예산별 종합 취약도</h3>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="예산-효과 곡선">
            <line x1={pad} y1={H - pad} x2={W - 14} y2={H - pad} stroke="#cfcfcf" />
            {[0, 100, 200, 300].map((B) => <text key={B} x={X(B)} y={H - pad + 18} fontSize="12" textAnchor="middle" fill="#5f5e5e">{B}억</text>)}
            {knee > 0 && <>
              <rect x={X(pts[knee].B)} y={10} width={X(300) - X(pts[knee].B)} height={H - pad - 10} fill="#9b3fe8" opacity="0.06" />
              <text x={X(pts[knee].B) + 6} y={24} fontSize="12" fill="#6c22b0">효과 체감 구간</text>
            </>}
            <motion.path d={d} fill="none" stroke="#000" strokeWidth="2.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }} />
            {pts.map((q) => <circle key={q.B} cx={X(q.B)} cy={Y(q.v)} r="3.5" fill="#000" />)}
            <circle cx={X(s.budget)} cy={Y(v.base)} r="7" fill="#fff" stroke="#000" strokeWidth="2.5" />
            <motion.circle animate={{ cx: X(next), cy: Y(v.next) }} r="8" fill="#9b3fe8" stroke="#fff" strokeWidth="2.5" transition={{ type: 'spring', stiffness: 260, damping: 26 }} />
            <motion.text animate={{ x: X(next), y: Y(v.next) - 14 }} fontSize="13" fontWeight="600" textAnchor="middle" fill="#6c22b0">{Math.round(v.next)}점</motion.text>
          </svg>
          <p className="muted small" style={{ margin: 0 }}>25억 단위로 미리 계산한 점을 이었어요. 흰 점 = 기준 예산, 보라 점 = 바꿔 본 예산.</p>
        </section>
      </div>

      <div className="ai-say">
        <AiBadge>AI 해설</AiBadge>
        <p>“{explainWhatIf({ base: s.budget, next, baseAlloc: base.alloc, nextAlloc: nx.alloc, v, slopeRatio, left: nx.left })}”</p>
        <p className="muted small">계산 결과 숫자만 써서 만든 해설이에요.</p>
      </div>

      <div className="next-row">
        <button className="ghost" onClick={() => nav(`/r/${r.code}/result`)}>← 예산안 3개</button>
        <div className="row">
          <button className="ghost" onClick={() => { s.set({ budget: next }); nav(`/r/${r.code}/result`) }}>이 예산({fmt(next)}억)으로 다시 비교</button>
          <button className="primary" onClick={() => nav(`/r/${r.code}/report`)}>✦ AI 레포트 만들기 →</button>
        </div>
      </div>
    </motion.main>
  )
}
