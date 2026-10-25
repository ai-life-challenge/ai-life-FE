// S2 현황 진단: 왼쪽 패널 위에 의료·교통 취약도 게이지와 '응급의료 취약지' 판정, 가운데 카드에 조건 바꾸기 + 공백 인구 + 시간 스윕 + 공백이 큰 마을,
// 아래에 지표별 기준선과 계산식. 오른쪽 지도는 마을별 판정(서버 판정과 대조)과 응급실까지 시간 격자.
// 취약도는 서버에 없어서 서버 지표(E30·E60·의사 수 등)로 화면에서 계산한다(api/vuln.ts). 응급실까지 시간은 서버의 마을별 도로 기준 값이다.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { api } from '../api/client'
import type { NearestEr, NearestMed, VillageDetail, VillageState } from '../api/types'
import { AGES, STATE_CSS, STATE_NAME, fmt, pct } from '../api/meta'
import { useAutoFetch, useJudgeCompare, useShownJudge } from '../hooks'
import { calcKey, errText, useStore } from '../store'
import type { CarTarget } from '../api/judge'
import { MINUTE_STOPS, minuteRgb } from '../api/cells'
import { STD, W, overLimit, villageTimes, vulnOf, type Vuln } from '../api/vuln'
import { KIND_RE, targetMinutes } from '../api/judge'
import { boxOf, fitCounty } from '../map/geo'
import { Count } from '../ui/Count'
import { LevelBadge, SrcBadge } from '../ui/Badges'
import { Chevron } from '../ui/Chevron'
import { Seg } from '../ui/Seg'

// 이동 수단 탭: 대중교통은 서버 판정('병원 가는 길'), 자가용은 서버에 없는 판정이라 화면에서 계산한다(api/judge.ts judgeCar)
const TRAVEL = [
  { id: 'transit', name: '🚌 대중교통 이용', desc: '' },
  { id: 'car', name: '🚗 자가용 이용', desc: '차가 있는 주민 기준이에요. 아래에서 고른 곳까지 자가용 시간(서버 값, 도로 기준)이 기준 안인지 봐요.' },
] as const
const CAR_TARGETS: { id: CarTarget; name: string; short: string }[] = [
  { id: 'med', name: '모든 병의원', short: '병의원' }, { id: 'hospital', name: '병원·종합병원', short: '병원·종합병원' }, { id: 'clinic', name: '동네 의원', short: '동네 의원' },
  { id: 'public', name: '보건소·진료소', short: '보건소·진료소' }, { id: 'er', name: '응급의료센터', short: '응급의료센터' },
]
// 받침에 맞는 조사(이/가 · 을/를): 필터 이름이 바뀌어도 문장이 어색하지 않게
const josa = (w: string, a: string, b: string) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 === 0 ? b : a)

export function Diagnose({ mapRef }: { mapRef: React.RefObject<MapRef | null> }) {
  const { code } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion()
  const { regions, data, state, judge, mapReady, sweep, travel, carTarget, set, patch } = useStore()
  const r = regions.find((x) => x.code === code)!
  const st = state!
  const shown = useShownJudge()
  const cmp = useJudgeCompare()
  useAutoFetch('fetchJudge')

  useEffect(() => { if (mapReady && data) fitCounty(mapRef.current, boxOf(data.villages), { duration: 1400 }) }, [mapReady, data, mapRef])
  useEffect(() => () => set({ sweep: null, travel: 'transit', carTarget: 'med' }), [set]) // 다른 화면(결과 등)은 서버 판정 기준이라 나갈 때 대중교통으로 되돌린다

  const vuln = useMemo(() => vulnOf(data!), [data])
  const times = useMemo(() => villageTimes(data!, st.age), [data, st.age])
  const T = st.criteria.carMinutes
  const over = useMemo(() => overLimit(times, T), [times, T])
  const e30 = useMemo(() => overLimit(times, 30), [times]) // 응급실 카드는 슬라이더가 아니라 E30 정의(30분)로 센다
  const minutesOf = useMemo(() => { const m = targetMinutes(data!, carTarget); return new Map(data!.villages.map((v, i) => [v.id, m[i]])) }, [data, carTarget]) // 공백 큰 마을 목록의 분: 고른 시설까지
  const targetName = CAR_TARGETS.find((x) => x.id === carTarget)!.short
  const gapList = useMemo(() => (shown ? shown.villages.filter((v) => v.state !== 0).sort((a, b) => b.people - a.people).slice(0, 6) : []), [shown])
  const precise = data!.tier === 'precise'
  const ageName = AGES.find((a) => a.id === st.age)!.name
  const sum = shown?.summary

  // 시간 스윕: 0분부터 기준 시간의 1.6배까지 3초 동안 늘리며, 그 시간 안에 닿는 칸만 지도에 칠한다
  const playSweep = () => {
    if (reduce) return
    animate(0, Math.max(T * 1.6, 45), { duration: 3, ease: 'linear', onUpdate: (v) => set({ sweep: v }), onComplete: () => set({ sweep: null }) })
  }

  return (
    <>
    <Legend />
    <VillageCard />
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">2단계 · 현황 진단</p>
      <div className="region-head">
        <h1>{r.name} 현황</h1>
        <LevelBadge tier={r.tier} />
        {vuln.vulnerable && <span className="badge red" title={`응급실 30분 밖 또는 권역센터 60분 밖 주민이 ${pct(STD.theta)} 이상이에요 (보건복지부 응급의료 취약지 정의)`}>응급의료 취약지</span>}
        {!vuln.vulnerable && data!.erVulnerable && <span className="badge" title="2021년 보건복지부 고시로 지정됐지만, 지금 지표로는 기준(30%) 아래예요">응급의료 취약지(2021 지정)</span>}
        {data!.shrinkingArea && <span className="badge" title="행정안전부 인구감소지역(2021 지정)">인구감소지역</span>}
        <button className="link small" onClick={() => nav('/start')}>지역 바꾸기</button>
      </div>
      <p className="muted small">정부 공식 기준(응급의료 취약지 {pct(STD.theta)}, 대중교통 최소서비스 {pct(STD.msTarget)})으로 진단했어요. 점선이 기준선이고, 기준을 넘으면 빨간색이에요.</p>

      <div className="gauges">
        <Gauge label="의료 취약도" value={vuln.mvi} delay={0} worst={worstOf([['응급실 30분 밖 주민', vuln.parts.e30 ?? 0], ['권역센터 60분 밖 주민', vuln.parts.e60 ?? 0], ['의사 수', vuln.parts.d]])} />
        <Gauge label="교통 취약도" value={vuln.tvi} delay={150} worst={worstOf([['대중교통 최소서비스', vuln.parts.ms], ['정류장까지 걷는 시간', vuln.parts.walk]])} />
      </div>
      <p className="muted small" style={{ marginTop: -6 }}>0점이 가장 좋고 100점이 가장 취약해요 · 50점 = 정부 기준선 · ⚖️ 균형 가중치 기준</p>

      <section className="map-card">
        <h3>🗺 병원까지 가는 길 <span className="muted small">시간은 서버 도로 기준</span></h3>
        <div className="field"><span className="field-label" id="lb-travel">이동 수단</span>
          <Seg id="travel" label="이동 수단" options={TRAVEL.map((x) => ({ id: x.id, name: x.name }))} value={travel}
            onChange={(id) => { set({ travel: id }); if (id === 'transit' && st.service !== 'med') patch((s) => ({ ...s, service: 'med' })) }} /></div>
        <div className="field"><span className="field-label">나이대</span>
          <Seg id="age" label="나이대" options={AGES.map((a) => ({ id: a.id, name: a.name }))} value={st.age} onChange={(id) => patch((s) => ({ ...s, age: id }))} /></div>
        <div className="field"><span className="field-label">어디까지 가나요 <span className="muted">· 고르면 지도 색과 ✕가 바뀌어요</span></span>
          <div className="chips" role="radiogroup" aria-label="어느 시설 기준">
            {CAR_TARGETS.map((x) => (
              <button key={x.id} role="radio" aria-checked={carTarget === x.id} className={`chip ${carTarget === x.id ? 'on' : ''}`} onClick={() => set({ carTarget: x.id })}>{carTarget === x.id && <span aria-hidden>✓ </span>}{x.name}</button>
            ))}
          </div></div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>{travel === 'transit' ? (carTarget === 'er' ? '응급의료센터는 버스를 보지 않고, 지역응급의료센터 이상까지 자가용 시간만 봐요.' : `차가 없는 주민 기준이에요. 마을 안에 ${targetName}${josa(targetName, '이', '가')} 있거나, 정류장까지 걸어가 버스로 ${targetName}에 갈 수 있는지 봐요.`) : TRAVEL.find((x) => x.id === travel)!.desc}</p>
        {travel === 'car' ? (
          <>
            <p className="muted small" style={{ margin: '6px 0 0' }}>{carTarget === 'er' ? (T === 30 ? '지역응급의료센터 이상(권역센터 포함)까지예요. 30분일 때 서버 E30와 같은 기준이에요.' : `지역응급의료센터 이상(권역센터 포함)까지예요. 30분이 서버 E30 기준이라 ${T}분은 서버 값과 달라요.`) : `마을 안에 ${targetName}${josa(targetName, '이', '가')} 있으면 갈 수 있는 마을로 봐요.${carTarget === 'med' ? '' : ' (서버 시험 자료: 종류별 가장 가까운 곳)'}`}</p>
            <Slider label={`${targetName}까지 자가용`} unit="분 이내" min={10} max={60} step={5} value={T} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, carMinutes: v } }))} />
          </>
        ) : (
          <>
            <Slider label="정류장까지 걸어서" unit="분 이내" min={5} max={30} step={1} value={st.criteria.stopWalkMinutes} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, stopWalkMinutes: v } }))} />
            <Slider label="버스 하루 운행" unit="번 이상" min={1} max={10} step={1} value={st.criteria.dailyRuns} disabled={!precise}
              note={precise ? '읍내행 첫차는 낮 12시 전이어야 해요' : '이 지역은 간이 판정이라 정류장까지 거리만 봐요'} onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, dailyRuns: v } }))} />
            {st.service === 'med' && <Slider label="병원이 너무 먼 기준 · 자가용" unit="분 넘게" min={10} max={60} step={5} value={T} note="이보다 멀면 버스가 있어도 '병원이 너무 멀어 못 감'이에요" onChange={(v) => patch((s) => ({ ...s, criteria: { ...s.criteria, carMinutes: v } }))} />}
          </>
        )}

        {sum && (
          <div className="hero">
            <p className="muted small" style={{ margin: 0 }}>{ageName} {fmt(sum.total)}명 중 {travel === 'car' ? `자가용으로 ${T}분 안에 ${targetName}${josa(targetName, '이', '가')} 없는` : st.service === 'med' ? (carTarget === 'med' ? '차 없이 병원에 갈 수 없는' : carTarget === 'er' ? `${targetName}(${T}분 이내)에 갈 수 없는` : `차 없이 ${targetName}에 갈 수 없는`) : '버스를 탈 수 없는'} 사람</p>
            <p className="big bad"><Count value={sum.gap} /><small>명 ({pct(sum.rate)})</small></p>
            {travel === 'car' ? (
              <p className="small muted" style={{ margin: 0 }}>{targetName}{josa(targetName, '이', '가')} 너무 먼 마을 {sum.villagesNoFacility}곳{carTarget === 'er' && over.avg > 0 ? ` · 군 평균 응급의료센터까지 ${Math.round(over.avg)}분` : ''} · 서버에 자가용 판정이 없어 서버의 도로 기준 시간으로 화면에서 계산했어요</p>
            ) : (
              <>
                <p className="small" style={{ margin: 0 }}>
                  버스가 없어 못 가는 <b className="num">{fmt(sum.noBus)}명</b>({sum.villagesNoBus}곳)
                  {st.service === 'med' && <> · {targetName}{josa(targetName, '이', '가')} 너무 먼 <b className="num">{fmt(sum.noFacility)}명</b>({sum.villagesNoFacility}곳)</>}
                </p>
                <ServerCheck />
              </>
            )}
          </div>
        )}
        {travel === 'car' && carTarget !== 'er' && times.length > 0 && (
          <div className="hero">
            <p className="muted small" style={{ margin: 0 }}>참고 · 응급실(지역응급의료센터 이상)까지 자가용으로 30분 넘게 걸리는 {ageName} <SrcBadge kind="public" id="indicators" note="서버 도로 시간" /></p>
            <p className="big bad"><Count value={e30.gap} /><small>명</small></p>
            <p className="muted small" style={{ margin: 0 }}>전체의 {pct(e30.rate)} · 군 평균은 <b style={{ color: `rgb(${minuteRgb(e30.avg).join(',')})` }}>{Math.round(e30.avg)}분</b>{e30.avg <= 30 && e30.gap > 0 ? ' — 평균만 보면 괜찮아 보여요' : ''}</p>
          </div>
        )}
        <div className="row">
          <motion.button className="primary" onClick={playSweep} whileTap={{ scale: 0.97 }} disabled={sweep != null || reduce === true}>{sweep != null ? `${Math.round(sweep)}분…` : '▶ 시간 스윕'}</motion.button>
          <span className="muted small">{targetName}까지 몇 분 만에 어디까지 닿는지 지도에 펼쳐 봐요</span>
        </div>

        <h3 style={{ marginTop: 16 }}>공백이 큰 마을</h3>
        {shown && !gapList.length && <p className="muted">이 기준에서는 못 가는 마을이 없어요.</p>}
        <ul className="villages">
          {gapList.map((v) => (
            <li key={v.id} onClick={() => patch((s) => ({ ...s, selectedVillage: v.id }))} onMouseEnter={() => set({ hoverVillage: v.id })} onMouseLeave={() => set({ hoverVillage: null })}>
              <span><i className="sw-x" aria-hidden>✕</i>{v.name}<span className="muted small"> · {v.state === 2 && carTarget !== 'med' ? `${targetName}${josa(targetName, '이', '가')} 너무 멀어 못 감` : STATE_NAME[v.state]}</span></span>
              <span className="muted"><b className="num" style={{ color: 'var(--ink)' }}>{fmt(v.people)}명</b>{minutesOf.get(v.id) != null && ` · ${targetName} ${minutesOf.get(v.id)! === 0 ? '마을 안' : Math.round(minutesOf.get(v.id)!) + '분'}`}</span>
            </li>
          ))}
        </ul>
      </section>

      <Indicators v={vuln} />

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

// 반원 게이지: 50점(정부 기준선)에 점선 눈금을 긋고, 점수 아래에 상태(양호 · 주의 · 위험)와 가장 나쁜 지표를 적는다
const ARC = 'M 16 104 A 84 84 0 0 1 184 104'
const worstOf = (xs: [string, number][]) => xs.reduce((a, [name, score]) => (score > a.score ? { name, score } : a), { name: xs[0][0], score: -1 })
function Gauge({ label, value, delay, worst }: { label: string; value: number; delay: number; worst: { name: string; score: number } }) {
  const level = value >= 50 ? { color: 'var(--bad)', text: `위험 · 기준선 ${Math.round(value - 50)}점 초과` } : value >= 30 ? { color: '#e07a1f', text: `주의 · 기준선까지 ${Math.round(50 - value)}점` } : { color: 'var(--ok)', text: '양호' }
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 116" role="img" aria-label={`${label} ${Math.round(value)}점, ${level.text}`}>
        <path d={ARC} fill="none" stroke="#fff" strokeWidth="18" strokeLinecap="round" />
        <motion.path d={ARC} fill="none" stroke={level.color} strokeWidth="18" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: Math.max(0.001, value / 100) }} transition={{ duration: 0.9, delay: delay / 1000, ease: 'easeOut' }} />
        <line x1="100" y1="6" x2="100" y2="34" stroke="var(--ink)" strokeWidth="2" strokeDasharray="3 3" />
        <text x="108" y="14" fontSize="11" fill="var(--muted)">기준 50</text>
      </svg>
      <div className="big" style={{ color: value >= 30 ? level.color : undefined }}><Count value={value} delay={delay} /><small>점</small></div>
      <p style={{ margin: '4px 0 0', fontWeight: 600 }}>{label}</p>
      <p className="gauge-level" style={{ color: level.color }}>{level.text}</p>
      <p className="muted small" style={{ margin: '2px 0 0' }}>{worst.score >= 0.5 ? `${worst.name} 기준 미달` : `가장 나쁜 지표: ${worst.name}`} ({Math.round(worst.score * 100)}점)</p>
    </div>
  )
}

type Status = 'good' | 'near' | 'poor'
interface Row { id: string; label: string; value: string; sub: string; bar: number; std: number; stdLabel: string; status: Status; calc: React.ReactNode; src: React.ReactNode }
const n2 = (x: number) => x.toFixed(2)
const worse = (x: number, limit: number, near = 0.85): Status => (x >= limit ? 'poor' : x >= limit * near ? 'near' : 'good')
const pub = <SrcBadge kind="public" id="indicators" note="서버 지표" />

// 지표별 기준선 막대와 계산식, 맨 아래 점수 계산 방법
function Indicators({ v }: { v: Vuln }) {
  const [open, setOpen] = useState<string | null>(null)
  const [formula, setFormula] = useState(false)
  const med: Row[] = [
    ...(v.e30 == null || v.parts.e30 == null ? [] : [{ id: 'e30', label: '응급실 30분 밖 주민', value: pct(v.e30), sub: `취약지 기준 ${pct(STD.theta)}`, bar: v.e30, std: STD.theta, stdLabel: `기준 ${pct(STD.theta)}`, status: worse(v.e30, STD.theta), src: pub,
      calc: <>지역응급의료센터 이상까지 자가용으로 30분 넘게 걸리는(길이 없는 곳 포함) 주민 비율이에요(서버 지표, 도로 기준). 기준 {pct(STD.theta)}을 50점, 100%를 100점으로: {pct(v.e30)} → {Math.round(v.parts.e30 * 100)}점</> } as Row]),
    ...(v.e60 == null || v.parts.e60 == null ? [] : [{ id: 'e60', label: '권역센터 60분 밖 주민', value: pct(v.e60), sub: `취약지 기준 ${pct(STD.theta)}`, bar: v.e60, std: STD.theta, stdLabel: `기준 ${pct(STD.theta)}`, status: worse(v.e60, STD.theta), src: pub,
      calc: <>권역응급의료센터까지 자가용으로 60분 넘게 걸리는 주민 비율이에요(서버 지표). 같은 방법으로: {pct(v.e60)} → {Math.round(v.parts.e60 * 100)}점</> } as Row]),
    { id: 'd', label: '인구 1천명당 의사 수', value: `${n2(v.doctors)}명`, sub: `72개 군 평균의 ${pct(v.doctors / STD.avgD)}`, bar: Math.min(1, v.doctors / (2 * STD.avgD)), std: 0.5, stdLabel: `군 평균 ${STD.avgD}명`, status: v.doctors >= STD.avgD ? 'good' : v.doctors >= STD.avgD * 0.85 ? 'near' : 'poor', src: pub,
      calc: <>72개 군 평균 {STD.avgD}명을 50점, 0명을 100점으로: 1 − {n2(v.doctors)} ÷ {n2(2 * STD.avgD)} = {n2(v.parts.d)} → {Math.round(v.parts.d * 100)}점. 도시가 섞인 전국 평균 대신 비슷한 군끼리 비교해요.</> },
  ]
  const tra: Row[] = [
    { id: 'ms', label: '대중교통 최소서비스', value: pct(v.ms), sub: v.ms >= STD.msTarget ? '확보' : v.ms >= 0.6 ? '취약 (80% 미달)' : '사각 (60% 미만)', bar: v.ms, std: STD.msTarget, stdLabel: `확보 ${pct(STD.msTarget)}`, status: v.ms >= STD.msTarget ? 'good' : v.ms >= 0.6 ? 'near' : 'poor', src: pub,
      calc: <>{v.tp == null ? <>MS = 공간 {pct(v.sp)}. 이 지역은 간이 판정이라 하루 운행 횟수(시간) 자료가 없어 정류장까지 걸어서 닿는 주민 비율만 써요.</> : <>MS = (공간 {pct(v.sp)} + 시간 {pct(v.tp)}) / 2 = {pct(v.ms)}. 공간은 정류장까지 걸어서 닿는 주민, 시간은 하루 운행 기준을 채우는 주민 비율이에요.</>} 미확보 {pct(1 - v.ms)}를 기준(미확보 {pct(1 - STD.msTarget)}) = 50점, 100%를 100점으로 → {Math.round(v.parts.ms * 100)}점</> },
    { id: 'walk', label: '정류장까지 걷는 시간', value: `${v.walk.toFixed(1)}분`, sub: '주민 평균', bar: Math.min(1, v.walk / (2 * STD.walkStd)), std: 0.5, stdLabel: `참고 ${STD.walkStd}분`, status: worse(v.walk, STD.walkStd, 0.7), src: pub,
      calc: <>참고 기준 {STD.walkStd}분을 50점으로: {v.walk.toFixed(1)} ÷ {2 * STD.walkStd} = {n2(v.parts.walk)} → {Math.round(v.parts.walk * 100)}점. 원래 지표는 '병원까지 대중교통 시간'인데 노선 자료가 없어 정류장까지 걷는 시간으로 대신했어요.</> },
  ]
  const toggle = (id: string) => setOpen(open === id ? null : id)
  return (
    <>
      <IndGroup title="🏥 의료" rows={med} open={open} toggle={toggle} />
      <IndGroup title="🚌 교통" rows={tra} open={open} toggle={toggle} />
      <div className="legend-row"><span><i style={{ background: 'var(--ok)' }} />기준 충족</span><span><i style={{ background: '#d39a14' }} />근접</span><span><i style={{ background: 'var(--bad)' }} />미달</span></div>
      <div className="formula">
        <button onClick={() => setFormula(!formula)} aria-expanded={formula}>점수 계산 방법 보기 <Chevron open={formula} /></button>
        <AnimatePresence>
          {formula && (
            <motion.div className="formula-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <p>지표마다 정부 기준선(의사 수는 72개 군 평균)을 <b>50점</b>, 가장 나쁜 값을 100점으로 바꿔요. 비율 지표는 기준까지와 기준부터 100%까지 두 구간으로 나눠 펴서, 기준을 크게 넘어도 100점에 몰리지 않아요. 그래서 <b>50점을 넘으면 기준 미달</b>이에요.</p>
              <p><code>의료 = 100 × ({W.med.e30}·E30 + {W.med.e60}·E60 + {W.med.d}·의사)</code> = 100 × ({n2(v.parts.e30 ?? 0)}·{W.med.e30} + {n2(v.parts.e60 ?? 0)}·{W.med.e60} + {n2(v.parts.d)}·{W.med.d}) = <b>{Math.round(v.mvi)}</b></p>
              <p><code>교통 = 100 × ({W.tra.ms}·(1−MS) + {W.tra.walk}·걷는 시간)</code> = 100 × ({n2(v.parts.ms)}·{W.tra.ms} + {n2(v.parts.walk)}·{W.tra.walk}) = <b>{Math.round(v.tvi)}</b></p>
              <p className="muted small">교통사고 사망률은 자료가 없어 빼고, 남은 교통 지표에 원래 비율대로 가중치를 나눠 줬어요. 응급 자료가 없는 군은 그 지표를 빼고 남은 가중치로 다시 나눠요. 가중치는 팀 확정 전 예시값이에요.</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}

function IndGroup({ title, rows, open, toggle }: { title: string; rows: Row[]; open: string | null; toggle: (id: string) => void }) {
  return (
    <section className="ind-group">
      <h3>{title}</h3>
      {rows.map((row, k) => (
        <div className="ind" key={row.id}>
          <button className="ind-head" onClick={() => toggle(row.id)} aria-expanded={open === row.id}>
            <span>{row.label} <Chevron open={open === row.id} /></span>
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
                  <div className="row">{row.src}</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </section>
  )
}

// 서버 판정(기준)과 브라우저 판정을 대조한 결과
function ServerCheck() {
  const judge = useStore((s) => s.judge)
  const carTarget = useStore((s) => s.carTarget)
  const cmp = useJudgeCompare()
  const [open, setOpen] = useState(false)
  if (carTarget !== 'med') return <p className="small muted" role="status">서버는 이 필터를 몰라서 서버 판정과 대조하지 않아요 (서버 시험안)</p>
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
  const { showDots, showFacilities, travel, carTarget, data, set } = useStore()
  const villages = useShownJudge()?.villages ?? []
  const kindName = CAR_TARGETS.find((x) => x.id === carTarget)!.short
  const facCount = !data ? null : carTarget === 'med' ? null : carTarget === 'er' ? 0 : data.facilities.filter((f) => KIND_RE[carTarget].test(f.kind)).length
  const cannot = villages.filter((v) => v.state !== 0).length
  const rgb = (m: number) => `rgb(${minuteRgb(m).join(',')})`
  const toggle = (on: boolean, label: React.ReactNode, n: number | null, onClick: () => void) => (
    <button type="button" role="switch" aria-checked={on} className={`map-toggle ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="map-toggle-label">{label}{n != null && <span className="map-toggle-n">{n}곳</span>}</span><span className="switch" aria-hidden><i /></span>
    </button>
  )
  return (
    <div className="legend">
      <p className="legend-title">지도에 보이기</p>
      {toggle(showDots, <><i className="sw-x" aria-hidden>✕</i>{carTarget === 'er' ? '응급의료센터 먼 마을' : carTarget === 'med' ? (travel === 'car' ? '자가용으로 못 가는 마을' : '대중교통으로 못 가는 마을') : kindName + ' 못 가는 마을'}</>, cannot, () => set({ showDots: !showDots }))}
      {carTarget === 'er'
        ? <p className="muted small" style={{ margin: '4px 0' }}>응급의료센터는 시설 목록에 없어 지도에 아이콘이 없어요</p>
        : facCount === 0 ? <p className="muted small" style={{ margin: '4px 0' }}>이 군 안에는 {kindName} 시설이 없어요. 군 밖 시설까지 시간으로 판정해요</p>
        : toggle(showFacilities, <><img className="legend-icon" src="/icons/hospital.png" alt="" />{carTarget === 'med' ? '병원·의원·보건소' : kindName}</>, facCount, () => set({ showFacilities: !showFacilities }))}
      <p><i className="sw-num" aria-hidden>3</i>가까운 시설 묶음 · 누르면 펼쳐져요</p>
      <p className="muted">표시가 클수록 사는 사람이 많아요</p>
      <p className="legend-title" style={{ marginTop: 10 }}>바탕색: {kindName}까지 걸리는 시간</p>
      <i className="time-bar" style={{ background: `linear-gradient(90deg, ${MINUTE_STOPS.map(([m]) => `${rgb(m)} ${(m / 45) * 100}%`).join(', ')})` }} />
      <p className="muted time-scale"><span>10분 이하</span><span>30분(기준)</span><span>45분 이상</span></p>
      <p className="muted">{carTarget === 'er' ? '지역응급의료센터 이상' : '가장 가까운 ' + CAR_TARGETS.find((x) => x.id === carTarget)!.short}까지 서버 도로 시간을 마을 사이로 이어 칠했어요. 마을 안에 있으면 0분이에요. 옅은 칸은 근처에 마을이 없는 곳이에요.</p>
    </div>
  )
}

// 마을을 누르면 서버가 판정 이유와 가까운 시설을 알려 준다
function VillageCard() {
  const { code, state, data, travel, carTarget, set, patch } = useStore()
  const id = state?.selectedVillage ?? null
  const shown = useShownJudge()
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
          {cur && 'detail' in cur && <Detail v={cur.detail} service={state!.service} byKind={carTarget !== 'med' && carTarget !== 'er' ? { name: targetOf(carTarget), hit: data?.villages.find((x) => x.id === id)?.nearest.byKind?.[carTarget] ?? null } : null} shown={shown?.villages.find((x) => x.id === id)?.state ?? null} filter={travel === 'car' ? '자가용 · ' + targetOf(carTarget) : carTarget !== 'med' ? targetOf(carTarget) : null} er={data?.villages.find((x) => x.id === id)?.nearest.er ?? null} />}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const targetOf = (t: CarTarget) => CAR_TARGETS.find((x) => x.id === t)!.short
// shown: 지도에 칠한 판정(필터 · 이동 수단 반영). 서버 카드(v.med.state)는 '전체 병의원 · 대중교통' 기준이라 필터나 자가용 탭이면 지도와 달라서 지도 판정을 따른다
function Detail({ v, service, er, shown, filter, byKind }: { v: VillageDetail; byKind: { name: string; hit: NearestMed | null } | null; service: 'med' | 'bus'; er: NearestEr | null; shown: VillageState | null; filter: string | null }) {
  const own = filter != null && shown != null // 서버가 모르는 판정을 보고 있다
  const state = own ? shown : service === 'bus' ? (v.bus.ok ? 0 : 1) : v.med.state
  const reasons = own ? [] : service === 'bus' ? v.bus.reasons : v.med.reason ? [v.med.reason] : []
  const ers = er ? ([['기관', er.facility], ['지역센터', er.center], ['권역센터', er.regional]] as const).flatMap(([k, h]) => (h ? [{ k, ...h }] : [])) : []
  return (
    <>
      <p className="eyebrow">{v.myeon}</p>
      <h3 style={{ fontSize: 20 }}>{v.name}</h3>
      <p><span className="badge" style={{ background: STATE_CSS[state], color: '#fff' }}>{own ? STATE_NAME[state] : service === 'bus' ? (v.bus.ok ? '버스 이용 가능' : '버스 이용 어려움') : v.med.stateText}</span>{own && <span className="muted small"> {filter} 기준</span>}</p>
      {reasons.length > 0 && <p className="small">{reasons.join(' · ')}</p>}
      <p className="small muted" style={{ margin: '6px 0 0' }}>사는 사람 {fmt(v.pop.all)}명 (65세 이상 {fmt(v.pop.a65)}명 · 80세 이상 {fmt(v.pop.a80)}명)</p>
      <p className="small" style={{ margin: '6px 0 0' }}>
        {v.bus.noStop ? '2km 안에 정류장이 없어요' : <>정류장까지 걸어서 <b className="num">{v.bus.stopWalkMin}분</b></>}
        {v.tier === 'precise' && <> · 하루 <b className="num">{v.bus.dailyRuns}번</b>{v.bus.firstToTown ? ` · 읍내행 첫차 ${v.bus.firstToTown}` : ' · 읍내행 버스 없음'}</>}
      </p>
      {byKind ? (
        <p className="small" style={{ margin: '6px 0 0' }}>
          가까운 {byKind.name} {byKind.hit ? <><b>{byKind.hit.name}</b>({byKind.hit.kind}) 자가용 {byKind.hit.minutes}분{byKind.hit.outside ? ' · 군 밖' : ''}</> : '없어요 (길이 없어요)'}
        </p>
      ) : v.med.nearest && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          가까운 병의원 <b>{v.med.nearest.name}</b>({v.med.nearest.kind}) 자가용 {v.med.nearest.minutes}분{v.med.nearest.inVillage ? ' · 마을 안' : v.med.nearest.outside ? ' · 군 밖' : ''}
        </p>
      )}
      {ers.length > 0 && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          응급실까지 자가용{' '}
          {ers.map((h, i) => <span key={h.k} title={h.name}>{i > 0 && ' · '}{h.k} <b className="num">{Math.round(h.minutes)}분</b></span>)}
        </p>
      )}
    </>
  )
}
