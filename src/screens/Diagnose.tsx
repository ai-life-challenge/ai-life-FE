// S2 현황 진단: 왼쪽 패널에 의료·교통 취약도 게이지 + 지표 6개(공식 기준선, 누르면 계산식), 오른쪽 지도에 응급실까지 500m 격자.
// 격자 인터랙션(펼침·시간 스윕·3D·AI 빗금·칸 클릭 경로·마을 호버)은 VillageCoverage 공백 진단과 같다.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { regionOf, type Region } from '../data/regions'
import { STD, indicators, isVulnerable, preset, score, tau, type Ind, type Score } from '../sim/model'
import { fmt, pct, useCountUp } from '../motion/useCountUp'
import { tween } from '../motion/tween'
import { useStore } from '../store'
import { AGES, diagnoseGrid, routeFrom, travel, type AgeId, type Grid, type ModeId } from '../map/grid'
import { cssColor } from '../map/colors'
import { fitCounty } from '../map/geo'
import { Count } from '../ui/Count'
import { AiBadge, LevelBadge, SrcBadge } from '../ui/Badges'

type Status = 'good' | 'near' | 'poor'
interface Row { id: string; label: string; value: string; sub: string; bar: number; std: number; stdLabel: string; status: Status; calc: React.ReactNode; src: string }

const n1 = (x: number) => x.toFixed(1)
const n2 = (x: number) => x.toFixed(2)
const worse = (x: number, limit: number, near = 0.85): Status => (x >= limit ? 'poor' : x >= limit * near ? 'near' : 'good')

function rows(r: Region, ind: Ind, s: Score): { med: Row[]; tra: Row[] } {
  const t = tau(r)
  return {
    med: [
      { id: 'e30', label: '응급실 30분 밖 주민', value: pct(ind.e30), sub: `취약지 기준 ${pct(STD.theta)}`, bar: ind.e30, std: STD.theta, stdLabel: `기준 ${pct(STD.theta)}`, status: worse(ind.e30, STD.theta), src: 'e30',
        calc: <>비율 지표라 값이 그대로 점수예요: {pct(ind.e30)} → {Math.round(ind.e30 * 100)}점. 단, 자가용이 없는 주민(τ = 고령비율×0.5 = {pct(t)})은 대중교통으로 병원에 가므로 <b>실효 E30</b> = (1−τ)×{pct(ind.e30)} + τ×{pct(ind.pt)}(대중교통 60분 밖) = <b>{pct(s.parts.e30)}</b> → {Math.round(s.parts.e30 * 100)}점을 써요. 버스 증차가 의료 점수를 낮추는 연결고리예요.</> },
      { id: 'e60', label: '권역센터 60분 밖 주민', value: pct(ind.e60), sub: `취약지 기준 ${pct(STD.theta)}`, bar: ind.e60, std: STD.theta, stdLabel: `기준 ${pct(STD.theta)}`, status: worse(ind.e60, STD.theta), src: 'e30',
        calc: <>비율 지표라 그대로: {pct(ind.e60)} → {Math.round(ind.e60 * 100)}점</> },
      { id: 'd', label: '인구 1천명당 의사 수', value: `${n2(ind.D)}명`, sub: `전국 평균의 ${pct(ind.D / STD.natD)}`, bar: Math.min(1, ind.D / (1.5 * STD.natD)), std: 1 / 1.5, stdLabel: `전국 ${STD.natD}명`, status: ind.D >= STD.natD ? 'good' : ind.D >= STD.natD * 0.85 ? 'near' : 'poor', src: 'doctors',
        calc: <>수량 지표라 전국 평균 대비 부족률: (T − D) / T = ({STD.natD} − {n2(ind.D)}) / {STD.natD} = {n2(s.parts.d)} → {Math.round(s.parts.d * 100)}점</> },
    ],
    tra: [
      { id: 'ms', label: '대중교통 최소서비스', value: pct(ind.ms), sub: ind.ms >= STD.msTarget ? '확보' : ind.ms >= 0.6 ? '취약 (80% 미달)' : '사각 (60% 미만)', bar: ind.ms, std: STD.msTarget, stdLabel: `확보 ${pct(STD.msTarget)}`, status: ind.ms >= STD.msTarget ? 'good' : ind.ms >= 0.6 ? 'near' : 'poor', src: 'ms',
        calc: <>MS = (공간 {pct(ind.sp)} + 시간 {pct(ind.tp)}) / 2 = {pct(ind.ms)}. 좋은 방향 비율 지표라 1 − {n2(ind.ms)} = {n2(s.parts.ms)} → {Math.round(s.parts.ms * 100)}점</> },
      { id: 'ar', label: '교통사고 사망률', value: `${n1(ind.ar)}명`, sub: `10만명당 · 전국 평균의 ${n1(ind.ar / STD.natAR)}배`, bar: Math.min(1, ind.ar / (2 * STD.natAR)), std: 0.5, stdLabel: `전국 ${STD.natAR}명`, status: worse(ind.ar, STD.natAR * 1.2, 0.83), src: 'ar',
        calc: <>전국 평균의 2배를 100점으로: AR / (2 × {STD.natAR}) = {n1(ind.ar)} / {n1(2 * STD.natAR)} = {n2(s.parts.ar)} → {Math.round(s.parts.ar * 100)}점 <SrcBadge kind="assume" id="std" note="설정값" /></> },
      { id: 'ht', label: '병원까지 대중교통', value: `${Math.round(ind.ht)}분`, sub: `배차간격 ${Math.round(ind.h)}분`, bar: Math.min(1, ind.ht / STD.htFull), std: STD.ptLimit / STD.htFull, stdLabel: `참고 ${STD.ptLimit}분`, status: worse(ind.ht, STD.ptLimit, 0.75), src: 'ht',
        calc: <>t = 도보 {Math.round(ind.walk)} + 배차 {Math.round(ind.h)}/2 + 승차 {r.ride} = {Math.round(ind.ht)}분. {STD.htFull}분을 100점으로: {Math.round(ind.ht)} / {STD.htFull} = {n2(s.parts.ht)} → {Math.round(s.parts.ht * 100)}점 <SrcBadge kind="assume" id="std" note="설정값" /></> },
    ],
  }
}

// 지표를 누르면 지도도 그 지표 기준으로 바뀐다 (응급실 30분 = 자가용, 병원까지 대중교통 = 버스 60분)
const MAP_OF: Record<string, { mode: ModeId; T: number }> = { e30: { mode: 'car', T: 30 }, ht: { mode: 'bus', T: 60 } }

export function Diagnose({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { code } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const r = regionOf(code)!
  const ind = indicators(r)
  const p = preset('bal')
  const s = score(ind, p)
  const { med, tra } = rows(r, ind, s)
  const [open, setOpen] = useState<string | null>(null)
  const [formula, setFormula] = useState(false)
  const st = useStore()
  const g = st.grid?.region.code === r.code ? st.grid : null

  // 군이 바뀌면: 격자를 만들고 → 카메라를 군으로 → 잠시 군 평균 한 색으로 보여 준 뒤 격자로 펼친다
  useEffect(() => {
    if (!st.mapReady) return
    let timer = 0
    useStore.getState().set({ unfolded: false, selectedCell: null, sweep: null })
    useStore.getState().loadRegion(r.code).then((grid) => {
      if (!grid) return
      fitCounty(mapRef.current, grid.bbox, { pitch: useStore.getState().extruded ? 50 : 15 })
      timer = window.setTimeout(() => useStore.getState().set({ unfolded: true }), reduce ? 0 : 2000)
    })
    return () => clearTimeout(timer)
  }, [r.code, mapRef, reduce, st.mapReady])

  const toggle = (id: string) => {
    const next = open === id ? null : id
    setOpen(next)
    const m = next && MAP_OF[next]
    if (m) st.set({ mode: m.mode, T: m.T, selectedCell: null, unfolded: true })
  }

  return (
    <>
      <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
        <p className="eyebrow">2단계 · 현황 진단</p>
        <div className="region-head">
          <motion.h1 layoutId={`region-${r.code}`}>{r.name} 현황</motion.h1>
          <LevelBadge level={r.level} />
          {isVulnerable(ind) && <span className="badge red">응급의료 취약지</span>}
          <button className="link small" onClick={() => nav('/start')}>지역 바꾸기</button>
        </div>
        <p className="muted small">정부 공식 기준(응급의료 취약지 27%, 대중교통 최소서비스 80%)으로 진단했어요. 점선이 기준선이고, 기준을 넘으면 빨간색이에요.</p>

        <div className="gauges">
          <Gauge label="의료 취약도" value={s.mvi} delay={0} />
          <Gauge label="교통 취약도" value={s.tvi} delay={150} />
        </div>
        <p className="muted small" style={{ marginTop: -10 }}>0점이 가장 좋고 100점이 가장 취약해요 · ⚖️ 균형 가중치 기준</p>

        {g ? <MapControls g={g} mapRef={mapRef} /> : <p className="muted small">지도를 준비하는 중…</p>}

        <Group title="🏥 의료" rows={med} open={open} toggle={toggle} />
        <Group title="🚌 교통" rows={tra} open={open} toggle={toggle} />
        <div className="legend-row"><span><i style={{ background: 'var(--ok)' }} />기준 충족</span><span><i style={{ background: '#d39a14' }} />근접</span><span><i style={{ background: 'var(--bad)' }} />미달</span><span>🗺 = 누르면 지도도 바뀜</span></div>

        <div className="formula">
          <button onClick={() => setFormula(!formula)} aria-expanded={formula}>점수 계산 방법 보기 <span>{formula ? '▴' : '▾'}</span></button>
          <AnimatePresence>
            {formula && (
              <motion.div className="formula-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                <p>비율 지표(나쁜 방향)는 값 그대로, 좋은 방향은 1 − 값, 수량 지표는 전국 평균 대비 부족률을 점수로 써요. 지역 3개뿐이라 지역 간 min-max는 쓰지 않아요.</p>
                <p><code>MVI = 100 × ({p.wm[0]}·E30실효 + {p.wm[1]}·E60 + {p.wm[2]}·s_D)</code> = 100 × ({n2(s.parts.e30)}·{p.wm[0]} + {n2(s.parts.e60)}·{p.wm[1]} + {n2(s.parts.d)}·{p.wm[2]}) = <b>{Math.round(s.mvi)}</b></p>
                <p><code>TVI = 100 × ({p.wt[0]}·(1−MS) + {p.wt[1]}·s_AR + {p.wt[2]}·s_HT)</code> = 100 × ({n2(s.parts.ms)}·{p.wt[0]} + {n2(s.parts.ar)}·{p.wt[1]} + {n2(s.parts.ht)}·{p.wt[2]}) = <b>{Math.round(s.tvi)}</b></p>
                <p><code>V = γ·MVI + (1−γ)·TVI</code>, γ = 의료 비중 (목표 프리셋마다 다름, 균형 {p.gamma}) → 종합 <b>{Math.round(s.v)}</b>점</p>
                <p className="row"><span className="muted small">가중치는 팀 AHP로 확정 전 예시값이에요.</span><SrcBadge kind="assume" id="weights" note="가중치" /></p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="next-row">
          <button className="ghost" onClick={() => nav('/start')}>← 지역</button>
          <button className="primary" onClick={() => nav(`/r/${r.code}/goal`)}>다음: 목표 정하기 →</button>
        </div>
        <p className="source">격자의 마을·인구·버스는 가상 데이터 · 경계 SGIS(admdongkor 2026.7) · 지도 © OpenStreetMap, OpenFreeMap</p>
      </motion.aside>
      {g && <Legend g={g} />}
      <AnimatePresence>{g && st.selectedCell != null && <CellCard key={`${g.region.code}-${st.selectedCell}-${st.mode}`} g={g} cell={st.selectedCell} />}</AnimatePresence>
    </>
  )
}

// 지도 조건 · 공백 인구 · 시간 스윕 · 3D · 공백이 큰 마을 (VillageCoverage 공백 진단과 같은 인터랙션)
function MapControls({ g, mapRef }: { g: Grid; mapRef: React.RefObject<MapRef | null> }) {
  const s = useStore()
  const reduce = useReducedMotion()
  const d = useMemo(() => diagnoseGrid(g, travel(g, s.mode).t, s.age, s.T), [g, s.mode, s.age, s.T])
  const gap = useCountUp(s.unfolded ? d.gap : 0)
  const avg = useCountUp(d.avgMinutes)
  const ageName = AGES.find((a) => a.id === s.age)!.name
  const playSweep = () => {
    s.set({ selectedCell: null, unfolded: true })
    if (reduce) return
    tween(0, s.T * 1.6, 3000, (v) => useStore.getState().set({ sweep: v }), { ease: (x) => x, onDone: () => useStore.getState().set({ sweep: null }) })
  }
  const toggle3d = () => {
    const ex = !s.extruded
    s.set({ extruded: ex })
    mapRef.current?.easeTo({ pitch: ex ? 55 : 20, duration: 1200 })
  }
  const flyToVillage = (vi: number) => {
    const v = g.villages[vi]
    mapRef.current?.flyTo({ center: [v.lon, v.lat], zoom: 12.5, duration: 1400, padding: { left: 460, top: 0, right: 0, bottom: 0 } })
  }
  return (
    <section className="map-card">
      <h3>🗺 응급실까지 걸리는 시간 <span className="muted small">500m 격자</span></h3>
      <Chips g="mode" items={[{ id: 'car', label: '자가용 (E30 기준)' }, { id: 'bus', label: '버스 (병원 대중교통)' }]} value={s.mode} onPick={(id) => s.set({ mode: id as ModeId, T: id === 'car' ? 30 : 60, selectedCell: null })} />
      <Chips g="age" items={AGES.map((a) => ({ id: a.id, label: a.name }))} value={s.age} onPick={(id) => s.set({ age: id as AgeId })} />
      <label className="slider">
        <span>기준 시간 <b>{s.T}분</b> <span className="badge assume">가정값</span></span>
        <input type="range" min={10} max={90} step={5} value={s.T} onChange={(e) => s.set({ T: +e.target.value })} />
      </label>
      <div className="hero">
        <p className="muted small" style={{ margin: 0 }}>응급실까지 {s.mode === 'bus' ? '버스로' : '자가용으로'} {s.T}분 넘게 걸리는 {ageName}</p>
        <p className="big bad" style={{ margin: '2px 0' }}>{fmt(gap)}<small>명</small></p>
        <p className="muted small" style={{ margin: 0 }}>전체의 {pct(d.rate)} · 군 평균은 <b style={{ color: cssColor(d.avgMinutes / s.T) }}>{Math.round(avg)}분</b>{d.avgMinutes <= s.T && d.gap > 0 ? ' — 평균만 보면 괜찮아 보여요' : ''}</p>
      </div>
      <div className="row">
        <motion.button className="primary" onClick={playSweep} whileTap={{ scale: 0.97 }} disabled={s.sweep != null}>{s.sweep != null ? `${Math.round(s.sweep)}분…` : '▶ 시간 스윕'}</motion.button>
        <button className="ghost" onClick={toggle3d}>{s.extruded ? '평면으로' : '3D로 보기'}</button>
      </div>
      <h3 style={{ marginTop: 16 }}>공백이 큰 마을</h3>
      <motion.ol className="villages" initial="hidden" animate="show" key={`${s.mode}-${s.age}-${s.T}`} variants={{ show: { transition: { staggerChildren: 0.04 } } }}>
        {d.topVillages.slice(0, 6).map((v) => (
          <motion.li key={v.village} variants={{ hidden: { opacity: 0, x: -8 }, show: { opacity: 1, x: 0 } }}
            onMouseEnter={() => s.set({ hoverVillage: v.village })} onMouseLeave={() => s.set({ hoverVillage: null })} onClick={() => flyToVillage(v.village)}>
            <span>{g.villages[v.village].name}</span>
            <span className="muted">{fmt(v.gap)}명 · {Math.round(v.minutes)}분</span>
          </motion.li>
        ))}
        {!d.topVillages.length && <li className="muted">기준 시간 안에 모두 닿아요</li>}
      </motion.ol>
      <p className="muted small" style={{ margin: '8px 0 0' }}>지도에서 칸을 누르면 응급실까지 가는 길이 그려져요.</p>
    </section>
  )
}

function Chips({ g, items, value, onPick }: { g: string; items: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <div className="chips" style={{ marginTop: 8 }}>
      {items.map((x) => (
        <button key={x.id} className={`chip ${value === x.id ? 'on' : ''}`} onClick={() => onPick(x.id)} aria-pressed={value === x.id}>
          {value === x.id && <motion.span layoutId={`chip-${g}`} className="chip-bg" transition={{ type: 'spring', stiffness: 400, damping: 30 }} />}
          <span className="chip-text">{x.label}</span>
        </button>
      ))}
    </div>
  )
}

function CellCard({ g, cell }: { g: Grid; cell: number }) {
  const s = useStore()
  const c = g.cells[cell]
  const rt = routeFrom(g, c.i, s.mode)
  return (
    <motion.div className="cellcard" initial={{ opacity: 0, scale: 0.92, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ type: 'spring', stiffness: 320, damping: 26 }}>
      <button className="close" onClick={() => s.set({ selectedCell: null })} aria-label="닫기">×</button>
      <p className="muted">{g.villages[c.village].name} 근처 500m 칸</p>
      <p><b>{Math.round(c.pop)}명</b> (80세 이상 {Math.round(c.p80)}명) {c.aiFilled && <AiBadge>AI가 채운 칸</AiBadge>}</p>
      <p className="big" style={{ color: cssColor(rt.total / s.T) }}>{Math.round(rt.total)}분<small> → {rt.facility}</small></p>
      <motion.ol className="steps" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.35, delayChildren: 0.2 } } }}>
        {rt.steps.map((x) => (
          <motion.li key={x.label} variants={{ hidden: { opacity: 0, x: -6 }, show: { opacity: 1, x: 0 } }}>{x.label} <span className="muted">{Math.round(x.minutes)}분</span></motion.li>
        ))}
      </motion.ol>
    </motion.div>
  )
}

function Legend({ g }: { g: Grid }) {
  const T = useStore((s) => s.T)
  const stops = [0, 0.5, 1, 1.5, 2]
  return (
    <div className="legend">
      <div className="ramp" style={{ background: `linear-gradient(90deg, ${stops.map((x) => cssColor(x)).join(',')})` }} />
      <div className="ramp-labels"><span>0</span><span>{T}분 (기준)</span><span>{T * 2}분+</span></div>
      <p><span className="dot-er" /> 군립병원 응급실</p>
      <p><span className="hatch" /> 통계에서 가려져 AI가 채운 칸 {fmt(g.cells.filter((c) => c.aiFilled).length)}개 <AiBadge /></p>
    </div>
  )
}

function Gauge({ label, value, delay }: { label: string; value: number; delay: number }) {
  const color = value >= 50 ? 'var(--bad)' : value >= 30 ? '#d39a14' : 'var(--ok)'
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 116" role="img" aria-label={`${label} ${Math.round(value)}점`}>
        <path d="M 16 104 A 84 84 0 0 1 184 104" fill="none" stroke="#fff" strokeWidth="18" strokeLinecap="round" />
        <motion.path d="M 16 104 A 84 84 0 0 1 184 104" fill="none" stroke={color} strokeWidth="18" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: value / 100 }} transition={{ duration: 0.9, delay: delay / 1000, ease: 'easeOut' }} />
      </svg>
      <div className="big"><Count value={value} delay={delay} /><small>점</small></div>
      <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{label}</p>
    </div>
  )
}

function Group({ title, rows, open, toggle }: { title: string; rows: Row[]; open: string | null; toggle: (id: string) => void }) {
  return (
    <section className="ind-group">
      <h3>{title}</h3>
      {rows.map((row, k) => (
        <div className="ind" key={row.id}>
          <button className="ind-head" onClick={() => toggle(row.id)} aria-expanded={open === row.id}>
            <span>{row.label} {MAP_OF[row.id] && <span title="누르면 지도도 이 기준으로 바뀌어요">🗺</span>} <span className="muted small">{open === row.id ? '▴' : '▾'}</span></span>
            <span className="track">
              <motion.span className={`fill ${row.status}`} initial={{ width: 0 }} animate={{ width: `${row.bar * 100}%` }} transition={{ duration: 0.8, delay: 0.2 + k * 0.08, ease: 'easeOut' }} />
              <span className="std-line" style={{ left: `${row.std * 100}%` }}><span>{row.stdLabel}</span></span>
            </span>
            <span className={`ind-val ${row.status === 'poor' ? 'bad' : ''}`}>{row.value}<small>{row.status === 'poor' ? '⚠ ' : ''}{row.sub}</small></span>
          </button>
          <AnimatePresence>
            {open === row.id && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                <div className="ind-body">
                  <div className="calc">{row.calc}</div>
                  <div className="row"><SrcBadge kind="public" id={row.src} note="예시값" /></div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </section>
  )
}
