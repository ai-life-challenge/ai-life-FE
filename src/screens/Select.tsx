// S1 지역 선택: 전국 지도 위에 후보 3군이 맥동하고, 지도에서 군에 마우스를 올리면 그 군 위에 카드가 뜬다.
// 왼쪽 패널의 카드에 마우스를 올려도 지도에서 그 군이 강조된다. 고르면 카메라가 그 군으로 날아가며 S2로 넘어간다.
import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { REGIONS } from '../data/regions'
import { useStore } from '../store'
import { fitCounty } from '../map/geo'
import { fmt } from '../motion/useCountUp'
import { RegionCard } from '../ui/RegionCard'
import { SrcBadge } from '../ui/Badges'

const KOREA_BOX: [number, number, number, number] = [125.6, 34.2, 129.6, 38.4]

export function Select({ mapRef, blocked, pick, picked }: { mapRef: React.RefObject<MapRef | null>; blocked: string | null; pick: (code: string) => void; picked: string | null }) {
  const { hoverRegion, mapReady, set } = useStore()
  useEffect(() => {
    // 한국 전체가 왼쪽 패널 오른쪽 빈 곳에 꽉 차게 (그래야 군 위에 뜨는 카드가 패널에 가리지 않는다)
    if (mapReady) fitCounty(mapRef.current, KOREA_BOX, { duration: 1600 })
  }, [mapRef, mapReady])
  useEffect(() => () => set({ hoverRegion: null }), [set])
  const shown = REGIONS.find((r) => r.code === (picked ?? hoverRegion)) ?? REGIONS[0]

  return (
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">1단계 · 지역 선택</p>
      <h1>어느 군의 예산을 짜 볼까요?</h1>
      <p className="muted">지도에서 파랗게 빛나는 군에 마우스를 올려 보거나, 아래 카드를 고르세요. [정밀]은 실데이터를 확보한 군, [추정 포함]은 일부가 추정값인 군이에요.</p>

      <div className="region-list">
        {REGIONS.map((r, k) => (
          <motion.div key={r.code} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + k * 0.08 }}>
            <RegionCard r={r} on={hoverRegion === r.code || picked === r.code} dim={!!picked && picked !== r.code} onClick={() => pick(r.code)} onHover={(on) => set({ hoverRegion: on ? r.code : null })} />
          </motion.div>
        ))}
      </div>

      <AnimatePresence>
        {blocked && (
          <motion.div key={blocked} className="toast-inline" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <b>{blocked}</b>은(는) 준비 중이에요. 필요한 데이터: 응급 30/60분 밖 인구비율, 정류장별 버스 시각, 교통사고 다발지점
          </motion.div>
        )}
      </AnimatePresence>

      <div className="budget-line">
        <span>
          <b>{shown.name}</b> 현재 보건 {fmt(shown.budget.health)}억 + 수송·교통 {fmt(shown.budget.transport)}억 ={' '}
          <b className="num">{fmt(shown.budget.health + shown.budget.transport)}억</b> · 주민 1인당 {fmt(((shown.budget.health + shown.budget.transport) * 1e8) / shown.pop / 1e4)}만 원
        </span>
        <SrcBadge kind="public" id="budget" note="지방재정365 · 예시" />
        <SrcBadge kind="public" id="pop" note="KOSIS · 예시" />
      </div>
      <p className="source">경계 SGIS(admdongkor 2026.7) · 지도 © OpenStreetMap, OpenFreeMap</p>
    </motion.aside>
  )
}
