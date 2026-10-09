import { useEffect, useRef, useState } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router'
import { AnimatePresence, MotionConfig } from 'motion/react'
import { regionOf } from './data/regions'
import { useStore } from './store'
import { Progress } from './ui/Progress'
import { Intro } from './screens/Intro'
import { Landing } from './screens/Landing'
import { TestMap } from './screens/TestMap'
import { Select } from './screens/Select'
import { Diagnose } from './screens/Diagnose'
import { Goal } from './screens/Goal'
import { Simulate } from './screens/Simulate'
import { Results } from './screens/Results'
import { WhatIf } from './screens/WhatIf'
import { Report } from './screens/Report'
import { Sources } from './screens/Sources'
import { MapView, type MapScreen } from './map/MapView'
import { ChatDock } from './chat/ChatDock'

// 진행 바 칸: 지역 0 · 진단 1 · 목표 2 · 시뮬레이션 3 · 결과(+What-if) 4 · 레포트 5
const stepOf = (path: string) =>
  path === '/start' ? 0 : /\/goal$/.test(path) ? 2 : /\/sim$/.test(path) ? 3 : /\/(result|whatif)$/.test(path) ? 4 : /\/report$/.test(path) ? 5 : 1

// /r/:code 아래 화면은 지역이 있어야 한다. 없는 코드면 지역 선택으로 돌려보낸다
function RegionRoute({ children }: { children: React.ReactNode }) {
  const { code } = useParams()
  return regionOf(code) ? children : <Navigate to="/start" replace />
}

function Shell() {
  const loc = useLocation()
  const nav = useNavigate()
  const code = loc.pathname.match(/^\/r\/(\d+)/)?.[1] ?? null
  const openSources = useStore((s) => s.openSources)
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  const intro = loc.pathname === '/' || loc.pathname === '/intro' || loc.pathname === '/test' // 랜딩·S0 인트로·데이터 미리보기는 헤더·공용 지도 없이 전체 화면
  // 지도가 깔리는 화면: S1 지역 선택 · S2 진단 · S5 결과 (나머지 화면에서는 숨겨 두고 카메라는 그대로 둔다)
  const mapScreen: MapScreen = loc.pathname === '/start' ? 'select' : /^\/r\/\d+$/.test(loc.pathname) ? 'diag' : /\/result$/.test(loc.pathname) ? 'result' : 'off'
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
          <button className="logo" onClick={() => nav('/')}><span className="logo-mark">V</span><span className="logo-text">VillageCoverage</span></button>
          <span className="spacer" />
          <span className="disclaimer">시제품 · 지표 숫자는 예시값</span>
          <Progress code={code} at={stepOf(loc.pathname)} />
          <button className="ghost" style={{ padding: '9px 12px', fontSize: 14 }} onClick={() => openSources()}>가정과 출처</button>
        </header>
      )}
      {!intro && <MapView mapRef={mapRef} screen={mapScreen} onPickRegion={pick} onBlocked={setBlocked} />}
      <AnimatePresence mode="wait">
        <Routes location={loc} key={loc.pathname}>
          <Route path="/" element={<Landing />} />
          <Route path="/intro" element={<Intro />} />
          <Route path="/test" element={<TestMap />} />
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
      {code && <ChatDock code={code} />}
      <Sources />
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
