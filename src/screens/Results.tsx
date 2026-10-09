// S5 예산안 3개 비교 (왼쪽 패널 + 지도): 카드 3장(레버별 누적막대, 전/후 점수, 수혜 인구, 취약지 해제), AI 추천 배지(layoutId로 이동),
// 단가 저/중/고 토글과 결과 범위, 카드를 누르면 상세(레버 표, "왜 이 금액?" 체감 곡선, 🔗 교차효과 흐름).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { AGES } from '../map/grid'
import { planArea, planMap, type PlanMap } from '../map/planMap'
import { planT } from '../map/MapView'
import { flyToArea } from '../map/geo'
import { tween } from '../motion/tween'
import { regionOf, type Region } from '../data/regions'
import { LEVERS, crossChain, lever, leverCurve, preset, units, type CostLevel, type LeverId, type Plan, type UnitCost } from '../sim/model'
import { usePlans, useStore, useUnitCost } from '../store'
import { fmt } from '../motion/useCountUp'
import { Count } from '../ui/Count'
import { AiBadge, SrcBadge } from '../ui/Badges'

const LEVELS: { id: CostLevel; name: string }[] = [{ id: 'low', name: '저' }, { id: 'mid', name: '중' }, { id: 'high', name: '고' }]
const rng = (a: number, b: number) => `${Math.round(Math.min(a, b))}–${Math.round(Math.max(a, b))}`

const CAMERA_MS = 1200

export function Results({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { code } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const r = regionOf(code)!
  const plans = usePlans(r)!
  const s = useStore()
  const c = useUnitCost()
  const [showRange, setShowRange] = useState(true)
  const rec = plans.find((p) => p.recommended)!
  const open = plans.find((p) => p.preset === s.detail) ?? null
  const shown = open ?? rec // 지도에 그리는 안
  const g = s.grid?.region.code === r.code ? s.grid : null

  useEffect(() => { if (s.mapReady) useStore.getState().loadRegion(r.code) }, [r.code, s.mapReady])
  // 보여 줄 안이 바뀌면 그 안의 핵심 효과가 보이는 쪽(응급 거점 → 자가용, 아니면 버스)으로 지도를 맞춘다
  useEffect(() => { useStore.getState().set({ planMode: shown.opt.alloc.er > 0 ? 'car' : 'bus' }) }, [shown.preset])
  const pm = useMemo(() => (g ? planMap(g, shown.opt, c, s.planMode, planT(s.planMode), s.age) : null), [g, shown, c, s.planMode, s.age])

  // 안이 바뀌거나 다시 그리기를 누르면: 이 안이 그리는 범위로 카메라를 맞추고 → 도착한 뒤 정책을 하나씩 놓는다
  const showKey = pm ? `${shown.preset}-${s.budget}-${s.level}-${s.planMode}-${s.replay}-${pm.picks.length}` : ''
  useEffect(() => {
    if (!g || !pm) return
    const n = pm.picks.length
    // 시뮬레이션이 이 안을 방금 다 그려 두었으면 다시 그리지 않는다
    // (플래그는 여기서 지우지 않는다: 개발 모드에서 effect가 두 번 돈다. 카드를 누르거나 다시 그리기를 하면 지운다)
    const fromSim = useStore.getState().simDone === shown.preset
    if (reduce || fromSim) { useStore.getState().set({ reveal: n }); return }
    useStore.getState().set({ reveal: 0 })
    const legendH = document.querySelector('.plan-legend')?.getBoundingClientRect().height ?? 200
    flyToArea(mapRef.current, planArea(g, pm), { duration: CAMERA_MS, bottom: Math.min(legendH + 40, window.innerHeight * 0.35) })
    let stop = () => {}
    const t = setTimeout(() => { stop = tween(0, n, Math.min(4500, Math.max(1400, n * 450)), (v) => useStore.getState().set({ reveal: v }), { ease: (x) => x }) }, CAMERA_MS + 150)
    return () => { clearTimeout(t); stop() }
    // showKey가 안의 내용과 다시 그리기를 모두 담는다
  }, [showKey, reduce])

  return (
    <>
      {g && pm && <PlanLegend p={shown} pm={pm} />}
      <motion.aside className="panel wide" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
        <p className="eyebrow">5단계 · 결과</p>
        <h1 style={{ fontSize: 26 }}>{r.name} · {fmt(s.budget)}억 · 예산안 3개</h1>
        <p className="muted small">점수는 0점이 가장 좋아요. 각 안은 자기 목표의 가중치로 쟀어요. 카드를 누르면 그 안이 지도에 놓이고 정책별 금액과 이유가 펼쳐져요.</p>

        <div className="plans-col">
          {plans.map((p, k) => <PlanCard key={p.preset} p={p} k={k} on={shown.preset === p.preset} main={s.main === p.preset} showRange={showRange} onClick={() => s.set({ detail: s.detail === p.preset ? null : p.preset, replay: s.replay + 1, simDone: null })} />)}
        </div>
        <div className="lever-legend">{LEVERS.map((l) => <span key={l.id}><i style={{ background: l.color }} />{l.short}</span>)}</div>

        <div className="toolbar">
          <div className="row">
            <span className="muted small">단가</span>
            <div className="seg" role="radiogroup" aria-label="단가 수준">
              {LEVELS.map((lv) => (
                <button key={lv.id} role="radio" aria-checked={s.level === lv.id} className={s.level === lv.id ? 'on' : ''} onClick={() => s.set({ level: lv.id })}>
                  {s.level === lv.id && <motion.span layoutId="lv-bg" className="tab-bg" />}<span style={{ position: 'relative' }}>{lv.name}</span>
                </button>
              ))}
            </div>
            <label className="switch small"><input type="checkbox" checked={showRange} onChange={(e) => setShowRange(e.target.checked)} /> 결과 범위</label>
            <SrcBadge kind="assume" id="costs" note="단가" />
          </div>
        </div>

        <div className="rec-why">
          <div className="row"><AiBadge>추천 이유</AiBadge></div>
          <p>
            <b>{preset(rec.preset).icon} {preset(rec.preset).name}안</b>을 추천해요. 세 안을 같은 잣대(균형 가중치)로 쟀을 때 종합 취약도를 <b>{Math.round(rec.neutral.before)}→{Math.round(rec.neutral.after)}점</b>으로 낮추고,{' '}
            <b>{fmt(rec.benefit)}명</b>이 혜택을 받아 ‘취약도 감소 × 수혜 인구’가 가장 커요.
            {rec.vulnerableBefore && (rec.vulnerableAfter ? ' 다만 응급의료 취약지 기준은 아직 넘어요.' : ' 응급의료 취약지 기준(27%) 아래로 내려가요.')}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {open && <Detail key={open.preset} r={r} p={open} c={c} />}
        </AnimatePresence>

        <div className="next-row">
          <button className="ghost" onClick={() => nav(`/r/${r.code}/whatif`)}>What-if 해보기</button>
          <button className="primary" onClick={() => nav(`/r/${r.code}/report`)}>✦ AI 레포트 만들기 →</button>
        </div>
        <p className="source">지도 위치는 가상 격자에서 ‘공백 인구를 가장 많이 줄이는 곳부터’ 고른 예시예요 · 경계 SGIS(admdongkor 2026.7)</p>
      </motion.aside>
    </>
  )
}

// 지도 위 범례 + 지금 그려지는 안의 진행 + 지도 기준(자가용 30분 / 버스 60분)
function PlanLegend({ p, pm }: { p: Plan; pm: PlanMap }) {
  const s = useStore()
  const n = pm.picks.length, k = Math.min(n, Math.ceil(s.reveal))
  const ageName = AGES.find((a) => a.id === s.age)!.name
  const types = [...new Set(pm.picks.map((x) => x.type))]
  return (
    <motion.div className="legend plan-legend" key={p.preset} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <p className="legend-title">{preset(p.preset).icon} {preset(p.preset).name}안 <span className="muted">{k}/{n} 배치</span></p>
      <div className="progress-line"><motion.span animate={{ width: `${n ? (k / n) * 100 : 100}%` }} /></div>
      <div className="chips">
        {(['car', 'bus'] as const).map((m) => (
          <button key={m} className={`chip small-chip ${s.planMode === m ? 'on' : ''}`} onClick={() => s.set({ planMode: m })}>{m === 'car' ? '자가용 30분 (응급 거점)' : '버스 60분 (버스·DRT)'}</button>
        ))}
      </div>
      <p><i className="sw" style={{ background: '#2f5bd3' }} /> 이 안으로 새로 닿는 칸 · {ageName} <b><Count value={k >= n ? pm.reached : 0} />명</b></p>
      <p><i className="sw" style={{ background: '#d73027' }} /> 여전히 공백</p>
      <p><i className="sw" style={{ background: '#a9d3b4' }} /> 이미 닿는 칸</p>
      <p><i className="ring-red" /> 교통사고 다발지점</p>
      <div className="chips" style={{ marginTop: 8 }}>{types.map((t) => <span key={t} className="mini"><i style={{ background: lever(t).color }} />{lever(t).short}</span>)}</div>
      <button className="link small" style={{ marginTop: 8 }} onClick={() => s.set({ replay: s.replay + 1, simDone: null })}>↻ 지도에 다시 그리기</button>
    </motion.div>
  )
}

function PlanCard({ p, k, on, main, showRange, onClick }: { p: Plan; k: number; on: boolean; main: boolean; showRange: boolean; onClick: () => void }) {
  const pr = preset(p.preset)
  const B = LEVERS.reduce((a, l) => a + p.opt.alloc[l.id], 0) || 1
  return (
    <motion.button className={`plan ${on ? 'on' : ''} ${main ? 'main' : ''}`} onClick={onClick} aria-expanded={on}
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.08 }}>
      <div className="plan-head">
        <span aria-hidden>{pr.icon}</span><b>{pr.name}</b>
        {main && <span className="badge main-tag">내가 고른 목표</span>}
        <span className="spacer" />
        {p.recommended && <motion.span layoutId="rec-badge" className="badge rec" transition={{ type: 'spring', stiffness: 300, damping: 26 }}>⭐ AI 추천</motion.span>}
      </div>
      <div className="stack" aria-label="정책별 금액">
        {LEVERS.filter((l) => p.opt.alloc[l.id] > 0).map((l) => (
          <motion.span key={l.id} title={`${l.short} ${p.opt.alloc[l.id]}억`} style={{ background: l.color }} initial={{ width: 0 }} animate={{ width: `${(p.opt.alloc[l.id] / B) * 100}%` }} transition={{ duration: 0.6, delay: 0.1 + k * 0.08 }} />
        ))}
      </div>
      <ScoreRow label="의료" from={p.before.mvi} to={p.after.mvi} range={showRange ? rng(p.range.low.after.mvi, p.range.high.after.mvi) : null} delay={k * 80} />
      <ScoreRow label="교통" from={p.before.tvi} to={p.after.tvi} range={showRange ? rng(p.range.low.after.tvi, p.range.high.after.tvi) : null} delay={k * 80} />
      <div className="benefit">수혜 <b><Count value={p.benefit} delay={k * 80} /></b>명{showRange && <span className="muted small"> ({fmt(Math.min(p.range.low.benefit, p.range.high.benefit))}–{fmt(Math.max(p.range.low.benefit, p.range.high.benefit))})</span>}</div>
      <div className="row">
        {p.vulnerableBefore ? (p.vulnerableAfter ? <span className="badge warnb">응급취약 유지</span> : <motion.span className="badge green" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.5 + k * 0.08 }}>응급취약 해제</motion.span>) : <span className="badge">취약지 아님</span>}
        {p.opt.left >= 1 && <span className="badge warnb">미배정 {p.opt.left}억</span>}
      </div>
    </motion.button>
  )
}

function ScoreRow({ label, from, to, range, delay }: { label: string; from: number; to: number; range: string | null; delay: number }) {
  return (
    <div className="score-row">
      <span className="lbl">{label}</span>
      <span className="score-val"><span className="from">{Math.round(from)} → </span><Count value={to} delay={delay} />{range && <span className="range">({range})</span>}</span>
    </div>
  )
}

function Detail({ r, p, c }: { r: Region; p: Plan; c: UnitCost }) {
  const pr = preset(p.preset)
  const [why, setWhy] = useState<LeverId | null>(null)
  const [chain, setChain] = useState(false)
  const level = useStore((s) => s.level)
  const cross = crossChain(r, pr, p.opt.alloc, c)
  const unitText = (id: LeverId) => {
    const n = units(id, p.opt.alloc[id], c)
    return `${n >= 10 ? Math.round(n) : n.toFixed(1)}${lever(id).unit}`
  }
  return (
    <motion.section className="detail" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <h2>{pr.icon} {pr.name}안 상세</h2>
      <p className="muted small">1억씩 ‘그 순간 효과가 가장 큰 정책’에 배정한 결과예요. 실행량은 단가({LEVELS.find((x) => x.id === level)!.name})로 나눈 값이에요.</p>
      <table className="ltable">
        <thead><tr><th>정책</th><th className="r">금액</th><th className="r">실행량</th><th /></tr></thead>
        <tbody>
          {LEVERS.map((l) => (
            <tr key={l.id} className={why === l.id ? 'sel' : ''}>
              <td title={`영향 지표: ${l.targets}`}><span className="sw" style={{ background: l.color }} />{l.short}</td>
              <td className="r"><b>{p.opt.alloc[l.id]}억</b></td>
              <td className="r">{p.opt.alloc[l.id] > 0 ? unitText(l.id) : '—'}</td>
              <td className="row" style={{ justifyContent: 'flex-end' }}>
                {l.cross && p.opt.alloc[l.id] > 0 && <button className={`icon-btn ${chain ? 'on' : ''}`} onClick={() => setChain(!chain)} title="교차효과 보기">🔗</button>}
                <button className="icon-btn" onClick={() => setWhy(why === l.id ? null : l.id)}>왜?</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <AnimatePresence>
        {chain && (
          <motion.div className="chain" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-label="교차효과 흐름">
            {[
              <>버스 증차·DRT <b>{p.opt.alloc.bus + p.opt.alloc.drt}억</b></>,
              <>배차간격 <b>{Math.round(cross.h[0])}→{Math.round(cross.h[1])}분</b></>,
              <>병원까지 대중교통 <b>{Math.round(cross.ht[0])}→{Math.round(cross.ht[1])}분</b></>,
              <>의료 점수 <b>{cross.mvi <= 0 ? '−' : '+'}{Math.abs(cross.mvi).toFixed(1)}점</b></>,
            ].map((node, i) => (
              <motion.span key={i} style={{ display: 'contents' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.25 }}>
                {i > 0 && <motion.span className="arrow" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.25 }}>→</motion.span>}
                <motion.span className={`node ${i === 3 ? 'hl' : ''}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.25 }}>{node}</motion.span>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {why && <Why key={why} r={r} p={p} id={why} c={c} />}
      </AnimatePresence>
    </motion.section>
  )
}

// 효과 체감 곡선: 다른 정책은 그대로 두고 이 정책만 0→상한까지 움직였을 때의 종합 취약도 감소, 현재 배정 지점을 점으로
function Why({ r, p, id, c }: { r: Region; p: Plan; id: LeverId; c: UnitCost }) {
  const lc = leverCurve(r, preset(p.preset), id, p.opt.alloc, c)
  const W = 320, H = 170, pad = 30
  const maxY = Math.max(0.5, ...lc.pts.map((q) => q.dv))
  const X = (x: number) => pad + ((W - pad - 10) * x) / (lc.max || 1)
  const Y = (y: number) => H - pad - ((H - pad - 14) * y) / maxY
  const d = lc.pts.map((q, i) => `${i ? 'L' : 'M'}${X(q.x).toFixed(1)},${Y(q.dv).toFixed(1)}`).join(' ')
  const l = lever(id)
  const text = lc.capped
    ? `실행 상한(${l.cap(r)}${l.unit} = ${Math.round(lc.max)}억)에 닿아서 더 넣을 수 없어요.`
    : lc.at === 0
      ? `처음 1억의 효과가 ${lc.mine!.toFixed(3)}점으로, ${lc.rival ? `${lever(lc.rival.l).short}(${lc.rival.g.toFixed(3)}점)` : '다른 정책'}보다 작아서 한 번도 배정되지 않았어요.`
      : `여기서부터는 1억당 효과가 ${lc.mine!.toFixed(3)}점으로, ${lc.rival ? `${lever(lc.rival.l).short}의 ${lc.rival.g.toFixed(3)}점` : '다른 정책'}보다 작아져서 멈췄어요.`
  return (
    <motion.div className="why-box" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${l.short} 투입액-효과 곡선`}>
        <line x1={pad} y1={H - pad} x2={W - 10} y2={H - pad} stroke="#ccc" />
        <line x1={pad} y1={14} x2={pad} y2={H - pad} stroke="#ccc" />
        <motion.path d={d} fill="none" stroke={l.color} strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8 }} />
        <motion.circle cx={X(lc.at)} cy={Y(lc.dvAt)} r="6" fill="#000" stroke="#fff" strokeWidth="2" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.7 }} />
        <text x={X(lc.at)} y={Y(lc.dvAt) - 12} fontSize="12" textAnchor="middle">{lc.at}억</text>
        <text x={W - 10} y={H - 10} fontSize="11" textAnchor="end" fill="#5f5e5e">투입액 (상한 {Math.round(lc.max)}억)</text>
        <text x={pad + 4} y={22} fontSize="11" fill="#5f5e5e">종합 취약도 감소(점)</text>
      </svg>
      <div>
        <h3>왜 {l.short}에 {p.opt.alloc[id]}억?</h3>
        <p style={{ margin: 0 }}>{text}</p>
        <p className="muted small">효과 모델: {l.model}. 곡선이 완만해질수록 1억당 효과가 줄어요(한계효용 체감).</p>
      </div>
    </motion.div>
  )
}
