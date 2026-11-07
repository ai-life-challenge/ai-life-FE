import { useEffect, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { useStore } from './store'
import { Progress } from './ui/Progress'
import { Landing } from './screens/Landing'
import { Select } from './screens/Select'
import { Diagnose } from './screens/Diagnose'
import { Goal } from './screens/Goal'
import { Simulate } from './screens/Simulate'
import { Results } from './screens/Results'
import { WhatIf } from './screens/WhatIf'
import { Report } from './screens/Report'
import { Sources } from './screens/Sources'
import { About } from './screens/About'
import { MapView, type MapScreen } from './map/MapView'
import { ChatDock } from './chat/ChatDock'
import { PcNotice } from './ui/PcNotice'
import { Logo } from './ui/Logo'
import { useServerRecovery, useTierCounts } from './hooks'
import { RegionRoute } from './RegionRoute'

// 진행 바 칸: 지역 0 · 진단 1 · 목표 2 · 시뮬레이션 3 · 결과(+What-if) 4 · 레포트 5
const stepOf = (path: string) =>
  path === '/start' ? 0 : /\/goal$/.test(path) ? 2 : /\/sim$/.test(path) ? 3 : /\/(result|whatif)$/.test(path) ? 4 : /\/report$/.test(path) ? 5 : 1

function Shell() {
  const tiers = useTierCounts()
  useServerRecovery()
  const loc = useLocation()
  const nav = useNavigate()
  const code = loc.pathname.match(/^\/r\/(\d+)/)?.[1] ?? null
  // 서버 장애 때 지원하지 않는 지역을 보는 중이면 자료가 없으므로 질문 창을 띄우지 않는다
  const held = useStore((st) => !!st.unsupported || (st.listSource === 'snapshot' && !st.data && !!st.snapshot?.unsupported?.some((r) => r.code === code)))
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  const intro = loc.pathname === '/' || loc.pathname === '/about' // 랜딩·프로젝트 정보는 헤더·공용 지도 없이 전체 화면
  // 지도가 깔리는 화면: S1 지역 선택 · S2 진단 · S5 결과 (나머지 화면에서는 숨겨 두고 카메라는 그대로 둔다)
  // 진단 → 목표 → 시뮬레이션 → 결과는 지도 한 화면에서 이어진다 (왼쪽 패널만 바뀜)
  const mapScreen: MapScreen = loc.pathname === '/start' ? 'select' : /^\/r\/\d+(\/goal)?$/.test(loc.pathname) ? 'diag' : /\/(sim|result)$/.test(loc.pathname) ? 'result' : 'off'
  const mapRef = useRef<MapRef>(null)
  const [blocked, setBlocked] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => { setBlocked(null); setPicked(null) }, [loc.pathname])
  const pick = (c: string) => {
    if (mapScreen !== 'select') return
    setPicked(c)
    setTimeout(() => nav(`/r/${c}`), 380)
  }

  return (
    <div className={`app ${mapScreen !== 'off' ? 'with-map' : ''}`}>
      {!intro && (
        <header className="topbar no-print">
          <button className="logo" onClick={() => nav('/')}><Logo /></button>
          <span className="spacer" />
          <span className="disclaimer">시제품 · {tiers ? `정밀 판정 ${tiers.precise}곳, 나머지는 간이 판정` : '정밀 판정 · 간이 판정'}</span>
          <Progress code={code} at={stepOf(loc.pathname)} />
          <button className="ghost" style={{ padding: '9px 12px', fontSize: 14 }} onClick={() => nav('/about#data')}>데이터 분석 기준</button>
        </header>
      )}
      {!intro && <MapView mapRef={mapRef} screen={mapScreen} onPickRegion={pick} onBlocked={setBlocked} />}
      <AnimatePresence mode="wait">
        <Routes location={loc} key={loc.pathname}>
          <Route path="/" element={<Landing />} />
          <Route path="/intro" element={<Navigate to="/start" replace />} /> {/* 예전 인트로 주소: 지역 선택으로 바로 */}
          <Route path="/about" element={<About />} />
          <Route path="/start" element={<Select mapRef={mapRef} blocked={blocked} pick={pick} picked={picked} />} />
          <Route path="/r/:code" element={<RegionRoute><Diagnose mapRef={mapRef} /></RegionRoute>} />
          <Route path="/r/:code/goal" element={<RegionRoute><Goal /></RegionRoute>} />
          <Route path="/r/:code/sim" element={<RegionRoute><Simulate /></RegionRoute>} />
          <Route path="/r/:code/result" element={<RegionRoute><Results mapRef={mapRef} /></RegionRoute>} />
          <Route path="/r/:code/whatif" element={<RegionRoute><WhatIf /></RegionRoute>} />
          <Route path="/r/:code/report" element={<RegionRoute><Report /></RegionRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AnimatePresence>
      {code && !held && <ChatDock code={code} />}
      <Sources />
      <PcNotice />
    </div>
  )
}

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </MotionConfig>
  )
}
