// S5 결과: 서버가 만든 대안 3개를 카드로 비교하고, 고른 안이 닿는 마을과 공급수단을 지도에 그린다.
// 카드 순서는 서버가 준 대로 비용 절감안 · 균형안 · 적극 투자안이고, 추천은 서버가 정한다.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useAutoFetch, useShownJudge } from '../hooks'
import { AGES, STATE_CSS, SUPPLY, eok, fmt, pct } from '../api/meta'
import { MINUTE_STOPS, minuteRgb } from '../api/cells'
import type { Plan } from '../api/types'
import { useStore } from '../store'
import { boxOf, fitCounty, flyToArea } from '../map/geo'
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

  const list = plans.data?.plans ?? []
  const rec = list.find((p) => p.recommended)
  const shown = list[st.planShow] ?? rec
  const [open, setOpen] = useState<number | null>(null)
  // 안을 바꾸면 그 안이 놓는 곳(정류장 · 구역 · 거점)이 다 보이게 다가간다. 놓는 게 없으면 군 전체
  useEffect(() => {
    if (!mapReady || !data || !shown) return
    const ids = new Set(shown.picks.flatMap((p) => [...p.villages, ...(p.type === 'tour' ? [data.depot] : []), ...(p.myeon ? data.villages.filter((v) => v.myeon === p.myeon).map((v) => v.id) : [])]))
    const pts = data.villages.filter((v) => ids.has(v.id))
    if (!pts.length) { fitCounty(mapRef.current, boxOf(data.villages), { duration: 900 }); return }
    const b = boxOf(pts), pad = 0.06
    flyToArea(mapRef.current, [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], { duration: 1100, right: LEGEND_W })
  }, [shown?.k, mapReady, data]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PlanLegend plan={shown ?? null} mapRef={mapRef} />
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

const TARGET_NAME = { med: '모든 병의원', hospital: '병원·종합병원', clinic: '동네 의원', public: '보건소·진료소', er: '응급의료센터' } as const // 진단 화면 필터 이름과 같다
const LEGEND_W = 370 // 오른쪽 위 범례(폭 330 + 여백): 지도를 맞출 때 이만큼 비운다

// 지도 위 범례(오른쪽 위): 고른 안이 새로 놓는 공급수단(손을 올리면 지도에서 그것만 또렷하게, 누르면 그곳으로 다가간다)과 마을 판정 개수
function PlanLegend({ plan, mapRef }: { plan: Plan | null; mapRef: React.RefObject<MapRef | null> }) {
  const { data, state, judge, gridTarget, set } = useStore()
  const shown = useShownJudge()
  if (!plan || !data) return null
  const byId = new Map(data.villages.map((v) => [v.id, v]))
  // 마을 판정 개수: 원래 갈 수 있음 · 이 안으로 새로 닿음(절반 넘게) · 여전히 못 감(버스 없음 · 너무 멂)
  const cov = new Map((judge.data?.villages ?? []).map((v, i) => [v.id, plan.coverage[i] ?? 0]))
  const vs = shown?.villages ?? []
  const ok = vs.filter((v) => v.state === 0).length
  const reached = vs.filter((v) => v.state !== 0 && (cov.get(v.id) ?? 0) > 0.5).length
  const still = vs.filter((v) => v.state !== 0 && (cov.get(v.id) ?? 0) <= 0.5)
  const stillBus = still.filter((v) => v.state === 1).length, stillFar = still.filter((v) => v.state === 2).length // 못 가는 이유별(✕ 색과 같다)
  const types = [...new Set(plan.picks.map((x) => x.type))]
  const box = (ids: string[]) => {
    const pts = ids.flatMap((id) => { const v = byId.get(id); return v ? [[v.lon, v.lat]] : [] })
    if (!pts.length) return null
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), pad = 0.02
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad] as [number, number, number, number]
  }
  const rows = types.map((t) => {
    const picks = plan.picks.filter((x) => x.type === t)
    const ids = [...new Set(picks.flatMap((x) => (t === 'tour' ? [data.depot, ...x.villages] : t === 'drt' ? data.villages.filter((v) => x.myeon && v.myeon === x.myeon).map((v) => v.id) : x.villages)))]
    const stops = new Set(picks.flatMap((x) => x.villages)).size
    const sub = t === 'tour' ? `${picks.length}대 · ${stops}곳 정차 · 주 ${state!.assumptions.tourWeekly}회 · 보건소 출발`
      : t === 'drt' ? `${picks.map((x) => x.myeon).filter(Boolean).join(', ')} 안에서 부르면 와요`
      : t === 'fix' ? `${stops}곳에 새로 열어요` : `경로당 ${stops}곳에서 화상 진료`
    return { t, name: t === 'tour' ? `${SUPPLY[t].name} 노선` : t === 'drt' ? `${SUPPLY[t].name} 구역` : SUPPLY[t].name, sub, year: picks.reduce((a, x) => a + x.year, 0), area: box(ids) }
  })
  return (
    <motion.div className="legend plan-legend" key={plan.k} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 26 }} onMouseLeave={() => set({ hoverSupply: null })}>
      <div className="pl-head">
        <p className="legend-title" style={{ margin: 0 }}>{plan.name}</p>
        <span className="pl-rate">달성률 {pct(plan.baseRate)} → <b>{pct(plan.rate)}</b></span>
      </div>
      {rows.length > 0 && <p className="pl-sec">새로 놓이는 것 <span className="muted">· 누르면 그곳으로 가요</span></p>}
      <div className="pl-rows">
        {rows.map((r, i) => (
          <motion.button key={r.t} type="button" className="pl-row" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + i * 0.08 }}
            onMouseEnter={() => set({ hoverSupply: r.t })} onFocus={() => set({ hoverSupply: r.t })} onBlur={() => set({ hoverSupply: null })}
            onClick={() => r.area && flyToArea(mapRef.current, r.area, { right: LEGEND_W })}>
            <i className={r.t === 'tour' ? 'sw-route' : r.t === 'drt' ? 'sw-zone' : 'sw-dot'} style={r.t === 'tour' ? { color: SUPPLY[r.t].color } : r.t === 'drt' ? { borderColor: SUPPLY[r.t].color } : { borderColor: SUPPLY[r.t].color }} aria-hidden />
            <span className="pl-text"><b>{r.name}</b><small>{r.sub}</small></span>
            <span className="pl-cost">연 {eok(r.year)}</span>
          </motion.button>
        ))}
      </div>
      <p className="pl-sec">마을</p>
      <div className="pl-villages">
        <span><i style={{ background: '#2f5bd3' }} />새로 닿음 <b>{reached}</b></span>
        <span><i style={{ background: STATE_CSS[1] }} />못 감 · 버스가 없어서 <b>{stillBus}</b></span>
        <span><i style={{ background: STATE_CSS[2] }} />못 감 · 병원이 너무 멀어서 <b>{stillFar}</b></span>
        <span className="muted">원래 갈 수 있는 마을 {ok}곳은 지도에서 뺐어요</span>
      </div>
      {plan.gapAfter > 0 && <p className="muted" style={{ marginTop: 6 }}>남는 공백 {fmt(plan.gapAfter)}명</p>}
      {/* 진단에서 고르고 넘어온 기준: 바탕 격자가 같은 기준으로 칠해진다 */}
      <p className="pl-sec">바탕색 · 진단에서 고른 기준</p>
      <p className="pl-basis"><b>{TARGET_NAME[gridTarget]}</b>까지 걸리는 시간 · {AGES.find((a) => a.id === state!.age)!.name}</p>
      <i className="time-bar" style={{ background: `linear-gradient(90deg, ${MINUTE_STOPS.map(([m]) => `rgb(${minuteRgb(m).join(',')}) ${(m / 45) * 100}%`).join(', ')})` }} />
      <p className="muted time-scale" style={{ margin: 0 }}><span>10분 이하</span><span>30분</span><span>45분 이상</span></p>
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
