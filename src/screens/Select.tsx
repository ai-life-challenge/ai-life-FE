import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useStore } from '../store'
import { COUNTIES, diagnose, type Model } from '../api/mock'
import { useCountUp, fmt, pct } from '../motion/useCountUp'
import { loadSigungu, KOREA_VIEW } from '../map/geo'
import { LevelBadge } from '../ui/Badges'

export function Select({ mapRef, blocked, pick }: { mapRef: React.RefObject<MapRef | null>; blocked: string | null; pick: (sgg: string) => void }) {
  const nav = useNavigate()
  const { sgg, model } = useStore()
  const [q, setQ] = useState('')
  const [names, setNames] = useState<{ sgg: string; name: string; sido: string }[]>([])
  useEffect(() => { loadSigungu().then((g) => setNames(g.features.map((f: any) => ({ sgg: f.properties.sgg, name: f.properties.sggnm, sido: f.properties.sidonm })))) }, [])
  const mapReady = useStore((st) => st.mapReady)
  useEffect(() => { if (mapReady) mapRef.current?.flyTo({ center: [KOREA_VIEW.longitude, KOREA_VIEW.latitude], zoom: KOREA_VIEW.zoom, pitch: 0, bearing: 0, duration: 1600 }) }, [mapRef, mapReady])

  const results = useMemo(() => {
    if (!q.trim()) return []
    return names.filter((n) => (n.sido + n.name).includes(q.trim())).slice(0, 6)
  }, [q, names])

  return (
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <button className="eyebrow link" onClick={() => nav('/')}>← VillageCoverage 소개</button>
      <h1>우리 지역 생활서비스,<br />누가 닿지 못하고 있을까요?</h1>
      <p className="muted">지도에서 파란 지역을 누르거나 이름으로 찾으세요. 시제품은 경남 세 군의 데이터를 준비했어요.</p>

      <input className="search" placeholder="지역 이름 (예: 창녕)" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="results">
          {results.map((r) => {
            const ready = COUNTIES.some((c) => c.sgg === r.sgg)
            return (
              <li key={r.sgg}>
                <button disabled={!ready} onClick={() => { setQ(''); pick(r.sgg) }}>
                  {r.sido} {r.name} <span className="muted">{ready ? '' : '준비 중'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="county-list">
        {COUNTIES.map((c, k) => (
          <motion.button
            key={c.sgg}
            className={`county ${sgg === c.sgg ? 'on' : ''}`}
            onClick={() => pick(c.sgg)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + k * 0.08 }}
            whileHover={{ y: -2 }}
          >
            <b>{c.name}</b>
            <span className="muted">{c.role}</span>
            <LevelBadge level={c.level} />
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {blocked && (
          <motion.div key={blocked} className="toast-inline" initial={{ opacity: 0, x: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <b>{blocked}</b>은(는) 준비 중이에요. 필요한 데이터: 리 단위 인구, 정류장별 버스 시각, 시설 좌표
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {model && model.county.sgg === sgg && <Summary key={sgg} m={model} onStart={() => nav(`/c/${sgg}`)} />}
      </AnimatePresence>
    </motion.aside>
  )
}

// 퇴장 애니메이션 중에도 그 군의 값을 보여 주도록 model을 props로 받는다
function Summary({ m, onStart }: { m: Model; onStart: () => void }) {
  const th = useStore((s) => s.thresholds)
  const pop = m.cells.reduce((a, c) => a + c.pop, 0)
  const p80 = m.cells.reduce((a, c) => a + c.p80, 0)
  const med = diagnose(m, 'med', 'bus', 'a80', th.med)
  const villagesOver = (sid: 'pha' | 'gro') => {
    const d = diagnose(m, sid, 'bus', 'all', th[sid])
    return new Set(d.topVillages.map((v) => v.village)).size
  }
  const nPop = useCountUp(pop), nGap = useCountUp(med.gap), nPha = useCountUp(villagesOver('pha')), nGro = useCountUp(villagesOver('gro'))
  return (
    <motion.div className="summary" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
      <div className="summary-head">
        <h2>{m.county.name}</h2>
        <LevelBadge level={m.county.level} />
      </div>
      <dl className="stats">
        <div><dt>인구</dt><dd>{fmt(nPop)}명</dd></div>
        <div><dt>80세 이상</dt><dd>{pct(p80 / pop)}</dd></div>
        <div className="wide"><dt>버스로 의료기관까지 {th.med}분 넘는 80세 이상</dt><dd className="big bad">{fmt(nGap)}명</dd></div>
        <div><dt>약국 공백 마을</dt><dd>{fmt(nPha)}곳</dd></div>
        <div><dt>식료품 공백 마을</dt><dd>{fmt(nGro)}곳</dd></div>
      </dl>
      <div className="row">
        <motion.button className="primary" onClick={onStart} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>담당자 화면으로 시작 →</motion.button>
        <button className="ghost" disabled title="다음 단계에서 만든다">주민 화면</button>
      </div>
      <p className="source">가상 데이터 · 경계 SGIS(admdongkor 2026.7) · 기준 시간은 가정값</p>
    </motion.div>
  )
}
