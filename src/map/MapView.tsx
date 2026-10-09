// 화면 뒤에 깔리는 지도 하나 (VillageCoverage 시제품과 같은 구조). 화면이 바뀌어도 같은 카메라가 이어져서 전국 → 군으로 날아간다.
// 바탕은 MapLibre(OpenFreeMap), 데이터는 deck.gl을 MapLibre 레이어 사이에 끼워 그린다(interleaved).
// S1 지역 선택: 시군구 + 후보 3군 맥동 + 마우스를 올린 군 위에 카드 / S2 진단: 500m 격자 / S5 결과: 예산안 정책 배치.
import { useEffect, useMemo, useState } from 'react'
import { Map, Popup, type MapRef } from 'react-map-gl/maplibre'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer, PolygonLayer, ScatterplotLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import { DataFilterExtension, FillStyleExtension } from '@deck.gl/extensions'
import { useReducedMotion } from 'motion/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// maplibre-gl v6은 워커 경로를 런타임 문자열로 만들어 Vite가 빌드에 넣지 못한다 → 직접 번들해서 알려 준다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { REGIONS, regionOf } from '../data/regions'
import { usePlans, useStore, useUnitCost } from '../store'
import { tween, easeInOut } from '../motion/tween'
import { diagnoseGrid, facilityName, routeFrom, travel, weightOf } from './grid'
import { planLayers, planMap } from './planMap'
import { timeColor, AVG_ALPHA } from './colors'
import { useRafTime } from './useRafTime'
import { KOREA_VIEW, cameraFor, loadSigungu } from './geo'
import { RegionCard } from '../ui/RegionCard'

setWorkerUrl(workerUrl)

export type MapScreen = 'select' | 'diag' | 'result' | 'off'
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
const CANDIDATES = new Set(REGIONS.map((r) => r.code))
// 확장은 한 번만 만든다. 렌더마다 새로 만들면 deck.gl이 레이어를 처음부터 다시 만든다
const FILTER = [new DataFilterExtension({ filterSize: 1 })]
const PATTERN = [new FillStyleExtension({ pattern: true })]
// 경로는 격자와 같은 높이(0)라 깊이 검사에서 깨져 보인다 → 항상 위에 그린다
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
const ROUTE_BASE = { getPath: (r: any) => r.path, getTimestamps: (r: any) => r.timestamps, capRounded: true, jointRounded: true, trailLength: 1e6, fadeTrail: false, parameters: ON_TOP }
const HATCH = { hatch: { type: 'hatch', angle: 45, strokeWidth: 1, gap: 4 } } as const
const CAMERA_MS = 900
const DRAW_MS = 2000
export const planT = (mode: 'car' | 'bus') => (mode === 'car' ? 30 : 60)

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

// deck.gl 오버레이는 지도 객체에 한 번만 붙이고 레이어만 갈아 끼운다
type MapWithDeck = import('maplibre-gl').Map & { __deck?: MapLibreOverlay; __labelsBefore?: string }
function deckOf(map: MapWithDeck) {
  if (!map.__deck) {
    map.__deck = new MapLibreOverlay({ interleaved: true })
    map.addControl(map.__deck)
  }
  return map.__deck
}

export function MapView({ screen, onPickRegion, onBlocked, mapRef }: {
  screen: MapScreen
  onPickRegion: (code: string) => void
  onBlocked: (name: string) => void
  mapRef: React.RefObject<MapRef | null>
}) {
  const s = useStore()
  const reduce = useReducedMotion()
  const [sigungu, setSigungu] = useState<any>(null)
  const [myeon, setMyeon] = useState<any>(null)
  const [, setTick] = useState(0)
  const labelsBefore = (mapRef.current?.getMap() as MapWithDeck | undefined)?.__labelsBefore
  const [draw, setDraw] = useState<{ route: unknown; t: number }>({ route: null, t: 0 })
  useEffect(() => { loadSigungu().then(setSigungu); fetch('/data/myeon.geojson').then((r) => r.json()).then(setMyeon) }, [])

  const g = s.grid
  const region = g?.region
  const tr = useMemo(() => (g ? travel(g, s.mode) : null), [g, s.mode])
  const diag = useMemo(() => (g && tr ? diagnoseGrid(g, tr.t, s.age, s.T) : null), [g, tr, s.age, s.T])
  const route = useMemo(() => (g && s.selectedCell != null ? routeFrom(g, s.selectedCell, s.mode) : null), [g, s.selectedCell, s.mode])
  // deck.gl은 data가 새 객체면 다시 계산하므로, 매 프레임 렌더에서도 같은 객체를 쓰게 고정한다
  const candidateGeo = useMemo(() => sigungu && { ...sigungu, features: sigungu.features.filter((f: any) => CANDIDATES.has(f.properties.sgg)) }, [sigungu])
  const hoverGeo = useMemo(() => sigungu && s.hoverRegion && { ...sigungu, features: sigungu.features.filter((f: any) => f.properties.sgg === s.hoverRegion) }, [sigungu, s.hoverRegion])
  const myeonGeo = useMemo(() => (myeon && g ? { ...myeon, features: myeon.features.filter((f: any) => f.properties.sgg === g.region.code) } : null), [myeon, g])
  const aiCells = useMemo(() => g?.cells.filter((c) => c.aiFilled) ?? [], [g])
  const routeData = useMemo(() => (route ? [route] : []), [route])
  const hospital = useMemo(() => (g ? [{ at: [g.villages[g.hospital].lon, g.villages[g.hospital].lat], name: facilityName(g, g.hospital) }] : []), [g])
  // 마우스를 올린 군 카드는 그 군 경계의 위쪽 가운데에 붙인다
  const anchors = useMemo(() => {
    const out: Record<string, [number, number]> = {}
    candidateGeo?.features.forEach((f: any) => {
      const pts: number[][] = f.geometry.type === 'Polygon' ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2)
      const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
      out[f.properties.sgg] = [(Math.min(...lons) + Math.max(...lons)) / 2, Math.max(...lats)]
    })
    return out
  }, [candidateGeo])

  // 결과 화면: 고른 안(없으면 추천안)을 지도 위 위치로
  const plans = usePlans(screen === 'result' ? region : undefined)
  const c = useUnitCost()
  const shown = plans ? plans.find((p) => p.preset === (s.mapPlan ?? s.detail)) ?? plans.find((p) => p.recommended)! : null
  const pm = useMemo(() => (g && shown ? planMap(g, shown.opt, c, s.planMode, planT(s.planMode), s.age) : null), [g, shown, c, s.planMode, s.age])

  // 칸을 고르면: (필요하면) 카메라를 경로에 맞추고 → 도착한 뒤 0분부터 끝까지 선이 그려진다
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!route || !map) return
    if (reduce) { setDraw({ route, t: route.total }); return }
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const pad = W >= 1200 ? { left: 480, right: 340, top: 80, bottom: 80 } : W >= 720 ? { left: 480, right: 40, top: 240, bottom: 60 } : { left: 30, right: 30, top: 200, bottom: Math.min(340, H * 0.6) }
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
  const routeT = draw.route === route ? draw.t : 0

  // 반복 애니메이션은 필요한 동안만 돌린다
  const pulse = useRafTime(screen === 'select' && !reduce)
  const ring = useRafTime(screen === 'result' && !reduce)

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
        getFillColor: (f: any) => (f.properties.sgg === s.hoverRegion ? [47, 91, 211, 170] : CANDIDATES.has(f.properties.sgg) ? [47, 91, 211, 110] : [120, 120, 112, 26]),
        updateTriggers: { getFillColor: s.hoverRegion },
        getLineColor: [255, 255, 255, 220],
        lineWidthMinPixels: 0.6,
        transitions: { getFillColor: { duration: 400, enter: (c: number[]) => [c[0], c[1], c[2], 0] } },
        onHover: ({ object }: any) => {
          const code = object && CANDIDATES.has(object.properties.sgg) ? object.properties.sgg : null
          if (code !== useStore.getState().hoverRegion) useStore.getState().set({ hoverRegion: code })
        },
        onClick: ({ object }: any) => object && (CANDIDATES.has(object.properties.sgg) ? onPickRegion(object.properties.sgg) : onBlocked(object.properties.sggnm)),
        beforeId: labelsBefore,
      }),
      new GeoJsonLayer({
        id: 'candidates-glow',
        data: candidateGeo,
        filled: false,
        getLineColor: [47, 91, 211, 255],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        lineWidthScale: 1.5 + 1.5 * (0.5 + 0.5 * Math.sin(pulse / 400)),
        beforeId: labelsBefore,
      }),
      new GeoJsonLayer({ id: 'hover-line', data: hoverGeo ?? [], filled: false, getLineColor: [20, 40, 120, 255], lineWidthMinPixels: 3, parameters: ON_TOP }),
    )
  }

  if (g && tr && diag && screen === 'diag') {
    const sweeping = s.sweep != null
    const avgColor = timeColor(diag.avgMinutes / s.T, AVG_ALPHA)
    layers.push(
      new GeoJsonLayer({ id: 'myeon-lines', data: myeonGeo ?? [], filled: false, getLineColor: [60, 60, 70, 140], lineWidthMinPixels: 1, parameters: ON_TOP, beforeId: labelsBefore }),
      // 스윕 중 아직 안 켜진 칸이 보이는 바탕. 끝까지 회색으로 남는 칸이 곧 공백이다
      new PolygonLayer({ id: 'grid-base', data: g.cells, visible: sweeping, getPolygon: (cl: any) => cl.polygon, getFillColor: (cl: any) => (cl.pop > 0 ? [150, 150, 145, 120] : [150, 150, 145, 40]), stroked: false, beforeId: labelsBefore }),
      new PolygonLayer({
        id: 'grid',
        data: g.cells,
        opacity: route ? 0.6 : 1,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 120],
        stroked: true,
        getLineColor: [255, 255, 255, 60],
        lineWidthMinPixels: 0.5,
        getPolygon: (cl: any) => cl.polygon,
        getFillColor: (cl: any) => {
          if (!s.unfolded) return avgColor
          const hl = s.hoverVillage != null && cl.village === s.hoverVillage
          return timeColor(tr.t[cl.i] / s.T, hl ? 255 : cl.pop === 0 ? 60 : 200)
        },
        updateTriggers: { getFillColor: [tr, s.unfolded, s.hoverVillage, s.T, avgColor] },
        transitions: reduce ? {} : { getFillColor: { duration: 900, easing: (x: number) => 1 - Math.pow(1 - x, 3) } },
        extensions: FILTER,
        getFilterValue: (cl: any) => tr.t[cl.i],
        filterRange: [0, sweeping ? s.sweep! : 1e6],
        filterSoftRange: sweeping ? [0, Math.max(0, s.sweep! - 4)] : null,
        filterTransformColor: true,
        onClick: ({ object }: any) => object && s.set({ selectedCell: object.i }),
        beforeId: labelsBefore,
      }),
      // 인구가 5명 미만이라 통계에서 가려진 칸 → AI가 채웠다는 표시(빗금)
      new PolygonLayer({
        id: 'ai-filled', data: aiCells, visible: s.unfolded && !sweeping, getPolygon: (cl: any) => cl.polygon, getFillColor: [30, 40, 70, 255], opacity: 0.75, stroked: false,
        extensions: PATTERN, fillPatternMapping: HATCH, fillPatternMask: true, fillPatternSizeUnits: 'pixels', getFillPattern: () => 'hatch', parameters: ON_TOP, beforeId: labelsBefore,
      } as any),
      new ScatterplotLayer({
        id: 'facilities', data: hospital, getPosition: (f: any) => f.at, getRadius: 8, radiusUnits: 'pixels', getFillColor: [255, 255, 255], getLineColor: [214, 69, 93], stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 4, pickable: true, parameters: ON_TOP,
        transitions: reduce ? {} : { getRadius: { type: 'spring', stiffness: 0.08, damping: 0.3, enter: () => 0 } },
      }),
    )
    if (route) {
      layers.push(
        new TripsLayer({ ...ROUTE_BASE, id: 'route-casing', data: routeData, getColor: [255, 255, 255], widthMinPixels: 11, currentTime: routeT }),
        new TripsLayer({ ...ROUTE_BASE, id: 'route', data: routeData, getColor: [47, 91, 211], widthMinPixels: 6, currentTime: routeT }),
        new ScatterplotLayer({
          id: 'route-points', data: routePoints(route, routeT), getPosition: (p: any) => p.at, getRadius: (p: any) => (p.kind === 'head' ? 9 : 7), radiusUnits: 'pixels',
          getFillColor: (p: any) => (p.kind === 'end' ? [28, 28, 26] : p.kind === 'stop' ? [255, 255, 255] : [47, 91, 211]),
          getLineColor: (p: any) => (p.kind === 'stop' ? [47, 91, 211] : [255, 255, 255]), stroked: true, lineWidthMinPixels: 3, updateTriggers: { getRadius: routeT }, parameters: ON_TOP,
        }),
      )
    }
  }

  if (g && pm && screen === 'result') {
    layers.push(
      new GeoJsonLayer({ id: 'myeon-lines', data: myeonGeo ?? [], filled: false, getLineColor: [60, 60, 70, 140], lineWidthMinPixels: 1, parameters: ON_TOP, beforeId: labelsBefore }),
      ...planLayers({ g, pm, T: planT(s.planMode), reveal: s.reveal, time: ring, labelsBefore, reduce }),
    )
  }

  const getTooltip = ({ object, layer }: any) => {
    if (!object || !g) return null
    if (layer?.id === 'facilities') return { text: object.name }
    if (layer?.id === 'plan-hotspots') return { text: '교통사고 다발지점 (구조개선 대상)' }
    if (layer?.id === 'plan-marks') return { text: object.p.label || `${object.p.type}` }
    if (layer?.id === 'grid' && tr) {
      const v = g.villages[object.village]
      return { text: `${v.name}\n응급실까지 ${Math.round(tr.t[object.i])}분 · ${Math.round(weightOf(object, s.age))}명${object.aiFilled ? ' (AI 추정)' : ''}` }
    }
    return null
  }
  // 렌더마다 지금 화면의 레이어로 바꿔 끼운다
  useEffect(() => {
    const map = mapRef.current?.getMap() as MapWithDeck | undefined
    if (!map?.isStyleLoaded()) return
    deckOf(map).setProps({ layers, getTooltip })
    if (import.meta.env.DEV) (window as any).__map = map
  })

  const hover = screen === 'select' && s.hoverRegion ? regionOf(s.hoverRegion) : null
  return (
    <div className={`map-layer ${screen === 'off' ? 'off' : ''}`} aria-hidden={screen === 'off'}>
      <Map
        ref={mapRef}
        initialViewState={KOREA_VIEW}
        mapStyle={STYLE}
        style={{ position: 'absolute', inset: 0 }}
        maxPitch={0}
        attributionControl={{ compact: true }}
        onMove={() => hover && setTick((n) => n + 1)}
        onLoad={(e) => {
          // 지명은 한글을 먼저 쓰고, 데이터 레이어는 첫 지명 레이어 아래에 깐다
          const map = e.target
          const symbols = map.getStyle().layers.filter((l) => l.type === 'symbol')
          symbols.forEach((l) => { if (map.getLayoutProperty(l.id, 'text-field')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]) })
          ;(map as MapWithDeck).__labelsBefore = symbols[0]?.id
          setTick((n) => n + 1)
          useStore.getState().set({ mapReady: true })
        }}
      >
        {hover && anchors[hover.code] && (
          <Popup longitude={anchors[hover.code][0]} latitude={anchors[hover.code][1]} anchor="bottom" offset={10} closeButton={false} closeOnClick={false} className="region-pop" maxWidth="300px">
            <RegionCard r={hover} compact />
          </Popup>
        )}
      </Map>
    </div>
  )
}
