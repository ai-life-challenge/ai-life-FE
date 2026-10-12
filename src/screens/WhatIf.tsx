// S6 What-if: 연 예산을 바꿔 보면 대안 3개의 달성률과 비용이 어떻게 달라지는지. 바꿔 본 값은 서버에 물어서 받고, 확정하기 전까지는 기준 조건을 건드리지 않는다.
// 곡선은 예산별로 서버가 찾은 '예산 안에서 달성률이 가장 높은 조합'(적극 투자안)의 달성률이다.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion } from 'motion/react'
import { api } from '../api/client'
import type { Plans } from '../api/types'
import { eok, fmt, pct } from '../api/meta'
import { errText, useStore } from '../store'
import { useAutoFetch } from '../hooks'

const CURVE_BUDGETS = [0.5, 1, 2, 3, 4, 6, 10, 20, 30]
const TICKS = [1, 3, 6, 12, 30]

export function WhatIf() {
  const { code } = useParams()
  const nav = useNavigate()
  const { state, plans, regions, patch } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  useAutoFetch('fetchPlans')
  const base = plans.data?.plans ?? null

  // 기준보다 줄여 봐야 달라지는 게 보이는 경우가 많아서, 처음에는 기준의 절반에서 시작한다
  const [raw, setRaw] = useState(Math.max(0.5, Math.round(st.budget)  / 2))
  const [next, setNext] = useState(raw)
  useEffect(() => { const t = setTimeout(() => setNext(raw), 250); return () => clearTimeout(t) }, [raw])

  // 바꿔 본 예산의 대안 (같은 예산을 다시 묻지 않게 기억해 둔다)
  const memo = useRef(new Map<string, Plans>())
  const cond = (b: number) => JSON.stringify([code, st.service, st.age, st.criteria, st.assumptions, st.allowedSupply, st.target, b])
  const ask = (b: number, signal: AbortSignal) => {
    const hit = memo.current.get(cond(b))
    if (hit) return Promise.resolve(hit)
    return api.plans({ region: code!, state: { ...st, budget: b } }, signal).then((p) => { memo.current.set(cond(b), p); return p })
  }
  const [alt, setAlt] = useState<{ b: number; plans: Plans } | { b: number; error: string } | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    ask(next, ac.signal).then((p) => setAlt({ b: next, plans: p }), (e) => { if (!ac.signal.aborted) setAlt({ b: next, error: errText(e) }) })
    return () => ac.abort()
  }, [next, code, st.service, st.age, st.criteria, st.assumptions, st.allowedSupply, st.target]) // eslint-disable-line react-hooks/exhaustive-deps

  // 곡선: 예산별 적극 투자안 달성률. 서버가 한 번에 하나씩 계산하므로 하나씩 도착하는 대로 그린다
  const [curve, setCurve] = useState<{ b: number; rate: number }[]>([])
  useEffect(() => {
    const ac = new AbortController()
    setCurve([])
    ;(async () => {
      for (const b of CURVE_BUDGETS) {
        try {
          const p = await ask(b, ac.signal)
          const best = p.plans[p.plans.length - 1]
          if (!ac.signal.aborted) setCurve((c) => [...c, { b, rate: best.rate }])
        } catch { if (ac.signal.aborted) return }
      }
    })()
    return () => ac.abort()
  }, [code, st.service, st.age, st.criteria, st.assumptions, st.allowedSupply, st.target]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = alt && alt.b === next ? alt : null
  const altPlans = cur && 'plans' in cur ? cur.plans.plans : null
  const best = base?.[base.length - 1], altBest = altPlans?.[altPlans.length - 1]

  // 곡선 SVG
  const W = 460, H = 220, pad = 40
  const X = (b: number) => pad + (W - pad - 14) * Math.sqrt(b / 30) // 작은 예산 쪽이 펼쳐지게 제곱근 눈금
  const yMin = Math.max(0, Math.floor((Math.min(st.target, best?.rate ?? 1, ...curve.map((q) => q.rate)) - 0.05) * 20) / 20)
  const Y = (rate: number) => 16 + (H - pad - 16) * (1 - (rate - yMin) / (1 - yMin))
  const d = curve.map((q, i) => `${i ? 'L' : 'M'}${X(q.b).toFixed(1)},${Y(q.rate).toFixed(1)}`).join(' ')
  const here = curve.find((q) => q.b === next)

  return (
    <motion.main className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <p className="eyebrow">5단계 · 결과 · What-if</p>
      <h1>{r.name}, 예산이 바뀌면 어떻게 될까요?</h1>

      <div className="slider-box">
        <div className="row">
          <b>연 예산</b><span className="spacer" />
          <span className="big num">{raw}<small>억</small></span>
          <span className={`num ${raw >= st.budget ? 'up' : 'down'}`} style={{ fontWeight: 600 }}>({raw >= st.budget ? '+' : ''}{Math.round((raw - st.budget) * 10) / 10}억)</span>
        </div>
        <input type="range" min={0.5} max={30} step={0.5} value={raw} onChange={(e) => setRaw(+e.target.value)} aria-label="바꿔 볼 연 예산(억 원)" />
        <div className="slider-ends"><span>0.5억</span><span>기준 {eok(st.budget)}</span><span>30억</span></div>
      </div>

      <div className="wi">
        <section className="card">
          <h3>대안 3개가 이렇게 달라져요</h3>
          {cur && 'error' in cur && <p className="bad" role="alert">{cur.error}</p>}
          {!cur && <p className="muted" role="status">계산하는 중이에요…</p>}
          {base && altPlans && (
            <table className="ltable">
              <thead><tr><th>안</th><th className="r">달성률</th><th className="r">연 비용</th></tr></thead>
              <tbody>
                {base.map((p, i) => {
                  const a = altPlans[i]
                  return (
                    <tr key={p.k}>
                      <td>{p.name}{a.recommended ? ' ⭐' : ''}</td>
                      <td className="r">{pct(p.rate)} → <b>{pct(a.rate)}</b></td>
                      <td className="r">{eok(p.year)} → <b>{eok(a.year)}</b></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {best && altBest && (
            <p className="muted small" style={{ margin: '12px 0 0' }}>
              연 예산 {eok(st.budget)} → {eok(next)}일 때 예산 안에서 가장 많이 닿는 안의 달성률은 {pct(best.rate)}에서 {pct(altBest.rate)}로
              {Math.abs(altBest.rate - best.rate) < 0.0005 ? ' 달라지지 않아요(이미 거의 다 닿아요).' : ` ${altBest.rate > best.rate ? '+' : '−'}${Math.round(Math.abs(altBest.rate - best.rate) * 1000) / 10}%p 달라져요.`}
              {' '}남는 공백은 {fmt(best.gapAfter)}명 → {fmt(altBest.gapAfter)}명이에요.
            </p>
          )}
        </section>

        <section className="card curve">
          <h3>예산별로 얼마나 닿을까</h3>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="연 예산별 최대 달성률 곡선">
            <line x1={pad} y1={H - pad} x2={W - 14} y2={H - pad} stroke="#cfcfcf" />
            {TICKS.map((b) => <text key={b} x={X(b)} y={H - pad + 18} fontSize="12" textAnchor="middle" fill="#5f5e5e">{b}억</text>)}
            {[yMin, (yMin + 1) / 2, 1].map((v) => <text key={v} x={pad - 6} y={Y(v) + 4} fontSize="12" textAnchor="end" fill="#5f5e5e">{Math.round(v * 100)}%</text>)}
            {st.target > 0 && <line x1={pad} x2={W - 14} y1={Y(st.target)} y2={Y(st.target)} stroke="#9b3fe8" strokeDasharray="4 4" opacity="0.6" />}
            <text x={W - 16} y={Y(st.target) - 5} fontSize="11" textAnchor="end" fill="#6c22b0">목표 {pct(st.target)}</text>
            {d && <path d={d} fill="none" stroke="#000" strokeWidth="2.5" />}
            {curve.map((q) => <circle key={q.b} cx={X(q.b)} cy={Y(q.rate)} r="3.5" fill="#000" />)}
            <circle cx={X(st.budget)} cy={best ? Y(best.rate) : -9} r="7" fill="#fff" stroke="#000" strokeWidth="2.5" />
            {altBest && <motion.circle animate={{ cx: X(next), cy: Y(altBest.rate) }} r="8" fill="#9b3fe8" stroke="#fff" strokeWidth="2.5" transition={{ type: 'spring', stiffness: 260, damping: 26 }} />}
            {here && <text x={X(next)} y={Y(here.rate) - 14} fontSize="13" fontWeight="600" textAnchor="middle" fill="#6c22b0">{pct(here.rate)}</text>}
          </svg>
          <p className="muted small" style={{ margin: 0 }}>
            {curve.length < CURVE_BUDGETS.length ? `서버에 물어 점을 찍는 중이에요 (${curve.length}/${CURVE_BUDGETS.length}). ` : ''}
            흰 점 = 기준 예산, 보라 점 = 바꿔 본 예산. 점은 서버가 예산별로 계산한 값이에요.
          </p>
        </section>
      </div>

      <div className="next-row">
        <button className="ghost" onClick={() => nav(`/r/${r.code}/result`)}>← 대안 3개</button>
        <div className="row">
          <button className="ghost" onClick={() => { patch((s) => ({ ...s, budget: next })); nav(`/r/${r.code}/result`) }}>이 예산({eok(next)})으로 다시 비교</button>
          <button className="primary" onClick={() => nav(`/r/${r.code}/report`)}>✦ 레포트 만들기 →</button>
        </div>
      </div>
    </motion.main>
  )
}
