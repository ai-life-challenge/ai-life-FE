import { useRef, useState } from 'react'
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { AnimatePresence, MotionConfig } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { MapView } from './map/MapView'
import { fitCounty } from './map/geo'
import { Select } from './screens/Select'
import { Landing } from './screens/Landing'
import { Diagnose } from './screens/Diagnose'
import { Plan } from './screens/Plan'
import { Memo } from './screens/Memo'
import { ChatDock } from './chat/ChatDock'
import { useStore } from './store'

function Shell() {
  const mapRef = useRef<MapRef>(null)
  const loc = useLocation()
  const nav = useNavigate()
  const [blocked, setBlocked] = useState<string | null>(null)
  const screen = loc.pathname === '/' ? 'landing' : loc.pathname.endsWith('/plan') ? 'plan' : loc.pathname.endsWith('/memo') ? 'memo' : loc.pathname.startsWith('/c/') ? 'diag' : 'select'

  const pickRegion = async (sgg: string) => {
    setBlocked(null)
    if (screen === 'diag') return nav(`/c/${sgg}`)
    await useStore.getState().loadCounty(sgg)
    const b = useStore.getState().model!.bbox
    fitCounty(mapRef.current, b)
  }

  return (
    <div className="app">
      <MapView mapRef={mapRef} screen={screen} onPickRegion={pickRegion} onBlocked={setBlocked} />
      {screen !== 'landing' && <div className="disclaimer">시제품 · 읍면 경계만 실제이고 인구·시설·버스는 가상 데이터예요</div>}
      <AnimatePresence mode="wait">
        <Routes location={loc} key={screen}>
          <Route path="/" element={<Landing />} />
          <Route path="/start" element={<Select mapRef={mapRef} blocked={blocked} pick={pickRegion} />} />
          <Route path="/c/:sgg" element={<Diagnose mapRef={mapRef} />} />
          <Route path="/c/:sgg/plan" element={<Plan mapRef={mapRef} />} />
          <Route path="/c/:sgg/memo" element={<Memo />} />
        </Routes>
      </AnimatePresence>
      {screen !== 'select' && screen !== 'landing' && <ChatDock screen={screen} />}
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
