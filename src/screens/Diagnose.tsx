import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { tween } from '../motion/tween'
import type { MapRef } from 'react-map-gl/maplibre'
import { useStore } from '../store'
import { AGES, COUNTIES, MODES, SERVICES, diagnose, routeFrom, service, type Model } from '../api/mock'
import { useCountUp, fmt, pct } from '../motion/useCountUp'
import { cssColor } from '../map/colors'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Stepper } from '../ui/Stepper'
import { fitCounty } from '../map/geo'

export function Diagnose({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { sgg: param } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const s = useStore()
  const m = s.model?.county.sgg === param ? s.model : null
  const T = s.thresholds[s.service]

  // 군이 바뀌면: 불러오고 → 카메라를 군으로 → 잠시 군 평균 한 색으로 보여 준 뒤 격자로 펼친다
  const mapReady = useStore((st) => st.mapReady)
  useEffect(() => {
    if (!param || !COUNTIES.some((c) => c.sgg === param)) { nav('/start'); return }
    if (!mapReady) return
    let timer = 0
    useStore.getState().loadCounty(param).then(() => {
      const b = useStore.getState().model!.bbox
      fitCounty(mapRef.current, b, { pitch: useStore.getState().extruded ? 50 : 15 })
      timer = window.setTimeout(() => useStore.getState().set({ unfolded: true }), reduce ? 0 : 2000)
    })
    return () => clearTimeout(timer)
  }, [param, mapRef, nav, reduce, mapReady])

  const d = useMemo(() => (m ? diagnose(m, s.service, s.mode, s.age, T) : null), [m, s.service, s.mode, s.age, T])
  const gap = useCountUp(d && s.unfolded ? d.gap : 0)
  const avg = useCountUp(d ? d.avgMinutes : 0)

  const playSweep = () => {
    if (!d) return
    s.set({ selectedCell: null, unfolded: true })
    if (reduce) return
    tween(0, T * 1.6, 3000, (v) => useStore.getState().set({ sweep: v }), { ease: (x) => x, onDone: () => useStore.getState().set({ sweep: null }) })
  }
  const toggle3d = () => {
    const ex = !s.extruded
    s.set({ extruded: ex })
    mapRef.current?.easeTo({ pitch: ex ? 55 : 20, duration: 1200 })
  }
  const flyToVillage = (vi: number) => {
    const v = m!.villages[vi]
    mapRef.current?.flyTo({ center: [v.lon, v.lat], zoom: 12.5, duration: 1400, padding: { left: 440, top: 0, right: 0, bottom: 0 } })
  }

  if (!m || !d) return <aside className="panel"><p className="muted">지역 데이터를 불러오는 중…</p></aside>
  const svc = service(s.service)
  const ageName = AGES.find((a) => a.id === s.age)!.name
  const aiCount = m.cells.filter((c) => c.aiFilled).length

  return (
    <>
      <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
        <Stepper sgg={m.county.sgg} at={0} />
        <div className="summary-head">
          <button className="link" onClick={() => nav('/start')}>← 지역</button>
          <h2>{m.county.name} 공백 진단</h2>
          <LevelBadge level={m.county.level} />
        </div>

        <Group label="서비스">
          {SERVICES.map((x) => (
            <Chip g="svc" key={x.id} on={s.service === x.id} dashed={!x.optimizable} onClick={() => s.set({ service: x.id, selectedCell: null })}>
              {x.icon} {x.name}
            </Chip>
          ))}
        </Group>
        <p className="hint">점선 = 진단만 하는 서비스 (대안 계산은 의료·약국·식료품)</p>
        <Group label="이동 수단">
          {MODES.map((x) => <Chip g="mode" key={x.id} on={s.mode === x.id} onClick={() => s.set({ mode: x.id })}>{x.name}</Chip>)}
        </Group>
        <Group label="누구 기준">
          {AGES.map((x) => <Chip g="age" key={x.id} on={s.age === x.id} onClick={() => s.set({ age: x.id })}>{x.name}</Chip>)}
        </Group>
        <label className="slider">
          <span>기준 시간 <b>{T}분</b> <span className="badge assume">가정값</span></span>
          <input type="range" min={5} max={90} step={5} value={T} onChange={(e) => s.set({ thresholds: { ...s.thresholds, [s.service]: +e.target.value } })} />
        </label>

        <div className="hero">
          <p className="muted">{svc.name}까지 {s.mode === 'bus' ? '버스로' : s.mode === 'walk' ? '걸어서' : '자가용으로'} {T}분 넘게 걸리는 {ageName}</p>
          <p className="big bad">{fmt(gap)}<small>명</small></p>
          <p className="muted">전체의 {pct(d.rate)} · 군 평균은 <b style={{ color: cssColor(d.avgMinutes / T) }}>{Math.round(avg)}분</b>
            {d.avgMinutes <= T && d.gap > 0 ? ' — 평균만 보면 괜찮아 보여요' : ''}</p>
        </div>

        <div className="row">
          <motion.button className="primary" onClick={playSweep} whileTap={{ scale: 0.97 }} disabled={s.sweep != null}>
            {s.sweep != null ? `${Math.round(s.sweep)}분…` : '▶ 시간 스윕'}
          </motion.button>
          <button className="ghost" onClick={toggle3d}>{s.extruded ? '평면으로' : '3D로 보기'}</button>
        </div>

        <h3>공백이 큰 마을</h3>
        <motion.ol className="villages" initial="hidden" animate="show" key={`${s.service}-${s.mode}-${s.age}-${T}`} variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
          {d.topVillages.slice(0, 7).map((v) => (
            <motion.li key={v.village} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
              onMouseEnter={() => s.set({ hoverVillage: v.village })} onMouseLeave={() => s.set({ hoverVillage: null })} onClick={() => flyToVillage(v.village)}>
              <span>{m.villages[v.village].name}</span>
              <span className="muted">{fmt(v.gap)}명 · {Math.round(v.minutes)}분</span>
            </motion.li>
          ))}
          {!d.topVillages.length && <li className="muted">기준 시간 안에 모두 닿아요</li>}
        </motion.ol>
        <motion.button className="primary block" whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} onClick={() => nav(`/c/${m.county.sgg}/plan`)}>목표 정하고 대안 비교 →</motion.button>
        <p className="source">가상 데이터 · 경계 SGIS(admdongkor 2026.7) · 지도 © OpenStreetMap, OpenFreeMap</p>
      </motion.aside>

      <Legend T={T} aiCount={aiCount} />
      <AnimatePresence>{s.selectedCell != null && <CellCard key={`${m.county.sgg}-${s.selectedCell}`} m={m} cell={s.selectedCell} />}</AnimatePresence>
    </>
  )
}

function CellCard({ m, cell }: { m: Model; cell: number }) {
  const s = useStore()
  const c = m.cells[cell]
  const r = routeFrom(m, c.i, s.service, s.mode)
  const T = s.thresholds[s.service]
  return (
    <motion.div className="cellcard" initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
      <button className="close" onClick={() => s.set({ selectedCell: null })} aria-label="닫기">×</button>
      <p className="muted">{m.villages[c.village].name} 근처 500m 칸</p>
      <p><b>{Math.round(c.pop)}명</b> (80세 이상 {Math.round(c.p80)}명) {c.aiFilled && <AiBadge>AI가 채운 칸</AiBadge>}</p>
      <p className="big" style={{ color: cssColor(r.total / T) }}>{Math.round(r.total)}분<small> → {r.facility}</small></p>
      <motion.ol className="steps" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.35, delayChildren: 0.2 } } }}>
        {r.steps.map((st) => (
          <motion.li key={st.label} variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}>
            {st.label} <span className="muted">{Math.round(st.minutes)}분</span>
          </motion.li>
        ))}
      </motion.ol>
    </motion.div>
  )
}

function Legend({ T, aiCount }: { T: number; aiCount: number }) {
  const stops = [0, 0.5, 1, 1.5, 2]
  return (
    <div className="legend">
      <div className="ramp" style={{ background: `linear-gradient(90deg, ${stops.map((r) => cssColor(r)).join(',')})` }} />
      <div className="ramp-labels"><span>0</span><span>{T}분 (기준)</span><span>{T * 2}분+</span></div>
      <p><span className="hatch" /> 통계에서 가려져 AI가 채운 칸 {fmt(aiCount)}개 <AiBadge /></p>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="group"><span className="group-label">{label}</span><div className="chips">{children}</div></div>
}
function Chip({ g, on, dashed, onClick, children }: { g: string; on: boolean; dashed?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`chip ${dashed ? 'dashed' : ''} ${on ? 'on' : ''}`} onClick={onClick}>
      {on && <motion.span layoutId={`chip-${g}`} className="chip-bg" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
      <span className="chip-text">{children}</span>
    </button>
  )
}
