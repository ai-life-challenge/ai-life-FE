// S1 지역 선택: 전국 지도 위에 고를 수 있는 72곳이 빛나고, 지도에서 군에 마우스를 올리면 그 군 위에 카드가 뜬다.
// 왼쪽 패널의 카드에 마우스를 올려도 지도에서 그 군이 강조된다. 고르면 카메라가 그 군으로 날아가며 S2로 넘어간다.
import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { MapRef } from 'react-map-gl/maplibre'
import { useStore } from '../store'
import { fitCounty } from '../map/geo'
import { RegionCard } from '../ui/RegionCard'
import { useTierCounts } from '../hooks'

const KOREA_BOX: [number, number, number, number] = [125.6, 34.2, 129.6, 38.4]

export function Select({ mapRef, blocked, pick, picked }: { mapRef: React.RefObject<MapRef | null>; blocked: string | null; pick: (code: string) => void; picked: string | null }) {
  const { regions, listError, hoverRegion, mapReady, loadList, set } = useStore()
  const [q, setQ] = useState('')
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    // 한국 전체가 왼쪽 패널 오른쪽 빈 곳에 꽉 차게 (그래야 군 위에 뜨는 카드가 패널에 가리지 않는다)
    if (mapReady) fitCounty(mapRef.current, KOREA_BOX, { duration: 1600 })
  }, [mapRef, mapReady])
  useEffect(() => () => set({ hoverRegion: null }), [set])

  // 정밀 지역을 먼저, 나머지는 시도 → 이름 순
  const list = useMemo(() => {
    const t = q.trim()
    return regions
      .filter((r) => !t || r.name.includes(t) || r.sido.includes(t))
      .sort((a, b) => Number(b.tier === 'precise') - Number(a.tier === 'precise') || a.sido.localeCompare(b.sido, 'ko') || a.name.localeCompare(b.name, 'ko'))
  }, [regions, q])
  // 정밀 지역 수는 숫자를 박지 않고 서버 /api/health(tiers.precise) 값을 쓴다. 받기 전이면 지역 목록에서 센다
  const tiers = useTierCounts()
  const precise = tiers?.precise ?? (regions.length ? regions.filter((r) => r.tier === 'precise').length : null)

  return (
    <motion.aside className="panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">1단계 · 지역 선택</p>
      <h1>어느 군을 살펴볼까요?</h1>
      <p className="muted">지도에서 파랗게 빛나는 {regions.length || 72}곳 중에 골라 보세요. [정밀 판정]은 버스 하루 운행 횟수와 읍내행 첫차까지 본 {precise != null ? `${precise}곳` : '지역'}이고, [간이 판정]은 정류장까지 걷는 거리만 봐요.</p>

      <input className="search" type="search" placeholder="군 이름이나 시도로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="지역 찾기" />

      {listError && (
        <div className="toast-inline">
          {listError} <button className="link" onClick={() => void loadList()}>다시 불러오기</button>
        </div>
      )}
      {!listError && !regions.length && <p className="muted" role="status">지역 목록을 불러오는 중이에요…</p>}

      <div className="region-list">
        {list.map((r) => (
          <RegionCard key={r.code} r={r} on={hoverRegion === r.code || picked === r.code} dim={!!picked && picked !== r.code} onClick={() => pick(r.code)} onHover={(on) => set({ hoverRegion: on ? r.code : null })} />
        ))}
        {!!regions.length && !list.length && <p className="muted">‘{q}’에 맞는 지역이 없어요.</p>}
      </div>

      <AnimatePresence>
        {blocked && (
          <motion.div key={blocked} className="toast-inline" initial={{ opacity: 0 }} animate={{ opacity: 1, x: [0, -6, 6, -4, 4, 0] }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <b>{blocked}</b>은(는) 아직 준비되지 않았어요. 파랗게 빛나는 군을 골라 주세요.
          </motion.div>
        )}
      </AnimatePresence>
      <p className="source">경계 SGIS(admdongkor 2026.7) · 지도 © OpenStreetMap, OpenFreeMap</p>
    </motion.aside>
  )
}
