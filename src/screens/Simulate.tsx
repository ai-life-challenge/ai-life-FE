// S4 AI 시뮬레이션: 도구 호출 칩이 순서대로 끝나고, greedy 배분을 "1억 블록 쌓기"로 재생한다.
// 실제 계산은 즉시 끝나 있고 연출만 약 4초. 건너뛰기 가능, 동작 줄이기면 최종 상태를 바로 보여 준다.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import { regionOf } from '../data/regions'
import { LEVERS, PRESETS, preset, type PresetId } from '../sim/model'
import { usePlans, useStore } from '../store'
import { AiBadge } from '../ui/Badges'
import { Tools, type ToolCall } from '../ui/Tools'

const DIAG = 600, OPT = 1100, CMP = 500
const T_END = DIAG + OPT * 3 + CMP

export function Simulate() {
  const { code } = useParams()
  const nav = useNavigate()
  const r = regionOf(code)!
  const plans = usePlans(r)!
  const { budget, main } = useStore()
  const reduce = useReducedMotion()
  const [t, setT] = useState(reduce ? T_END : 0)
  const [tab, setTab] = useState<PresetId | null>(null)
  const started = useRef(performance.now())

  useEffect(() => {
    if (t >= T_END) return
    let id = requestAnimationFrame(function tick() {
      const now = performance.now() - started.current
      setT(Math.min(T_END, now))
      if (now < T_END) id = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(id)
    // 시작할 때 한 번만 돈다 (건너뛰기는 started를 당겨서 처리)
  }, [])
  useEffect(() => {
    if (t < T_END) return
    const id = setTimeout(() => nav(`/r/${r.code}/result`), reduce ? 1500 : 900)
    return () => clearTimeout(id)
  }, [t, nav, r.code, reduce])
  const skip = () => { started.current = performance.now() - T_END; setT(T_END) }

  // 시나리오별 진행률 (0~1)
  const prog = (k: number) => Math.min(1, Math.max(0, (t - DIAG - k * OPT) / OPT))
  const running = PRESETS.findIndex((_, k) => prog(k) < 1)
  const shownId = tab ?? PRESETS[running === -1 ? PRESETS.findIndex((p) => p.id === main) : running].id
  const k = PRESETS.findIndex((p) => p.id === shownId)
  const plan = plans.find((p) => p.preset === shownId)!
  const nShown = Math.round(plan.opt.steps.length * prog(k))
  const steps = plan.opt.steps.slice(0, nShown)
  const g0 = plan.opt.steps[0]?.gain || 1
  const rec = plans.find((p) => p.recommended)!

  const calls: ToolCall[] = [
    { id: 'd', label: `diagnose(${r.name})`, state: t >= DIAG ? 'done' : 'run', result: '현황 지표 6개', detail: `E30, E60, 의사 수, 최소서비스, 사망률, 병원 대중교통시간\n의료 취약도 ${Math.round(plans[1].before.mvi)} · 교통 취약도 ${Math.round(plans[1].before.tvi)}` },
    ...PRESETS.map((p, i): ToolCall => {
      const pl = plans.find((x) => x.preset === p.id)!
      const st = prog(i) >= 1 ? 'done' : t >= DIAG + i * OPT ? 'run' : 'wait'
      return { id: p.id, label: `optimize(${p.name}, ${budget}억)`, state: st, result: `종합 ${Math.round(pl.before.v)}→${Math.round(pl.after.v)}`, detail: LEVERS.filter((l) => pl.opt.alloc[l.id] > 0).map((l) => `${l.short} ${pl.opt.alloc[l.id]}억`).join(' · ') + `\n1억 단위 ${pl.opt.steps.length}번 배정` }
    }),
    { id: 'c', label: 'compare(3안)', state: t >= T_END ? 'done' : t >= DIAG + 3 * OPT ? 'run' : 'wait', result: `추천: ${preset(rec.preset).icon} ${preset(rec.preset).name}`, detail: '기준: 균형 가중치로 잰 종합 취약도 감소 × 수혜 인구' },
  ]

  return (
    <motion.main className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <p className="eyebrow">4단계 · 시뮬레이션 · {r.name} · {budget}억</p>
      <div className="row">
        <h1 style={{ margin: 0 }}>{t >= T_END ? 'AI가 예산안 3개를 만들었어요' : 'AI가 예산안을 만들고 있어요'}</h1>
        <AiBadge />
        <span className="spacer" />
        {t < T_END ? <button className="ghost" onClick={skip}>건너뛰기 ⏭</button> : <button className="primary" onClick={() => nav(`/r/${r.code}/result`)}>결과 보기 →</button>}
      </div>

      <div className="sim">
        <Tools calls={calls} />
        <section className="blocks" aria-label="예산 블록 쌓기">
          <div className="tabs" role="tablist">
            {PRESETS.map((p, i) => (
              <button key={p.id} role="tab" aria-selected={shownId === p.id} className={shownId === p.id ? 'on' : ''} onClick={() => setTab(p.id)} disabled={t < DIAG + i * OPT}>
                {shownId === p.id && <motion.span layoutId="sim-tab" className="tab-bg" />}
                <span>{p.icon} {p.name}</span>
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: '0 0 8px' }}>1억 블록이 그 순간 효과가 가장 큰 정책으로 날아가요. 블록이 옅을수록 1억당 효과가 줄어든 것(체감)이에요.</p>
          {LEVERS.map((l) => {
            const mine = steps.filter((s) => s.lever === l.id)
            return (
              <div className="lane" key={l.id}>
                <span className="lane-name">{l.short}</span>
                <span className="lane-blocks">
                  {mine.map((s, j) => (
                    <motion.i key={j} className="blk" style={{ background: l.color, opacity: 0.3 + 0.7 * Math.min(1, s.gain / g0) }}
                      initial={reduce ? false : { x: -30, y: -10, scale: 0.4, opacity: 0 }} animate={{ x: 0, y: 0, scale: 1, opacity: 0.3 + 0.7 * Math.min(1, s.gain / g0) }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                  ))}
                  {!mine.length && prog(k) >= 1 && <span className="zero">아직 0원</span>}
                </span>
                <span className="lane-sum">{mine.length}억</span>
              </div>
            )
          })}
          <div className="left-bar">
            <span>남은 예산</span>
            <span className="track"><span className="fill" style={{ width: `${((budget - nShown) / budget) * 100}%` }} /></span>
            <span className="lane-sum">{budget - nShown}억</span>
          </div>
          {prog(k) >= 1 && plan.opt.left >= 1 && <p className="small bad">모든 정책이 실행 상한에 닿아 {plan.opt.left}억은 배정하지 못했어요.</p>}
        </section>
      </div>
    </motion.main>
  )
}
