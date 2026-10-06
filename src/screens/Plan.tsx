// 목표 설정 → 세 안 비교 → 추천. 고른 안은 지도에 공급이 하나씩 놓이며 그려진다.
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useStore, usePlans, optService } from '../store'
import { AGES, COUNTIES, service } from '../api/mock'
import { SUPPLY, recommendReason, summarize, type Plan as PlanT } from '../api/plans'
import { SUPPLY_COLOR_CSS } from '../map/colors'
import { useCountUp, fmt, pct } from '../motion/useCountUp'
import { tween } from '../motion/tween'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Stepper } from '../ui/Stepper'
import { fitCounty, flyToArea } from '../map/geo'
import { planArea } from '../map/planLayers'

const CAMERA_MS = 1200

export function Plan({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { sgg: param } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const s = useStore()
  const mapReady = s.mapReady
  const p = usePlans()
  const ready = p && p.model.county.sgg === param

  // 군을 불러오고 카메라를 군 전체로
  useEffect(() => {
    if (!param || !COUNTIES.some((c) => c.sgg === param)) { nav('/start'); return }
    if (!mapReady) return
    const st = useStore.getState()
    // 카메라는 아래 '안 그리기'에서 고른 안 쪽으로 다가간다
    const go = () => {
      useStore.getState().set({ unfolded: true, selectedCell: null, sweep: null, service: optService(useStore.getState().service) })
    }
    if (st.model?.county.sgg === param) go()
    else st.loadCounty(param).then(go)
  }, [param, mapReady, mapRef, nav])

  // 보여 줄 안이 바뀌거나 다시 보기를 누르면 공급을 하나씩 놓는다
  const shown = ready ? p.shown : null
  const showKey = shown ? `${shown.id}-${shown.picks.map((x) => x.key).join()}-${s.replay}` : ''
  useEffect(() => {
    if (!shown) return
    const n = shown.picks.length
    if (reduce) { useStore.getState().set({ reveal: n }); return }
    useStore.getState().set({ reveal: 0 })
    // 먼저 이 안이 그리는 범위가 다 보이도록 화면을 맞추고, 도착한 뒤에 공급을 하나씩 놓는다
    const m = useStore.getState().model!
    const area = planArea(m, shown)
    // 범례(지도 왼쪽 아래)에 공급 위치가 가리지 않게 그 높이만큼 아래를 비운다
    const legendH = document.querySelector('.plan-legend')?.getBoundingClientRect().height ?? 200
    if (area) flyToArea(mapRef.current, area, { duration: CAMERA_MS, bottom: Math.min(legendH + 40, window.innerHeight * 0.35) })
    else fitCounty(mapRef.current, m.bbox, { duration: CAMERA_MS })
    let stop = () => {}
    const t = setTimeout(() => { stop = tween(0, n, Math.min(4500, Math.max(1400, n * 420)), (v) => useStore.getState().set({ reveal: v }), { ease: (x) => x }) }, CAMERA_MS + 150)
    return () => { clearTimeout(t); stop() }
    // showKey가 안의 내용과 다시 보기를 모두 담는다
  }, [showKey, reduce, mapReady])

  if (!ready) return <aside className="panel"><p className="muted">대안을 계산하는 중…</p></aside>
  const { goal, plans, model: m } = p
  const rec = plans.find((x) => x.recommended)!
  const svc = service(goal.service)

  return (
    <>
    <PlanLegend plan={p.shown} reveal={s.reveal} svc={goal.service} />
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <Stepper sgg={m.county.sgg} at={1} />
      <div className="summary-head">
        <h2>{m.county.name} 대안 비교</h2>
        <LevelBadge level={m.county.level} />
      </div>

      <section className="goal">
        <h3>목표</h3>
        <p className="goal-sentence">
          <b>{AGES.find((a) => a.id === goal.age)!.name}</b>의 <b className="accent">{Math.round(goal.target * 100)}%</b>가{' '}
          <b>{svc.name}</b>까지 <b>{goal.mode === 'bus' ? '버스로' : '자가용으로'} {goal.T}분</b> 안에, 예산 <b className="accent">연 {goal.budget}억</b> 이하
        </p>
        <div className="chips">
          {(['med', 'pha', 'gro'] as const).map((id) => (
            <button key={id} className={`chip ${goal.service === id ? 'on solid' : ''}`} onClick={() => s.set({ service: id, planShow: null })}>{service(id).icon} {service(id).name}</button>
          ))}
          {AGES.map((a) => (
            <button key={a.id} className={`chip ${goal.age === a.id ? 'on solid' : ''}`} onClick={() => s.set({ age: a.id, planShow: null })}>{a.name}</button>
          ))}
        </div>
        <label className="slider">
          <span>목표 달성률 <b>{Math.round(goal.target * 100)}%</b></span>
          <input type="range" min={70} max={99} value={Math.round(goal.target * 100)} onChange={(e) => s.set({ target: +e.target.value / 100, planShow: null })} />
        </label>
        <label className="slider">
          <span>연 예산 <b>{goal.budget}억</b> 이하</span>
          <input type="range" min={0.5} max={15} step={0.5} value={goal.budget} onChange={(e) => s.set({ budget: +e.target.value, planShow: null })} />
        </label>
        <div className="group">
          <span className="group-label">쓸 수 있는 공급 수단 (단가는 가정값)</span>
          <div className="chips">
            {SUPPLY.map((x) => (
              <button key={x.id} className={`chip supply ${s.allowed[x.id] ? 'on' : 'off'}`} onClick={() => s.set({ allowed: { ...s.allowed, [x.id]: !s.allowed[x.id] }, planShow: null })}>
                <i style={{ background: SUPPLY_COLOR_CSS[x.id] }} />{x.name[goal.service]}
              </button>
            ))}
          </div>
        </div>
      </section>

      <h3>세 가지 안</h3>
      <LayoutGroup>
        <div className="plans">
          {plans.map((pl, k) => <PlanCard key={pl.id} pl={pl} k={k} on={p.shown.id === pl.id} target={goal.target} onClick={() => s.set({ planShow: pl.id, replay: s.replay + 1 })} svc={goal.service} />)}
        </div>
      </LayoutGroup>

      <motion.div className="reason" key={rec.id + goal.budget + goal.target} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <AiBadge>추천 이유</AiBadge>
        <p><b>{rec.name}</b>을 추천해요. {recommendReason(plans, goal)}</p>
      </motion.div>

      <div className="row">
        <button className="ghost" onClick={() => s.set({ replay: s.replay + 1 })}>↻ 지도에 다시 그리기</button>
        <motion.button className="primary" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => nav(`/c/${m.county.sgg}/memo`)}>검토 메모 만들기 →</motion.button>
      </div>
      <p className="source">가상 데이터 · 단가와 효과계수는 가정값 · 대안 계산은 시제품용 간단 방식(비용 대비 효과 순)</p>
    </motion.aside>
    </>
  )
}

// 지도 위 범례 + 지금 그려지는 안의 진행
function PlanLegend({ plan, reveal, svc }: { plan: PlanT; reveal: number; svc: 'med' | 'pha' | 'gro' }) {
  const types = [...new Set(plan.picks.map((x) => x.type))]
  const n = plan.picks.length, k = Math.min(n, Math.ceil(reveal))
  return (
    <motion.div className="legend plan-legend" key={plan.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <p className="legend-title"><span className="plan-id">{plan.id}</span> {plan.name} <span className="muted">{k}/{n} 배치</span></p>
      <div className="progress"><motion.span animate={{ width: `${n ? (k / n) * 100 : 100}%` }} /></div>
      <p><i className="sw" style={{ background: '#2f5bd3' }} /> 이 안으로 새로 닿는 칸</p>
      <p><i className="sw" style={{ background: '#d73027' }} /> 여전히 공백</p>
      <p><i className="sw" style={{ background: '#a9d3b4' }} /> 이미 닿는 칸</p>
      <div className="chips">{types.map((t) => <span key={t} className="mini"><i style={{ background: SUPPLY_COLOR_CSS[t] }} />{SUPPLY.find((x) => x.id === t)!.name[svc]}</span>)}</div>
    </motion.div>
  )
}

function PlanCard({ pl, k, on, target, onClick, svc }: { pl: PlanT; k: number; on: boolean; target: number; onClick: () => void; svc: 'med' | 'pha' | 'gro' }) {
  const rate = useCountUp(pl.rate * 1000) / 1000
  const year = useCountUp(pl.year * 10) / 10
  const gapAfter = useCountUp(pl.gapAfter)
  const warn = !pl.meets || !pl.withinBudget
  return (
    <motion.button
      layout
      className={`plan ${on ? 'on' : ''} ${pl.recommended ? 'rec' : ''}`}
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0, x: warn ? [0, -4, 4, -2, 0] : 0 }}
      transition={{ delay: k * 0.08, x: { duration: 0.4 } }}
    >
      <div className="plan-head">
        <span className="plan-id">{pl.id}</span>
        <b>{pl.name}</b>
        {pl.recommended && <motion.span layoutId="rec-badge" className="badge rec-badge" transition={{ type: 'spring', stiffness: 380, damping: 30 }}>★ 추천</motion.span>}
      </div>
      <p className="muted small">{pl.desc}</p>
      <div className="bar" aria-label={`달성률 ${pct(pl.rate)}`}>
        <span className="bar-base" style={{ width: `${pl.base * 100}%` }} />
        <motion.span className="bar-gain" initial={{ width: `${pl.base * 100}%` }} animate={{ width: `${pl.rate * 100}%` }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }} />
        <span className="bar-target" style={{ left: `${target * 100}%` }} />
      </div>
      <dl className="plan-stats">
        <div><dt>달성률</dt><dd className={pl.meets ? '' : 'bad'}>{pct(rate)}</dd></div>
        <div><dt>연 비용</dt><dd className={pl.withinBudget ? '' : 'bad'}>{year.toFixed(1)}억</dd></div>
        <div><dt>남는 공백</dt><dd>{fmt(gapAfter)}명</dd></div>
        <div><dt>10년 뒤</dt><dd className={pl.future >= target ? '' : 'bad'}>{pct(pl.future)}</dd></div>
      </dl>
      <p className="small picks">{summarize(pl, svc)}</p>
      <AnimatePresence>
        {warn && <motion.p className="small bad" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{!pl.meets ? '목표에 못 미쳐요' : '예산을 넘어요'}</motion.p>}
        {!warn && !pl.robust && <motion.p className="small warn" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>원격 효과가 낮거나 단가가 오르면 흔들려요</motion.p>}
      </AnimatePresence>
    </motion.button>
  )
}

