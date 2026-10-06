// 화면 전체에 깔리는 지도 하나. 화면이 바뀌어도 같은 카메라가 이어져서 전국 → 군으로 날아간다.
// 바탕은 MapLibre(OpenFreeMap), 데이터는 deck.gl을 MapLibre 레이어 사이에 끼워 그린다(interleaved).
import { useEffect, useMemo, useState } from 'react'
import { Map, type MapRef } from 'react-map-gl/maplibre'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import { DataFilterExtension, FillStyleExtension } from '@deck.gl/extensions'
import { useReducedMotion } from 'motion/react'
import { tween, easeInOut } from '../motion/tween'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// maplibre-gl v6은 워커 경로를 런타임 문자열로 만들어 Vite가 빌드에 넣지 못한다 → 직접 번들해서 알려 준다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useStore, usePlans, optService } from '../store'
import { supplyName } from '../api/plans'
import { planLayers } from './planLayers'
import { COUNTIES, diagnose, routeFrom, weightOf } from '../api/mock'
import { timeColor, AVG_ALPHA } from './colors'
import { useRafTime } from './useRafTime'
import { KOREA_VIEW, cameraFor, loadSigungu } from './geo'

setWorkerUrl(workerUrl)

const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const CANDIDATES = new Set(COUNTIES.map((c) => c.sgg))
// 확장은 한 번만 만든다. 렌더마다 새로 만들면 deck.gl이 레이어를 처음부터 다시 만든다
const FILTER = [new DataFilterExtension({ filterSize: 1 })]
const PATTERN = [new FillStyleExtension({ pattern: true })]
// 경로는 격자와 같은 높이(0)라 깊이 검사에서 깨져 보인다 → 항상 위에 그린다
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
const ROUTE_BASE = {
  getPath: (r: any) => r.path,
  getTimestamps: (r: any) => r.timestamps,
  capRounded: true,
  jointRounded: true,
  trailLength: 1e6,
  fadeTrail: false,
  parameters: ON_TOP,
}
// 출발점, 정류장(갈아타는 곳), 도착점 + 지금 그려지고 있는 선의 머리
function routePoints(r: { path: [number, number][]; timestamps: number[] }, t: number) {
  const pts: { at: [number, number]; kind: 'start' | 'stop' | 'end' | 'head' }[] = [{ at: r.path[0], kind: 'start' }]
  if (r.path.length > 2) pts.push({ at: r.path[1], kind: 'stop' })
  const last = r.timestamps.length - 1
  if (t >= r.timestamps[last]) return [...pts, { at: r.path[last], kind: 'end' }]
  const k = Math.max(1, r.timestamps.findIndex((ts) => ts >= t))
  const [t0, t1] = [r.timestamps[k - 1], r.timestamps[k]], f = t1 > t0 ? (t - t0) / (t1 - t0) : 1
  const [a, b] = [r.path[k - 1], r.path[k]]
  return [...pts, { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as [number, number], kind: 'head' as const }]
}
const CAMERA_MS = 900
const DRAW_MS = 2000
const HATCH = { hatch: { type: 'hatch', angle: 45, strokeWidth: 1, gap: 4 } } as const

// deck.gl 오버레이는 지도 객체에 한 번만 붙이고 레이어만 갈아 끼운다.
// useControl로 붙이면 개발 중 HMR 때 떼었다 다시 붙으면서 예전 화면의 레이어가 남는 문제가 있었다.
type MapWithDeck = import('maplibre-gl').Map & { __deck?: MapLibreOverlay; __labelsBefore?: string }
function deckOf(map: MapWithDeck) {
  if (!map.__deck) {
    map.__deck = new MapLibreOverlay({ interleaved: true })
    map.addControl(map.__deck)
  }
  return map.__deck
}

export function MapView({ screen, onPickRegion, onBlocked, mapRef }: {
  screen: 'landing' | 'select' | 'diag' | 'plan' | 'memo'
  onPickRegion: (sgg: string) => void
  onBlocked: (name: string) => void
  mapRef: React.RefObject<MapRef | null>
}) {
  const s = useStore()
  const reduce = useReducedMotion()
  const [sigungu, setSigungu] = useState<any>(null)
  const [myeon, setMyeon] = useState<any>(null)
  const [, setLoaded] = useState(0)
  const mapObj = mapRef.current?.getMap() as MapWithDeck | undefined
  const labelsBefore = mapObj?.__labelsBefore
  const [draw, setDraw] = useState<{ route: unknown; t: number }>({ route: null, t: 0 })
  useEffect(() => { loadSigungu().then(setSigungu); fetch('/data/myeon.geojson').then((r) => r.json()).then(setMyeon) }, [])

  const m = s.model
  const T = s.thresholds[s.service]
  const diag = useMemo(() => (m ? diagnose(m, s.service, s.mode, s.age, T) : null), [m, s.service, s.mode, s.age, T])
  const route = useMemo(() => (m && s.selectedCell != null ? routeFrom(m, s.selectedCell, s.service, s.mode) : null), [m, s.selectedCell, s.service, s.mode])
  const maxW = useMemo(() => (m ? Math.max(...m.cells.map((c) => weightOf(c, s.age))) : 1), [m, s.age])
  // deck.gl은 data가 새 객체면 다시 계산하므로, 매 프레임 렌더에서도 같은 객체를 쓰게 고정한다
  const selectedGeo = useMemo(() => sigungu && s.sgg && { ...sigungu, features: sigungu.features.filter((f: any) => f.properties.sgg === s.sgg) }, [sigungu, s.sgg])
  const candidateGeo = useMemo(() => sigungu && { ...sigungu, features: sigungu.features.filter((f: any) => CANDIDATES.has(f.properties.sgg)) }, [sigungu])
  const myeonGeo = useMemo(() => (myeon && m ? { ...myeon, features: myeon.features.filter((f: any) => f.properties.sgg === m.county.sgg) } : null), [myeon, m])
  const aiCells = useMemo(() => m?.cells.filter((c) => c.aiFilled) ?? [], [m])
  const routeData = useMemo(() => (route ? [route] : []), [route])

  // 칸을 고르면: (필요하면) 카메라를 경로에 맞추고 → 도착한 뒤 0분부터 끝까지 선이 그려진다.
  // 둘을 동시에 하면 화면이 움직이는 동안 선이 다 그려져서 그리는 연출이 보이지 않는다.
  // 경로가 화면 밖에 있거나 너무 작을 때만 카메라를 움직인다 (왼쪽 패널, 오른쪽 위 카드 자리 비움)
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!route || !map) return
    if (reduce) { setDraw({ route, t: route.total }); return }
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    // 넓으면 카드 옆, 중간이면 카드 아래, 좁으면(모바일) 위아래 패널 사이에 둔다
    const pad = W >= 1200 ? { left: 460, right: 340, top: 80, bottom: 80 }
      : W >= 720 ? { left: 460, right: 40, top: 240, bottom: 60 }
      : { left: 30, right: 30, top: 200, bottom: Math.min(340, H * 0.6) }
    const px = route.path.map((p) => map.project(p))
    const outside = px.some((p) => p.x < pad.left || p.x > W - pad.right || p.y < pad.top || p.y > H - pad.bottom)
    const span = Math.max(...px.map((p) => Math.hypot(p.x - px[0].x, p.y - px[0].y)))
    const move = outside || span < 120
    if (move) {
      const lons = route.path.map((p) => p[0]), lats = route.path.map((p) => p[1])
      map.flyTo({ ...cameraFor([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], W, H, pad, 14), duration: CAMERA_MS, essential: true })
    }
    let stop = () => {}
    const timer = setTimeout(() => { stop = tween(0, route.total, DRAW_MS, (t) => setDraw({ route, t }), { ease: easeInOut }) }, move ? CAMERA_MS : 0)
    return () => { clearTimeout(timer); stop() }
  }, [route, mapRef, reduce])
  // 이전 경로의 진행값이 새 경로에 한 프레임 보이지 않게, 진행값을 그 경로에 묶어 둔다
  const routeT = draw.route === route ? draw.t : 0

  // 반복 애니메이션은 필요한 동안만 돌린다 (돌리는 동안은 지도를 매 프레임 다시 그린다)
  // - 후보 군 테두리 맥동: 아직 군을 고르기 전에만
  // - 원격 거점 고리: 대안을 지도에 놓는 동안만
  const pulse = useRafTime(screen === 'select' && !s.sgg && !reduce)
  const plans = usePlans()
  const shownPicks = screen === 'plan' && plans ? plans.shown.picks.length : 0
  const ring = useRafTime(screen === 'plan' && s.reveal < shownPicks && !reduce)

  const layers: Layer[] = []
  if (sigungu && screen === 'select') {
    layers.push(
      new GeoJsonLayer({
        id: 'sigungu',
        data: sigungu,
        pickable: true,
        autoHighlight: true,
        highlightColor: [47, 91, 211, 90],
        stroked: true,
        filled: true,
        // 고른 군은 진하게, 나머지 후보는 옅게 (붙어 있는 세 군이 한 덩어리로 보이지 않게)
        getFillColor: (f: any) => (f.properties.sgg === s.sgg ? [47, 91, 211, 120] : CANDIDATES.has(f.properties.sgg) ? [47, 91, 211, s.sgg ? 45 : 150] : [120, 120, 112, 26]),
        updateTriggers: { getFillColor: s.sgg },
        getLineColor: [255, 255, 255, 220],
        lineWidthMinPixels: 0.6,
        transitions: { getFillColor: { duration: 1400, enter: (c: number[]) => [c[0], c[1], c[2], 0] } },
        onClick: ({ object }: any) => object && (CANDIDATES.has(object.properties.sgg) ? onPickRegion(object.properties.sgg) : onBlocked(object.properties.sggnm)),
        beforeId: labelsBefore,
      }),
      new GeoJsonLayer({
        id: 'candidates-glow',
        data: s.sgg && selectedGeo ? selectedGeo : candidateGeo,
        filled: false,
        getLineColor: [47, 91, 211, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        lineWidthScale: s.sgg ? 3 : 1.5 + 1.5 * (0.5 + 0.5 * Math.sin(pulse / 400)),
        beforeId: labelsBefore,
      }),
    )
    if (myeonGeo && m?.county.sgg === s.sgg) layers.push(new GeoJsonLayer({ id: 'select-myeon', data: myeonGeo, filled: false, getLineColor: [255, 255, 255, 200], lineWidthMinPixels: 1, parameters: ON_TOP, beforeId: labelsBefore }))
  }

  if (m && diag && screen === 'diag') {
    const sweeping = s.sweep != null
    const avgColor = timeColor(diag.avgMinutes / T, AVG_ALPHA)
    layers.push(
      new GeoJsonLayer({
        id: 'myeon-lines',
        data: myeonGeo ?? [],
        filled: false,
        getLineColor: [60, 60, 70, 140],
        lineWidthMinPixels: 1,
        parameters: ON_TOP,
        beforeId: labelsBefore,
      }),
      // 스윕 중 아직 안 켜진 칸이 보이는 바탕. 끝까지 회색으로 남는 칸이 곧 공백이다
      new PolygonLayer({
        id: 'grid-base',
        data: m.cells,
        visible: sweeping,
        getPolygon: (c: any) => c.polygon,
        getFillColor: (c: any) => (c.pop > 0 ? [150, 150, 145, 120] : [150, 150, 145, 40]),
        stroked: false,
        beforeId: labelsBefore,
      }),
      new PolygonLayer({
        id: 'grid',
        data: m.cells,
        opacity: route ? 0.6 : 1, // 경로를 볼 때는 격자를 살짝 흐리게
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 120],
        extruded: s.extruded,
        wireframe: false,
        stroked: !s.extruded,
        getLineColor: [255, 255, 255, 60],
        lineWidthMinPixels: 0.5,
        getPolygon: (c: any) => c.polygon,
        getFillColor: (c: any) => {
          if (!s.unfolded) return avgColor
          const empty = c.pop === 0
          const hl = s.hoverVillage != null && c.village === s.hoverVillage
          return timeColor(diag.times[c.i] / T, hl ? 255 : empty ? 60 : 200)
        },
        getElevation: (c: any) => (s.unfolded && s.extruded ? Math.sqrt(weightOf(c, s.age) / maxW) * 2500 : 0),
        updateTriggers: {
          getFillColor: [diag, s.unfolded, s.hoverVillage, T],
          getElevation: [s.unfolded, s.extruded, s.age, maxW],
        },
        transitions: reduce ? {} : {
          getFillColor: { duration: 900, easing: (x: number) => 1 - Math.pow(1 - x, 3) },
          getElevation: { type: 'spring', stiffness: 0.04, damping: 0.35 },
        },
        extensions: FILTER,
        getFilterValue: (c: any) => diag.times[c.i],
        filterRange: [0, sweeping ? s.sweep! : 1e6],
        filterSoftRange: sweeping ? [0, Math.max(0, s.sweep! - 4)] : null,
        filterTransformColor: true,
        onClick: ({ object }: any) => object && s.set({ selectedCell: object.i }),
        beforeId: labelsBefore,
      }),
      // 인구가 5명 미만이라 통계에서 가려진 칸 → AI가 채웠다는 표시(빗금)
      new PolygonLayer({
        id: 'ai-filled',
        data: aiCells,
        visible: s.unfolded && !s.extruded && !sweeping,
        getPolygon: (c: any) => c.polygon,
        getFillColor: [30, 40, 70, 255],
        opacity: 0.75,
        stroked: false,
        extensions: PATTERN,
        fillPatternMapping: HATCH,
        fillPatternMask: true,
        fillPatternSizeUnits: 'pixels',
        getFillPattern: () => 'hatch',
        parameters: ON_TOP,
        beforeId: labelsBefore,
      } as any),
      new ScatterplotLayer({
        id: 'facilities',
        data: m.fac[s.service],
        getPosition: (f: any) => [m.villages[f.village].lon, m.villages[f.village].lat],
        getRadius: 7,
        radiusUnits: 'pixels',
        getFillColor: [255, 255, 255],
        getLineColor: [28, 28, 26],
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 3,
        pickable: true,
        parameters: ON_TOP, // 격자와 같은 높이라 깊이 검사에서 원 일부가 잘려 보였다
        updateTriggers: { getPosition: s.service },
        transitions: reduce ? {} : { getRadius: { type: 'spring', stiffness: 0.08, damping: 0.3, enter: () => 0 } },
      }),
    )
    if (route) {
      layers.push(
        // 흰 테두리 → 파란 선 순서로 겹쳐 그려 어떤 칸 색 위에서도 보이게 한다
        new TripsLayer({ ...ROUTE_BASE, id: 'route-casing', data: routeData, getColor: [255, 255, 255], widthMinPixels: 11, currentTime: routeT }),
        new TripsLayer({ ...ROUTE_BASE, id: 'route', data: routeData, getColor: [47, 91, 211], widthMinPixels: 6, currentTime: routeT }),
        new ScatterplotLayer({
          id: 'route-points',
          data: routePoints(route, routeT),
          getPosition: (p: any) => p.at,
          getRadius: (p: any) => (p.kind === 'head' ? 9 : 7),
          radiusUnits: 'pixels',
          getFillColor: (p: any) => (p.kind === 'end' ? [28, 28, 26] : p.kind === 'stop' ? [255, 255, 255] : [47, 91, 211]),
          getLineColor: (p: any) => (p.kind === 'stop' ? [47, 91, 211] : [255, 255, 255]),
          stroked: true,
          lineWidthMinPixels: 3,
          updateTriggers: { getRadius: routeT },
          parameters: ON_TOP,
        }),
      )
    }
  }

  if (screen === 'plan' && plans && m && plans.model === m) {
    layers.push(
      new GeoJsonLayer({ id: 'myeon-lines', data: myeonGeo ?? [], filled: false, getLineColor: [60, 60, 70, 140], lineWidthMinPixels: 1, parameters: { depthCompare: 'always', depthWriteEnabled: false }, beforeId: labelsBefore }),
      ...planLayers({ m, plan: plans.shown, reveal: s.reveal, time: s.reveal < shownPicks ? ring : null, labelsBefore, reduce }),
    )
  }

  const getTooltip = ({ object, layer }: any) => {
    if (!object || !m || !diag) return null
    if (layer?.id === 'facilities') return { text: object.name }
    if (layer?.id === 'plan-marks') return { text: `${supplyName(object.pick.type, optService(s.service))}\n${m.villages[object.pick.village].name}${object.pick.type === 'tour' ? ` 출발 · ${object.pick.stops.length}곳 정차` : ''}` }
    if (layer?.id === 'grid') {
      const v = m.villages[object.village]
      return { text: `${v.name}\n${Math.round(diag.times[object.i])}분 · ${Math.round(weightOf(object, s.age))}명${object.aiFilled ? ' (AI 추정)' : ''}` }
    }
    return null
  }
  // 렌더마다 지금 화면의 레이어로 바꿔 끼운다
  useEffect(() => {
    const map = mapRef.current?.getMap() as MapWithDeck | undefined
    if (!map?.isStyleLoaded()) return
    deckOf(map).setProps({ layers, getTooltip })
    if (import.meta.env.DEV) (window as any).__map = map // 개발 중 화면 검증용
    if (!useStore.getState().mapReady) useStore.getState().set({ mapReady: true }) // HMR로 store가 새로 만들어져도 다시 알린다
  })

  return (
    <Map
      ref={mapRef}
      initialViewState={KOREA_VIEW}
      mapStyle={STYLE}
      style={{ position: 'absolute', inset: 0 }}
      maxPitch={60}
      attributionControl={{ compact: true }}
      onLoad={(e) => {
        // 지명은 한글을 먼저 쓰고, 데이터 레이어는 첫 지명 레이어 아래에 깐다
        const map = e.target
        const symbols = map.getStyle().layers.filter((l) => l.type === 'symbol')
        symbols.forEach((l) => { if (map.getLayoutProperty(l.id, 'text-field')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]) })
        ;(map as MapWithDeck).__labelsBefore = symbols[0]?.id
        setLoaded((n) => n + 1)
        useStore.getState().set({ mapReady: true })
      }}
    >
    </Map>
  )
}
