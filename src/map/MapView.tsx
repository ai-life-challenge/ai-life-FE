// 화면 뒤에 깔리는 지도 하나. 화면이 바뀌어도 같은 카메라가 이어져서 전국 → 군으로 날아간다.
// 바탕은 MapLibre(OpenFreeMap), 데이터는 deck.gl을 MapLibre 레이어 사이에 끼워 그린다(interleaved).
// S1 지역 선택: 시군구 + 마우스를 올린 군 위에 카드 / S2 진단: 마을별 판정 / S5 결과: 고른 안이 닿는 마을과 공급수단.
import { useEffect, useMemo, useState } from 'react'
import { Map, Popup, type MapRef } from 'react-map-gl/maplibre'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer, IconLayer, PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { useReducedMotion } from 'motion/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// maplibre-gl v6은 워커 경로를 런타임 문자열로 만들어 Vite가 빌드에 넣지 못한다 → 직접 번들해서 알려 준다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useStore } from '../store'
import { useShownJudge } from '../hooks'
import { CAR_TARGETS, STATE_NAME, STATE_RGB, SUPPLY } from '../api/meta'
import type { JudgedVillage, RawFacility } from '../api/types'
import { useRafTime } from './useRafTime'
import { erGrid, minuteRgb, type TimeCell } from '../api/cells'
import { KIND_RE, targetMinutes } from '../api/judge'
import { KOREA_VIEW, loadSigungu } from './geo'
import { clusterByPixel, type Cluster } from './cluster'
import { RegionCard } from '../ui/RegionCard'

// 아래 가운데를 좌표에 맞춰 건물이 그 자리에 서 있게 한다
const icon = (id: string) => ({ id, url: `/icons/${id}.png`, width: 256, height: 256, anchorY: 256 })
// size는 미터라 확대하면 커지고, 화면에서는 min~max 픽셀 사이로만 움직인다. 그림마다 건물이 차지하는 비율이 달라 최소 크기를 따로 둔다
// 그리는 순서(의원 → 보건소 → 병원)대로 적어 둔다: 겹치면 병원이 위에 온다
const FACILITY = {
  clinic: { icon: icon('hospital'), size: 900, min: 28, max: 80 }, // 시험: 모든 시설을 병원 아이콘으로 통일
  'health-center': { icon: icon('hospital'), size: 900, min: 28, max: 80 },
  hospital: { icon: icon('hospital'), size: 900, min: 28, max: 80 },
}
// 못 가는 마을은 원 대신 빨간 X로 그린다 (흰 테두리를 둘러 바탕색 위에서도 보이게)
const X_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M14 14L50 50M50 14L14 50" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M14 14L50 50M50 14L14 50" stroke="#d6455d" stroke-width="11" stroke-linecap="round"/></svg>`
const X_ICON = { id: 'x', url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(X_SVG)}`, width: 64, height: 64 }
const facilityKind = (kind: string): keyof typeof FACILITY => (/병원|종합/.test(kind) ? 'hospital' : /보건/.test(kind) ? 'health-center' : 'clinic')

setWorkerUrl(workerUrl)

export type MapScreen = 'select' | 'diag' | 'result' | 'off'
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
// 선은 마을 점과 같은 높이(0)라 깊이 검사에서 깨져 보인다 → 항상 위에 그린다
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
const NEW_RGB: [number, number, number] = [47, 91, 211] // 이 안으로 새로 닿는 마을
const radius = (people: number) => Math.min(24, 4 + Math.sqrt(people) * 0.9)
// 진단 지도 묶음: 시설만 묶는다. 못 가는 마을(빨간 X)은 묶지 않고 항상 보인다('갈 수 있음' 마을은 그리지 않는다). 이 줌부터는 묶지 않는다
const CLUSTER_MAX_ZOOM = 15
type Pin = { kind: 'village'; v: JudgedVillage } | { kind: 'facility'; f: RawFacility }
const pinAt = (p: Pin): [number, number] => (p.kind === 'village' ? [p.v.lon, p.v.lat] : [p.f.lon, p.f.lat])
const clusterText = (c: Cluster<Pin>) => {
  const n = { village: 0, hospital: 0, 'health-center': 0, clinic: 0 }
  c.items.forEach((p) => { n[p.kind === 'village' ? 'village' : facilityKind(p.f.kind)]++ })
  return [n.village && `갈 수 있는 마을 ${n.village}`, n.hospital && `병원 ${n.hospital}`, n.clinic && `의원 ${n.clinic}`, n['health-center'] && `보건소 ${n['health-center']}`].filter(Boolean).join(' · ')
}

// deck.gl 오버레이는 지도 객체에 한 번만 붙이고 레이어만 갈아 끼운다
type MapWithDeck = import('maplibre-gl').Map & { __deck?: MapLibreOverlay; __labelsBefore?: string; __roadsBefore?: string }
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
  const { regions, hoverRegion, hoverVillage, showDots, showFacilities, sweep, thinking, carTarget, map: myeon, data, state, plans, judge, set, patch } = useStore()
  const reduce = useReducedMotion()
  const [sigungu, setSigungu] = useState<any>(null)
  const [, setTick] = useState(0)
  const [zoom, setZoom] = useState(KOREA_VIEW.zoom) // 0.5 단위로만 바꿔 매 프레임 다시 그리지 않는다
  const labelsBefore = (mapRef.current?.getMap() as MapWithDeck | undefined)?.__labelsBefore
  const roadsBefore = (mapRef.current?.getMap() as MapWithDeck | undefined)?.__roadsBefore
  useEffect(() => { loadSigungu().then(setSigungu) }, [])

  const local = useShownJudge()
  const candidates = useMemo(() => new Set(regions.map((r) => r.code)), [regions])
  // deck.gl은 data가 새 객체면 다시 계산하므로, 매 프레임 렌더에서도 같은 객체를 쓰게 고정한다
  const candidateGeo = useMemo(() => sigungu && { ...sigungu, features: sigungu.features.filter((f: any) => candidates.has(f.properties.sgg)) }, [sigungu, candidates])
  const hoverGeo = useMemo(() => sigungu && hoverRegion && { ...sigungu, features: sigungu.features.filter((f: any) => f.properties.sgg === hoverRegion) }, [sigungu, hoverRegion])
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

  // 결과 화면: 고른 안이 닿는 정도. 서버가 주는 coverage는 서버 판정 마을과 같은 순서다
  const shown = plans.data?.plans[state?.planShow ?? 0] ?? plans.data?.plans.find((p) => p.recommended) ?? null
  const byId = useMemo(() => new globalThis.Map((data?.villages ?? []).map((v) => [v.id, v])), [data])
  const cover = useMemo(() => {
    const sv = judge.data?.villages
    if (!shown || !sv || sv.length !== shown.coverage.length) return null
    return new globalThis.Map(sv.map((v, i) => [v.id, shown.coverage[i]]))
  }, [shown, judge.data])
  const planPaths = useMemo(() => (shown?.picks ?? []).filter((p) => p.villages.length > 1).map((p) => ({ type: p.type, path: p.villages.flatMap((id) => { const v = byId.get(id); return v ? [[v.lon, v.lat]] : [] }) })), [shown, byId])
  const planMarks = useMemo(() => (shown?.picks ?? []).flatMap((p) => p.villages.flatMap((id) => { const v = byId.get(id); return v ? [{ at: [v.lon, v.lat] as [number, number], type: p.type, label: `${p.label} · ${v.name}` }] : [] })), [shown, byId])
  const drtGeo = useMemo(() => myeon && shown && { ...myeon, features: myeon.features.filter((f) => shown.picks.some((p) => p.myeon && p.myeon === f.properties?.name)) }, [myeon, shown])

  // 진단 화면 바탕: 레퍼런스 지도처럼 600m 안팎의 칸마다 고른 시설까지 걸리는 시간(서버 마을 값을 이어 칠함)을 초록~주황으로 칠한다 칸과 이웃은 지역이 바뀔 때만 다시 계산한다
  const age = state?.age ?? 'a80'
  // 고른 시설(전체 · 병원급 · 의원 · 보건기관 · 응급실)에 맞춰 바탕색 시간도 바뀐다
  const timeCells = useMemo(() => {
    if (!data || !myeon) return []
    const mins = targetMinutes(data, carTarget)
    return erGrid(data.villages.map((v, i) => ({ lon: v.lon, lat: v.lat, people: v.pop[age], minutes: mins[i] })), myeon, 60)
  }, [data, myeon, age, carTarget])

  const countyGeo = useMemo(() => sigungu && data && { ...sigungu, features: sigungu.features.filter((f: any) => f.properties.sgg === data.code) }, [sigungu, data])

  // 고른 시설 종류만 지도에 보인다(병원급 · 의원 · 보건기관). 응급실은 시설 목록에 없어 아이콘을 숨긴다
  const facs = useMemo(() => (!data ? [] : carTarget === 'med' ? data.facilities : carTarget === 'er' ? [] : data.facilities.filter((f) => KIND_RE[carTarget].test(f.kind))), [data, carTarget])

  const pins: Pin[] = local && data && screen === 'diag' ? [
    ...(showFacilities ? facs.map((f) => ({ kind: 'facility' as const, f })) : []),
  ] : []
  const clusters = zoom >= CLUSTER_MAX_ZOOM ? pins.map((p) => ({ lon: pinAt(p)[0], lat: pinAt(p)[1], items: [p] })) : clusterByPixel(pins, pinAt, zoom)
  const singles = clusters.filter((c) => c.items.length === 1).map((c) => c.items[0])
  const groups = clusters.filter((c) => c.items.length > 1)

  const scanning = thinking && screen === 'result' && !reduce // 예산안을 계산하는 동안 못 가는 마을을 훑는다
  const ring = useRafTime((screen === 'select' || scanning) && !reduce)
  const layers: Layer[] = []

  if (sigungu && screen === 'select') {
    layers.push(
      new GeoJsonLayer({
        id: 'sigungu', data: sigungu, pickable: true, autoHighlight: true, highlightColor: [47, 91, 211, 90], stroked: true, filled: true,
        getFillColor: (f: any) => (f.properties.sgg === hoverRegion ? [47, 91, 211, 170] : candidates.has(f.properties.sgg) ? [47, 91, 211, 110] : [120, 120, 112, 26]),
        updateTriggers: { getFillColor: [hoverRegion, candidates] },
        getLineColor: [255, 255, 255, 220], lineWidthMinPixels: 0.6,
        transitions: { getFillColor: { duration: 400, enter: (c: number[]) => [c[0], c[1], c[2], 0] } },
        onHover: ({ object }: any) => {
          const code = object && candidates.has(object.properties.sgg) ? object.properties.sgg : null
          if (code !== useStore.getState().hoverRegion) set({ hoverRegion: code })
        },
        onClick: ({ object }: any) => object && (candidates.has(object.properties.sgg) ? onPickRegion(object.properties.sgg) : onBlocked(object.properties.sggnm)),
        beforeId: labelsBefore,
      }),
      new GeoJsonLayer({
        id: 'candidates-glow', data: candidateGeo, filled: false, getLineColor: [47, 91, 211, 255], lineWidthUnits: 'pixels', getLineWidth: 1,
        lineWidthScale: 1.5 + 1.5 * (0.5 + 0.5 * Math.sin(ring / 400)), beforeId: labelsBefore,
      }),
      new GeoJsonLayer({ id: 'hover-line', data: hoverGeo ?? [], filled: false, getLineColor: [20, 40, 120, 255], lineWidthMinPixels: 3, parameters: ON_TOP }),
    )
  }

  const myeonLines = new GeoJsonLayer({ id: 'myeon-lines', data: myeon ?? [], filled: false, getLineColor: [60, 60, 70, 140], lineWidthMinPixels: 1, parameters: ON_TOP, beforeId: labelsBefore })
  // 시설 3종을 3D 아이콘으로. 종류마다 레이어를 나눠야 최소 크기를 따로 줄 수 있다
  const facilityLayers = (list: RawFacility[]) => (Object.keys(FACILITY) as (keyof typeof FACILITY)[]).map((k) => new IconLayer({
    id: `facilities-${k}`, data: list.filter((f) => facilityKind(f.kind) === k), getPosition: (f: any) => [f.lon, f.lat],
    getIcon: () => FACILITY[k].icon, getSize: FACILITY[k].size, sizeUnits: 'meters', sizeMinPixels: FACILITY[k].min, sizeMaxPixels: FACILITY[k].max,
    visible: showFacilities, pickable: true, parameters: ON_TOP,
  }))

  if (data && local && screen === 'diag') {
    const sel = state?.selectedVillage ?? null
    layers.push(
      new PolygonLayer<TimeCell>({
        id: 'time', data: timeCells, pickable: true, getPolygon: (c: TimeCell) => c.polygon,
        getFillColor: (c: TimeCell) => [...minuteRgb(c.minutes), sweep != null && c.minutes > sweep ? 0 : c.lived ? 150 : 45], updateTriggers: { getFillColor: sweep }, // 스윕 중에는 아직 못 닿은 칸을 비운다
        stroked: true, getLineColor: [255, 255, 255, 120], lineWidthUnits: 'pixels', getLineWidth: 1, beforeId: roadsBefore,
      } as any),
      myeonLines,
      new GeoJsonLayer({ id: 'county-line', data: countyGeo ?? [], filled: false, getLineColor: [110, 110, 120, 200], lineWidthMinPixels: 1.2, parameters: ON_TOP }),
      ...facilityLayers(singles.flatMap((p) => (p.kind === 'facility' ? [p.f] : []))),
      new ScatterplotLayer<Cluster<Pin>>({
        id: 'clusters', data: groups, pickable: true, getPosition: (c) => [c.lon, c.lat], radiusUnits: 'pixels', getRadius: (c) => 13 + Math.min(10, Math.sqrt(c.items.length) * 2.5),
        getFillColor: [255, 255, 255, 245], stroked: true, getLineColor: [60, 60, 70, 160], lineWidthUnits: 'pixels', getLineWidth: 1.5, parameters: ON_TOP,
        onClick: ({ object }: any) => {
          if (!object) return
          const ll = (object as Cluster<Pin>).items.map(pinAt), lons = ll.map((p) => p[0]), lats = ll.map((p) => p[1])
          mapRef.current?.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 120, maxZoom: CLUSTER_MAX_ZOOM + 0.5, duration: 600 })
        },
      }),
      new TextLayer<Cluster<Pin>>({
        id: 'cluster-count', data: groups, getPosition: (c) => [c.lon, c.lat], getText: (c) => String(c.items.length),
        getSize: 13, fontWeight: 700, getColor: [28, 28, 26, 255], getTextAnchor: 'middle', getAlignmentBaseline: 'center', parameters: ON_TOP,
      }),
      new IconLayer<JudgedVillage>({
        // 못 가는 마을은 이유(버스 없음 · 너무 멂)와 상관없이 모두 X. 대중교통/자가용 중 무엇을 보는지는 useShownJudge가 정한다
        id: 'villages-x', data: local.villages.filter((v) => v.state !== 0), visible: showDots, pickable: true,
        getPosition: (v) => [v.lon, v.lat], getIcon: () => X_ICON, sizeUnits: 'pixels',
        getSize: (v) => radius(v.people) * 2 * (v.id === sel || v.id === hoverVillage ? 1.25 : 1), updateTriggers: { getSize: [sel, hoverVillage] },
        parameters: ON_TOP,
        onClick: ({ object }: any) => object && patch((s) => ({ ...s, selectedVillage: object.id })),
        onHover: ({ object }: any) => { const id = object?.id ?? null; if (id !== useStore.getState().hoverVillage) set({ hoverVillage: id }) },
      }),
    )
  }

  if (data && local && screen === 'result') {
    layers.push(
      new GeoJsonLayer({ id: 'plan-drt', data: drtGeo ?? [], filled: true, stroked: true, getFillColor: [...hexRgb(SUPPLY.drt.color), 55], getLineColor: [...hexRgb(SUPPLY.drt.color), 255], lineWidthMinPixels: 2, beforeId: labelsBefore }),
      myeonLines,
      new PathLayer({ id: 'plan-paths', data: planPaths, getPath: (d: any) => d.path, getColor: (d: any) => [...hexRgb(SUPPLY[d.type as keyof typeof SUPPLY].color), 200], widthMinPixels: 2.5, parameters: ON_TOP }),
      new ScatterplotLayer<JudgedVillage>({
        id: 'villages', data: local.villages, pickable: true,
        getPosition: (v) => [v.lon, v.lat], getRadius: (v) => radius(v.people), radiusUnits: 'pixels',
        // 원래 갈 수 있는 마을은 초록, 안 때문에 새로 닿는 마을은 파랑, 아직 못 닿는 마을은 원래 색(빨강·보라). 일부만 닿으면 섞는다
        getFillColor: (v) => {
          if (v.state === 0) return [...STATE_RGB[0], 190]
          const c = cover?.get(v.id) ?? 0, a = STATE_RGB[v.state]
          return [a[0] + (NEW_RGB[0] - a[0]) * c, a[1] + (NEW_RGB[1] - a[1]) * c, a[2] + (NEW_RGB[2] - a[2]) * c, 220]
        },
        updateTriggers: { getFillColor: [cover, local] },
        stroked: true, getLineColor: [255, 255, 255, 230], lineWidthUnits: 'pixels', getLineWidth: 1,
        transitions: reduce ? {} : { getFillColor: 500 },
      }),
      new ScatterplotLayer({
        id: 'plan-marks', data: planMarks, pickable: true, getPosition: (d: any) => d.at, radiusUnits: 'pixels', getRadius: 13, filled: false, stroked: true,
        getLineColor: (d: any) => [...hexRgb(SUPPLY[d.type as keyof typeof SUPPLY].color), 255], lineWidthUnits: 'pixels', getLineWidth: 3.5, parameters: ON_TOP,
      }),
      ...(scanning ? [new ScatterplotLayer<JudgedVillage>({
        id: 'scan', data: local.villages.filter((v) => v.state !== 0), getPosition: (v) => [v.lon, v.lat], radiusUnits: 'pixels', stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2, parameters: ON_TOP,
        // 마을마다 시작 시점을 어긋나게 해서, 파동이 하나씩 번져 나가는 것처럼 보인다
        getRadius: (_v: JudgedVillage, { index }: { index: number }) => 6 + 34 * ((ring / 1400 + index * 0.37) % 1),
        getLineColor: (_v: JudgedVillage, { index }: { index: number }) => [214, 69, 93, Math.round(220 * (1 - ((ring / 1400 + index * 0.37) % 1)))],
        updateTriggers: { getRadius: ring, getLineColor: ring },
      })] : []),
      ...(data ? facilityLayers(facs) : []),
    )
  }

  const getTooltip = ({ object, layer }: any) => {
    if (!object) return null
    if (layer?.id.startsWith('facilities')) return { text: `${object.name}\n${object.kind}${object.doctors ? ` · 의사 ${object.doctors}명` : ''}` }
    if (layer?.id === 'time') return { text: `${data?.villages[object.village]?.name ?? ''}\n${CAR_TARGETS.find((x) => x.id === carTarget)!.short}까지 약 ${Math.round(object.minutes)}분 · ${object.lived ? `${Math.round(object.people)}명` : '사람이 안 사는 곳'} (마을 값을 이어 칠함)` }
    if (layer?.id === 'clusters') return { text: `${object.items.length}곳 · 누르면 펼쳐져요\n${clusterText(object)}` }
    if (layer?.id === 'plan-marks') return { text: object.label }
    if (layer?.id.startsWith('villages')) {
      const c = screen === 'result' ? cover?.get(object.id) : undefined
      return { text: `${object.name}\n${Math.round(object.people)}명 · ${STATE_NAME[object.state as 0]}${c != null && object.state !== 0 ? `\n이 안으로 ${Math.round(c * 100)}% 닿음` : ''}` }
    }
    return null
  }
  // 렌더마다 지금 화면의 레이어로 바꿔 끼운다
  useEffect(() => {
    const map = mapRef.current?.getMap() as MapWithDeck | undefined
    if (!map) return
    const apply = () => deckOf(map).setProps({ layers, getTooltip })
    if (import.meta.env.DEV) (window as any).__map = map
    // 타일을 불러오는 중(확대 직후 등)에는 isStyleLoaded가 false라, 그때 바뀐 레이어는 다 불러온 뒤에 끼운다
    if (map.isStyleLoaded()) apply()
    else { map.once('idle', apply); return () => { map.off('idle', apply) } }
  })

  const hover = screen === 'select' && hoverRegion ? regions.find((r) => r.code === hoverRegion) : null
  return (
    <div className={`map-layer ${screen === 'off' ? 'off' : ''}`} aria-hidden={screen === 'off'}>
      <Map
        ref={mapRef}
        initialViewState={KOREA_VIEW}
        mapStyle={STYLE}
        style={{ position: 'absolute', inset: 0 }}
        maxPitch={0}
        attributionControl={{ compact: true }}
        onMove={(e) => { const z = Math.round(e.viewState.zoom * 2) / 2; if (z !== zoom) setZoom(z); if (hover) setTick((n) => n + 1) }}
        onLoad={(e) => {
          // 지명은 한글을 먼저 쓰고, 데이터 레이어는 첫 지명 레이어 아래에 깔다
          const map = e.target
          const symbols = map.getStyle().layers.filter((l) => l.type === 'symbol')
          symbols.forEach((l) => { if (map.getLayoutProperty(l.id, 'text-field')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]) })
          ;(map as MapWithDeck).__labelsBefore = symbols[0]?.id
          // 바탕 격자는 도로 아래에 깔아 도로가 보이게 한다
          ;(map as MapWithDeck).__roadsBefore = map.getStyle().layers.find((l) => (l as any)['source-layer'] === 'transportation')?.id ?? symbols[0]?.id
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

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
