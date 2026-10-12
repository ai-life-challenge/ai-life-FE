// S2 현황 진단: 왼쪽 패널에 공백 인구(우리가 이 기준으로 못 가는 사람 수)와 조건 바꾸기, 오른쪽 지도에 마을별 판정.
// 기준을 바꾸면 브라우저가 바로 다시 판정해서 지도가 즉시 바뀌고, 서버 판정(기준)이 오면 대조한다. 다르면 서버 결과로 바꿔 보여 준다.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { api } from '../api/client'
import type { VillageDetail } from '../api/types'
import { AGES, SERVICES, STATE_CSS, STATE_NAME, fmt, pct } from '../api/meta'
import { useAutoFetch, useJudgeCompare, useShownJudge } from '../hooks'
import { calcKey, errText, useStore } from '../store'
import { boxOf, fitCounty } from '../map/geo'
import { Count } from '../ui/Count'
import { LevelBadge } from '../ui/Badges'

export function Diagnose({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { code } = useParams()
  const nav = useNavigate()
  const { regions, data, state, judge, mapReady, set, patch } = useStore()
  const r = regions.find((x) => x.code === code)!
  const st = state!
  const shown = useShownJudge()
  const cmp = useJudgeCompare()
  useAutoFetch('fetchJudge')

  useEffect(() => { if (mapReady && data) fitCounty(mapRef.current, boxOf(data.villages), { duration: 1400 }) }, [mapReady, data, mapRef])

  const gapList = useMemo(() => (shown ? shown.villages.filter((v) => v.state !== 0).sort((a, b) => b.people - a.people).slice(0, 6) : []), [shown])
  const precise = data!.tier === 'precise'
  const ageName = AGES.find((a) => a.id === st.age)!.name
  const sum = shown?.summary

  return (
    <>
    <Legend />
    <VillageCard />
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">2단계 · 현황 진단</p>
      <div className="region-head"><h1>{r.name}</h1><LevelBadge tier={r.tier} /><span className="muted small">{r.sido} · 마을 {r.villages}곳</span></div>

      {sum && (
        <div className="hero">
          <p className="muted small" style={{ margin: 0 }}>{ageName} {fmt(sum.total)}명 중 이 기준으로 {st.service === 'med' ? '병원에 갈 수 없는' : '버스를 탈 수 없는'} 사람</p>
          <p className="big"><Count value={sum.gap} />명 <small>({pct(sum.rate)})</small></p>
          <p className="small" style={{ margin: 0 }}>
            버스가 없어 못 가는 <b className="num">{fmt(sum.noBus)}명</b>({sum.villagesNoBus}곳)
            {st.service === 'med' && <> · 병원이 너무 먼 <b className="num">{fmt(sum.noFacility)}명</b>({sum.villagesNoFacility}곳)</>}
          </p>
        </div>
      )}
      <ServerCheck />

      <div className="map-card">
        <h3>무엇을 볼까요</h3>
        <div className="chips" role="radiogroup" aria-label="보는 대상">
          {SERVICES.map((x) => (
            <button key={x.id} role="radio" aria-checked={st.service === x.id} className={`chip ${st.service === x.id ? 'on' : ''}`} onClick={() => patch((s) => ({ ...s, service: x.id }))}>{x.name}</button>
          ))}
        </div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>{SERVICES.find((x) => x.id === st.service)!.desc}</p>
        <h3 style={{ marginTop: 14 }}>누구를 볼까요</h3>
        <div className="chips" role="radiogroup" aria-label="나이대">
          {AGES.map((a) => (
            <button key={a.id} role="radio" aria-checked={st.age === a.id} className={`chip ${st.age === a.id ? 'on' : ''}`} onClick={() => patch((s) => ({ ...s, age: a.id }))}>{a.name}</button>
          ))}
        </div>

        <h3 style={{ marginTop: 14 }}>기준</h3>
        {st.service === 'med' && <Slider label="병원까지 자가용" unit="분 이내" min={10} max={60} step={5} value={st.criteria.carMinutes} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, carMinutes: v } }))} />}
        <Slider label="정류장까지 걸어서" unit="분 이내" min={5} max={30} step={1} value={st.criteria.stopWalkMinutes} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, stopWalkMinutes: v } }))} />
        <Slider label="버스 하루 운행" unit="번 이상" min={1} max={10} step={1} value={st.criteria.dailyRuns} disabled={!precise}
          note={precise ? '읍내행 첫차는 낮 12시 전이어야 해요' : '이 지역은 간이 판정이라 정류장까지 거리만 봐요'} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, dailyRuns: v } }))} />
      </div>

      <h3 style={{ marginTop: 18 }}>가장 많이 닿지 못하는 마을</h3>
      {shown && !gapList.length && <p className="muted">이 기준에서는 못 가는 마을이 없어요.</p>}
      <ul className="villages">
        {gapList.map((v) => (
          <li key={v.id} onClick={() => patch((s) => ({ ...s, selectedVillage: v.id }))} onMouseEnter={() => set({ hoverVillage: v.id })} onMouseLeave={() => set({ hoverVillage: null })}>
            <span><i className="sw" style={{ background: STATE_CSS[v.state] }} />{v.name}</span>
            <b className="num">{fmt(v.people)}명</b>
          </li>
        ))}
      </ul>

      <div className="next-row">
        <button className="ghost" onClick={() => nav('/start')}>← 지역 다시 고르기</button>
        <button className="primary big-btn" onClick={() => nav(`/r/${code}/goal`)}>목표 정하기 →</button>
      </div>
      <p className="source">마을 원자료: {data!.sources.join(' · ')}</p>
      {judge.status === 'error' && !cmp && <p className="source">서버 판정을 받지 못했어요({judge.error}). 화면 판정만 보여 드려요.</p>}
    </motion.aside>
    </>
  )
}

// 서버 판정(기준)과 브라우저 판정을 대조한 결과
function ServerCheck() {
  const judge = useStore((s) => s.judge)
  const cmp = useJudgeCompare()
  const [open, setOpen] = useState(false)
  if (cmp?.same) return <p className="small ok" role="status">✓ 서버 판정과 같아요</p>
  if (cmp && !cmp.same) {
    return (
      <p className="small bad" role="status">
        서버 판정과 {cmp.diff.length}곳이 달라서 서버 결과로 보여 드려요.{' '}
        <button className="link" onClick={() => setOpen(!open)}>{open ? '접기' : '어느 마을?'}</button>
        {open && <span className="muted"> {cmp.diff.slice(0, 8).join(', ')}{cmp.diff.length > 8 ? ' …' : ''}</span>}
      </p>
    )
  }
  if (judge.status === 'error') return null
  return <p className="small muted" role="status">서버 판정 확인 중…</p>
}

function Slider({ label, unit, min, max, step, value, onChange, disabled, note }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; disabled?: boolean; note?: string }) {
  return (
    <label className="slider" style={{ opacity: disabled ? 0.5 : 1 }}>
      <span>{label} <b className="num">{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} />
      {note && <span className="muted small">{note}</span>}
    </label>
  )
}

function Legend() {
  return (
    <div className="legend">
      <p className="legend-title">마을 한 곳이 점 하나예요</p>
      {([0, 1, 2] as const).map((k) => <p key={k}><i className="sw" style={{ background: STATE_CSS[k] }} />{STATE_NAME[k]}</p>)}
      <p><img className="legend-icon" src="/icons/hospital.png" alt="" />병원</p>
      <p><img className="legend-icon" src="/icons/health-center.png" alt="" />보건소·보건지소·진료소</p>
      <p><img className="legend-icon" src="/icons/clinic.png" alt="" />의원</p>
      <p className="muted">점이 클수록 사는 사람이 많아요</p>
    </div>
  )
}

// 마을을 누르면 서버가 판정 이유와 가까운 시설을 알려 준다
function VillageCard() {
  const { code, state, set, patch } = useStore()
  const id = state?.selectedVillage ?? null
  const [d, setD] = useState<{ id: string; detail: VillageDetail } | { id: string; error: string } | null>(null)
  const key = calcKey(code, state)
  useEffect(() => {
    if (!id || !code || !state) return
    const ac = new AbortController()
    api.village({ region: code, state, villageId: id }, ac.signal).then(
      (detail) => setD({ id, detail }),
      (e) => { if (!ac.signal.aborted) setD({ id, error: errText(e) }) },
    )
    return () => ac.abort()
  }, [id, key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => patch((s) => ({ ...s, selectedVillage: null })), [patch])
  const cur = d && d.id === id ? d : null
  return (
    <AnimatePresence>
      {id && (
        <motion.div className="cellcard" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
          <button className="close" onClick={() => { patch((s) => ({ ...s, selectedVillage: null })); set({ hoverVillage: null }) }} aria-label="닫기">×</button>
          {!cur && <p className="muted" role="status">불러오는 중…</p>}
          {cur && 'error' in cur && <p className="bad">{cur.error}</p>}
          {cur && 'detail' in cur && <Detail v={cur.detail} service={state!.service} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Detail({ v, service }: { v: VillageDetail; service: 'med' | 'bus' }) {
  const state = service === 'bus' ? (v.bus.ok ? 0 : 1) : v.med.state
  const reasons = service === 'bus' ? v.bus.reasons : v.med.reason ? [v.med.reason] : []
  return (
    <>
      <p className="eyebrow">{v.myeon}</p>
      <h3 style={{ fontSize: 20 }}>{v.name}</h3>
      <p><span className="badge" style={{ background: STATE_CSS[state], color: '#fff' }}>{service === 'bus' ? (v.bus.ok ? '버스 이용 가능' : '버스 이용 어려움') : v.med.stateText}</span></p>
      {reasons.length > 0 && <p className="small">{reasons.join(' · ')}</p>}
      <p className="small muted" style={{ margin: '6px 0 0' }}>사는 사람 {fmt(v.pop.all)}명 (65세 이상 {fmt(v.pop.a65)}명 · 80세 이상 {fmt(v.pop.a80)}명)</p>
      <p className="small" style={{ margin: '6px 0 0' }}>
        {v.bus.noStop ? '2km 안에 정류장이 없어요' : <>정류장까지 걸어서 <b className="num">{v.bus.stopWalkMin}분</b></>}
        {v.tier === 'precise' && <> · 하루 <b className="num">{v.bus.dailyRuns}번</b>{v.bus.firstToTown ? ` · 읍내행 첫차 ${v.bus.firstToTown}` : ' · 읍내행 버스 없음'}</>}
      </p>
      {v.med.nearest && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          가까운 병의원 <b>{v.med.nearest.name}</b>({v.med.nearest.kind}) 자가용 {v.med.nearest.minutes}분{v.med.nearest.inVillage ? ' · 마을 안' : v.med.nearest.outside ? ' · 군 밖' : ''}
        </p>
      )}
    </>
  )
}
