// S5 결과: 서버가 만든 대안 3개를 카드로 비교하고, 고른 안이 닿는 마을과 공급수단을 지도에 그린다.
// 카드 순서는 서버가 준 대로 비용 절감안 · 균형안 · 적극 투자안이고, 추천은 서버가 정한다.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useAutoFetch } from '../hooks'
import { SUPPLY, eok, fmt, pct } from '../api/meta'
import type { Plan } from '../api/types'
import { useStore } from '../store'
import { boxOf, fitCounty } from '../map/geo'
import { Count } from '../ui/Count'
import { AiBadge, SrcBadge } from '../ui/Badges'
import { Basis } from '../ui/Basis'

export function Results({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { code } = useParams()
  const nav = useNavigate()
  const { state, regions, data, plans, sens, mapReady, patch, fetchPlans } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  useAutoFetch('fetchJudge') // 지도가 마을별로 칠하려면 서버 판정의 마을 순서가 필요하다
  useAutoFetch('fetchPlans')
  useAutoFetch('fetchSens', plans.status === 'ok', 400)
  useEffect(() => { if (mapReady && data) fitCounty(mapRef.current, boxOf(data.villages), { duration: 1000 }) }, [mapReady, data, mapRef])

  const list = plans.data?.plans ?? []
  const rec = list.find((p) => p.recommended)
  const shown = list[st.planShow] ?? rec
  const [open, setOpen] = useState<number | null>(null)

  return (
    <>
      <PlanLegend plan={shown ?? null} />
      <motion.aside className="panel wide" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
        <p className="eyebrow">5단계 · 결과</p>
        <h1 style={{ fontSize: 26 }}>{r.name} · 연 {eok(st.budget)} · 대안 {list.length || 3}개</h1>
        <p className="muted small">카드를 누르면 그 안이 지도에 그려져요. 달성률은 이 기준에서 갈 수 있는 {st.age === 'all' ? '주민' : st.age === 'a65' ? '65세 이상' : '80세 이상'}의 비율이에요.</p>
        <Basis />

        {plans.status === 'error' && (
          <div className="toast-inline" role="alert">{plans.error} <button className="link" onClick={() => void fetchPlans()}>다시 계산</button></div>
        )}
        {!list.length && plans.status !== 'error' && <p className="muted" role="status">대안을 계산하는 중이에요…</p>}

        <div className="plans-col">
          {list.map((p, k) => (
            <PlanCard key={p.k} p={p} k={k} on={shown?.k === p.k} budget={st.budget} target={st.target} open={open === p.k}
              onClick={() => { patch((s) => ({ ...s, planShow: p.k })); setOpen(open === p.k ? null : p.k) }} />
          ))}
        </div>

        {rec && (
          <div className="rec-why">
            <div className="row"><AiBadge>추천 이유</AiBadge></div>
            <p>
              서버가 <b>{rec.name}</b>을 추천했어요. 목표 {pct(st.target)}를 <b>{rec.meetsTarget ? '채우고' : '채우지 못하고'}</b>, 연 비용 <b>{eok(rec.year)}</b>으로 예산 {eok(st.budget)}을 <b>{rec.withinBudget ? '넘지 않아요' : '넘어요'}</b>.
              {' '}공백 <b>{fmt(rec.gapBefore)}명</b>이 <b>{fmt(rec.gapAfter)}명</b>으로 줄어요.
            </p>
          </div>
        )}

        <div className="map-card">
          <h3>단가가 20% 달라지면?</h3>
          {sens.status === 'loading' && !sens.data && <p className="muted small" role="status">계산하는 중이에요…</p>}
          {sens.status === 'error' && <p className="small bad">{sens.error}</p>}
          {sens.data && (
            <>
              <p style={{ margin: '4px 0' }}>
                추천은 <b>{sens.data.same ? '그대로예요' : '바뀔 수 있어요'}</b>. 연 비용은 <b className="num">{eok(sens.data.lo.year)}</b>(단가 −20%) ~ <b className="num">{eok(sens.data.hi.year)}</b>(+20%)예요.
              </p>
              {!sens.data.same && <p className="small muted" style={{ margin: 0 }}>단가 −20%에서는 {sens.data.lo.name}, +20%에서는 {sens.data.hi.name}을 추천해요.</p>}
            </>
          )}
          <SrcBadge kind="assume" id="costs" note="단가" />
        </div>

        <div className="next-row">
          <button className="ghost" onClick={() => nav(`/r/${r.code}/whatif`)}>What-if 해보기</button>
          <button className="primary" onClick={() => nav(`/r/${r.code}/report`)}>✦ 레포트 만들기 →</button>
        </div>
      </motion.aside>
    </>
  )
}

// 지도 위 범례: 이 안으로 닿는 마을과 공급수단
function PlanLegend({ plan }: { plan: Plan | null }) {
  const types = plan ? [...new Set(plan.picks.map((x) => x.type))] : []
  return (
    <motion.div className="legend plan-legend" key={plan?.k ?? 'none'} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <p className="legend-title">{plan ? plan.name : '대안'}</p>
      <p><i className="sw" style={{ background: '#2fa36b' }} /> 원래 갈 수 있는 마을</p>
      <p><i className="sw" style={{ background: '#2f5bd3' }} /> 이 안으로 새로 닿는 마을</p>
      <p><i className="sw" style={{ background: '#d6455d' }} /> 여전히 못 가는 마을</p>
      {plan && plan.gapAfter > 0 && <p className="muted">남는 공백 {fmt(plan.gapAfter)}명</p>}
      <div className="chips" style={{ marginTop: 8 }}>{types.map((t) => <span key={t} className="mini"><i style={{ background: SUPPLY[t].color }} />{SUPPLY[t].name}</span>)}</div>
    </motion.div>
  )
}

function PlanCard({ p, k, on, open, budget, target, onClick }: { p: Plan; k: number; on: boolean; open: boolean; budget: number; target: number; onClick: () => void }) {
  return (
    <motion.div className={`plan ${on ? 'on' : ''}`} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.08 }}>
      <button className="plan-hit" onClick={onClick} aria-expanded={open}>
        <div className="plan-head">
          <b>{p.name}</b>
          <span className="spacer" />
          {p.recommended && <motion.span layoutId="rec-badge" className="badge rec" transition={{ type: 'spring', stiffness: 300, damping: 26 }}>⭐ 추천</motion.span>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{p.summary}</p>
        <div className="score-row">
          <span className="lbl">달성률</span>
          <span className="score-val"><span className="from">{pct(p.baseRate)} → </span><Count value={p.rate * 100} delay={k * 80} format={(n) => `${(Math.round(n * 10) / 10).toFixed(1)}%`} /></span>
        </div>
        <div className="benefit">공백 <b><Count value={p.gapBefore} delay={k * 80} /></b>명 → <b><Count value={p.gapAfter} delay={k * 80} /></b>명</div>
        <div className="row">
          <span className="badge">연 {eok(p.year)}</span>
          <span className="badge">설치 {eok(p.install)}</span>
          {p.future != null && <span className="badge">10년 뒤 {pct(p.future)}</span>}
        </div>
        <div className="row">
          <span className={`badge ${p.meetsTarget ? 'green' : 'warnb'}`}>{p.meetsTarget ? `목표 ${pct(target)} 달성` : `목표 ${pct(target)} 미달`}</span>
          <span className={`badge ${p.withinBudget ? '' : 'warnb'}`}>{p.withinBudget ? `예산 ${eok(budget)} 안` : `예산 ${eok(budget)} 초과`}</span>
          {p.sameAs != null && <span className="badge">{p.sameAs + 1}번 안과 같은 조합</span>}
          {p.timedOut && <span className="badge warnb" title="계산 시간 안에 찾은 가장 좋은 조합이에요">시간 제한 내 최선</span>}
        </div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.table className="ltable" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
            <thead><tr><th>공급수단</th><th className="r">연 비용</th><th className="r">설치</th></tr></thead>
            <tbody>
              {p.picks.map((x, i) => (
                <tr key={i}>
                  <td><span className="sw" style={{ background: SUPPLY[x.type].color }} />{x.label}</td>
                  <td className="r">{eok(x.year)}</td>
                  <td className="r">{eok(x.install)}</td>
                </tr>
              ))}
            </tbody>
          </motion.table>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
