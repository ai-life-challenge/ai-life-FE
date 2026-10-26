// 화면 뒤에 깔리는 지도 하나. 화면이 바뀌어도 같은 카메라가 이어져서 전국 → 군으로 날아간다.
// 바탕은 MapLibre(OpenFreeMap), 데이터는 deck.gl을 MapLibre 레이어 사이에 끼워 그린다(interleaved).
// S1 지역 선택: 시군구 + 마우스를 올린 군 위에 카드 / S2 진단: 마을별 판정 / S5 결과: 고른 안이 닿는 마을과 공급수단.
import { useEffect, useMemo, useState } from 'react'
import { Map, Popup, type MapRef } from 'react-map-gl/maplibre'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer, IconLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import { PathStyleExtension } from '@deck.gl/extensions'
import { TripsLayer } from '@deck.gl/geo-layers'
import { useReducedMotion } from 'motion/react'
import 'maplibre-gl/dist/maplibre-gl.css'
import { setWorkerUrl } from 'maplibre-gl'
// maplibre-gl v6은 워커 경로를 런타임 문자열로 만들어 Vite가 빌드에 넣지 못한다 → 직접 번들해서 알려 준다
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useStore } from '../store'
import { useShownJudge } from '../hooks'
import { CAR_TARGETS, STATE_CSS, STATE_NAME, STATE_RGB, SUPPLY } from '../api/meta'
import type { JudgedVillage, RawFacility } from '../api/types'
import { useRafTime } from './useRafTime'
import { erGrid, minuteRgb, type TimeCell } from '../api/cells'
import { KIND_RE, targetMinutes } from '../api/judge'
import { KOREA_VIEW, boxOf, fitCounty, loadSigungu } from './geo'
import { clusterByPixel, type Cluster } from './cluster'
import { RegionCard } from '../ui/RegionCard'

// 아래 가운데를 좌표에 맞춰 건물이 그 자리에 서 있게 한다
const icon = (id: string) => ({ id, url: `/icons/${id}.png`, width: 256, height: 256, anchorY: 256 })
// 아이콘은 화면 픽셀 크기로 고정한다(예전엔 미터라 확대하면 80px까지 커져 묶음 거리 44px를 넘고 서로 · 묶음과 겹쳤다). 묶음 거리(CLUSTER_PX)보다 작게 둔다
// 그리는 순서(의원 → 보건소 → 병원)대로 적어 둔다: 겹치면 병원이 위에 온다
const FACILITY = {
  clinic: { icon: icon('hospital'), size: 32 }, // 모든 시설을 병원 아이콘으로 통일
  'health-center': { icon: icon('hospital'), size: 32 },
  hospital: { icon: icon('hospital'), size: 36 },
}
const CLUSTER_PX = 48 // 화면에서 이만큼 가까운 시설은 한 묶음으로
// 못 가는 마을은 원 대신 X로 그린다 (흰 테두리를 둘러 바탕색 위에서도 보이게). 색은 이유별: 빨강 버스가 없어 못 감 · 보라 병원이 너무 멀어 못 감
const xSvg = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M14 14L50 50M50 14L14 50" stroke="#fff" stroke-width="20" stroke-linecap="round"/><path d="M14 14L50 50M50 14L14 50" stroke="${color}" stroke-width="11" stroke-linecap="round"/></svg>`
const xIcon = (state: 1 | 2) => ({ id: `x${state}`, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xSvg(STATE_CSS[state]))}`, width: 64, height: 64 })
const X_ICON = { 1: xIcon(1), 2: xIcon(2) }
const facilityKind = (kind: string): keyof typeof FACILITY => (/병원|종합/.test(kind) ? 'hospital' : /보건/.test(kind) ? 'health-center' : 'clinic')

setWorkerUrl(workerUrl)

export type MapScreen = 'select' | 'diag' | 'result' | 'off'
const STYLE = 'https://tiles.openfreemap.org/styles/positron'
// 선은 마을 점과 같은 높이(0)라 깊이 검사에서 깨져 보인다 → 항상 위에 그린다
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
// 노선을 도는 버스 아이콘(순회 진료 버스 색 원 + 흰 버스)
const BUS_ICON = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#e3a21a" stroke="#fff" stroke-width="5"/><rect x="18" y="17" width="28" height="26" rx="5" fill="#fff"/><rect x="22" y="21" width="20" height="9" rx="2" fill="#e3a21a"/><circle cx="24" cy="46" r="3.5" fill="#fff"/><circle cx="40" cy="46" r="3.5" fill="#fff"/></svg>')}`
const LABEL_FONT = 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif'
const NEW_RGB: [number, number, number] = [47, 91, 211] // 이 안으로 새로 닿는 마을
const radius = (people: number) => Math.min(24, 4 + Math.sqrt(people) * 0.9)
// 진단 지도 묶음: 시설만 묶는다. 못 가는 마을(빨간 X)은 묶지 않고 항상 보인다('갈 수 있음' 마을은 그리지 않는다). 이 줌부터는 묶지 않는다
const CLUSTER_MAX_ZOOM = 14 // 마을 하나가 화면을 채우는 배율: 여기부터는 다 풀어서 보인다
const NAME_ZOOM = 12.5 // 이 배율부터 낱개 시설 아래에 이름을 단다
// 지도는 대한민국(독도 · 제주 포함)까지만: 이 밖으로 옮기거나 더 줄일 수 없다
const KOREA_BOUNDS: [number, number, number, number] = [121.6, 31.0, 134.2, 40.4] // [서, 남, 동, 북] 한반도 둘레에 바다를 조금 더 둬서 한 단계쯤 더 줄일 수 있다
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
  const { regions, hoverRegion, hoverVillage, hoverSupply, gridTarget, showDots, showFacilities, sweep, thinking, carTarget, map: myeon, data, state, plans, judge, set, patch } = useStore()
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
  // 순회 진료 버스 노선: 보건소(depot)에서 출발해 고른 마을을 돌고 보건소로 돌아온다. 도로 경로 자료가 없어 정류장 사이를 곧게 잇는다
  // ponytail: 정류장 사이 직선, 실제 도로를 따라가려면 경로 탐색(OSRM 등) 자료가 있어야 한다
  const routes = useMemo(() => {
    if (!data) return []
    const depot = byId.get(data.depot)
    return (shown?.picks ?? []).filter((p) => p.type === 'tour').map((p) => {
      const stops = p.villages.flatMap((id) => { const v = byId.get(id); return v && v.id !== depot?.id ? [v] : [] })
      const pts = [...(depot ? [depot] : []), ...stops, ...(depot ? [depot] : [])].map((v) => [v.lon, v.lat] as [number, number])
      // 구간마다 가운데에 진행 방향 화살표
      const arrows = pts.slice(1).map((q, i) => { const a = pts[i]; return { at: [(a[0] + q[0]) / 2, (a[1] + q[1]) / 2] as [number, number], angle: (Math.atan2(q[1] - a[1], (q[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180)) * 180) / Math.PI } })
      // 정류장까지 누적 거리(km, 대략): 노선이 그려지는 속도와 버스 위치를 거리에 맞춘다
      const times = pts.reduce<number[]>((acc, q, i) => { if (!i) return [0]; const a = pts[i - 1]; const dx = (q[0] - a[0]) * 88.8, dy = (q[1] - a[1]) * 111; return [...acc, acc[i - 1] + Math.hypot(dx, dy)] }, [])
      return { path: pts, times, length: times.at(-1) || 1, stops: stops.map((v, i) => ({ at: [v.lon, v.lat] as [number, number], n: i + 1, name: v.name })), depot: depot && { at: [depot.lon, depot.lat] as [number, number], name: depot.name }, arrows, label: p.label }
    })
  }, [shown, byId, data])
  const planMarks = useMemo(() => (shown?.picks ?? []).filter((p) => p.type !== 'tour').flatMap((p) => p.villages.flatMap((id) => { const v = byId.get(id); return v ? [{ at: [v.lon, v.lat] as [number, number], type: p.type, label: `${p.label} · ${v.name}` }] : [] })), [shown, byId])
  const drtGeo = useMemo(() => myeon && shown && { ...myeon, features: myeon.features.filter((f) => shown.picks.some((p) => p.myeon && p.myeon === f.properties?.name)) }, [myeon, shown])
  // 수요응답형 버스 구역 이름표 자리: 면에서 가장 큰 땅덩이(섬이 여럿이면 본섬)의 테두리 상자 가운데
  const drtLabels = useMemo(() => (drtGeo?.features ?? []).map((f: any) => {
    const rings: number[][][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((poly: number[][][]) => poly[0])
    const ring = rings.reduce((a, r) => (r.length > a.length ? r : a), [] as number[][])
    const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1])
    const at = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
    return { at, text: `수요응답형 버스 · ${f.properties?.name ?? ''} 안에서 부르면 와요` }
  }), [drtGeo])

  // 진단 화면 바탕: 레퍼런스 지도처럼 600m 안팎의 칸마다 고른 시설까지 걸리는 시간(서버 마을 값을 이어 칠함)을 초록~주황으로 칠한다 칸과 이웃은 지역이 바뀔 때만 다시 계산한다
  const age = state?.age ?? 'a80'
  // 고른 시설(전체 · 병원급 · 의원 · 보건기관 · 응급실)에 맞춰 바탕색 시간도 바뀐다
  // 결과 지도는 진단에서 고르고 넘어온 시설(gridTarget)과 나이대로 같은 격자를 깐다
  const gridBy = screen === 'result' ? gridTarget : carTarget
  const timeCells = useMemo(() => {
    if (!data || !myeon) return []
    const mins = targetMinutes(data, gridBy)
    return erGrid(data.villages.map((v, i) => ({ lon: v.lon, lat: v.lat, people: v.pop[age], minutes: mins[i] })), myeon, 60)
  }, [data, myeon, age, gridBy])
  // 옅게 칠하는 칸: 근처 1.2km에 마을이 없거나(lived=false), 가장 가까운 마을에 고른 나이대 주민이 0명인 칸. 사람이 있는 칸만 진하게
  const faint = (c: TimeCell) => !c.lived || Math.round(c.people) === 0
  const timeLayer = (alpha = 1) => new PolygonLayer<TimeCell>({
    id: 'time', data: timeCells, pickable: screen === 'diag', getPolygon: (c: TimeCell) => c.polygon,
    getFillColor: (c: TimeCell) => [...minuteRgb(c.minutes), sweep != null && c.minutes > sweep ? 0 : Math.round((faint(c) ? 45 : 150) * alpha)], updateTriggers: { getFillColor: [sweep, alpha] }, // 스윕 중에는 아직 못 닿은 칸을 비운다
    stroked: true, getLineColor: [255, 255, 255, 120], lineWidthUnits: 'pixels', getLineWidth: 1, beforeId: roadsBefore,
  } as any)

  // 레이어 data는 참조가 바뀌면 deck.gl이 GPU 버퍼를 통째로 다시 만든다. 연출 중 매 프레임 다시 그려도 새 배열이 생기지 않게 미리 만들어 둔다
  const badVillages = useMemo(() => local?.villages.filter((v) => v.state !== 0) ?? [], [local])
  const newVillages = useMemo(() => badVillages.filter((v) => (cover?.get(v.id) ?? 0) > 0.5), [badVillages, cover])
  const routeStops = useMemo(() => routes.flatMap((r) => r.stops), [routes])
  const routeArrows = useMemo(() => routes.flatMap((r) => r.arrows), [routes])
  const routeDepots = useMemo(() => routes.flatMap((r) => (r.depot ? [r.depot] : [])), [routes])
  const routeLabels = useMemo(() => routes.flatMap((r) => (r.depot ? [{ at: r.depot.at, text: `순회 진료 버스 노선 · ${r.depot.name} 보건소 출발·도착` }] : [])), [routes])

  // 결과 연출 시계: 안을 바꿀 때마다 0부터. 노선이 그려지고(0~1.4초) → 정류장이 차례로 뜨고 → 버스가 노선을 돈다. 수요응답 구역은 숨 쉬듯 깜빡인다
  const planKey = screen === 'result' ? shown?.picks.map((p) => p.label).join('|') : undefined
  const animate = screen === 'result' && !!shown && !reduce
  // 계속 움직이는 건 버스(30fps)와 수요응답 구역 깜빡임(15fps)뿐. 둘 다 없으면 등장 연출(3초)만 하고 멈춘다
  const hasTour = (shown?.picks ?? []).some((p) => p.type === 'tour'), hasDrt = (shown?.picks ?? []).some((p) => p.type === 'drt')
  const tp = useRafTime(animate, planKey, { fps: hasTour ? 30 : 15, until: hasTour || hasDrt ? Infinity : 3000 }) / 1000
  const T = animate ? tp : 99 // 움직임 줄이기면 끝난 모습
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
  const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3)
  const draw = easeOut(T / 1.4) // 노선이 그려진 비율
  const pop = (i: number) => easeOut((T - 0.9 - i * 0.12) / 0.35) // 정류장 i가 뜬 정도
  const dim = (type: string) => (hoverSupply && hoverSupply !== type ? 0.22 : 1) // 범례에서 다른 수단에 손을 올리면 흐리게
  const LOOP = 9 // 버스가 노선을 한 바퀴 도는 초
  const busAt = (r: (typeof routes)[number]) => {
    const d = (((T - 1.6) % LOOP) / LOOP) * r.length
    const i = Math.max(1, r.times.findIndex((x) => x >= d))
    const a = r.path[i - 1], b = r.path[i] ?? a, seg = (r.times[i] ?? r.length) - r.times[i - 1] || 1, f = (d - r.times[i - 1]) / seg
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as [number, number]
  }

  const countyGeo = useMemo(() => sigungu && data && { ...sigungu, features: sigungu.features.filter((f: any) => f.properties.sgg === data.code) }, [sigungu, data])

  // 고른 시설 종류만 지도에 보인다(병원급 · 의원 · 보건기관). 응급실은 시설 목록에 없어 아이콘을 숨긴다
  const facs = useMemo(() => (!data ? [] : carTarget === 'med' ? data.facilities : carTarget === 'er' ? [] : data.facilities.filter((f) => KIND_RE[carTarget].test(f.kind))), [data, carTarget])

  // 시설 묶음은 O(n²)라 확대 단계나 시설 목록이 바뀔 때만 다시 계산한다(마우스를 올릴 때마다 다시 하지 않게)
  const pins: Pin[] = useMemo(() => (local && data && screen === 'diag' && showFacilities ? facs.map((f) => ({ kind: 'facility' as const, f })) : []), [local, data, screen, showFacilities, facs])
  const clusters = useMemo(() => (zoom >= CLUSTER_MAX_ZOOM ? pins.map((p) => ({ lon: pinAt(p)[0], lat: pinAt(p)[1], items: [p] })) : clusterByPixel(pins, pinAt, zoom, CLUSTER_PX)), [pins, zoom])
  const singles = clusters.filter((c) => c.items.length === 1).map((c) => c.items[0])
  const groups = clusters.filter((c) => c.items.length > 1)

  const scanning = thinking && screen === 'result' && !reduce // 예산안을 계산하는 동안 못 가는 마을을 훑는다
  const ring = useRafTime((screen === 'select' || scanning) && !reduce, undefined, { fps: 20 }) // 후보 테두리 깜빡임 · 계산 중 물결: 느린 반복이라 20fps면 충분
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
    getIcon: () => FACILITY[k].icon, getSize: FACILITY[k].size, sizeUnits: 'pixels',
    visible: showFacilities, pickable: true, parameters: ON_TOP,
  }))

  if (data && local && screen === 'diag') {
    const sel = state?.selectedVillage ?? null
    layers.push(
      timeLayer(),
      myeonLines,
      new GeoJsonLayer({ id: 'county-line', data: countyGeo ?? [], filled: false, getLineColor: [110, 110, 120, 200], lineWidthMinPixels: 1.2, parameters: ON_TOP }),
      ...facilityLayers(singles.flatMap((p) => (p.kind === 'facility' ? [p.f] : []))),
      // 낱개 시설 이름(가까이 봤을 때만): 아이콘 아래에 작게
      ...(zoom >= NAME_ZOOM ? [new TextLayer<RawFacility>({ id: 'facility-names', data: singles.flatMap((p) => (p.kind === 'facility' ? [p.f] : [])), getPosition: (f) => [f.lon, f.lat], getText: (f) => f.name,
        characterSet: 'auto', fontFamily: LABEL_FONT, getSize: 11, fontWeight: 600, getColor: [40, 40, 40, 255], getPixelOffset: [0, 8], getAlignmentBaseline: 'top',
        fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [255, 255, 255, 230], parameters: ON_TOP })] : []),
      // 묶음: 흰 원 + 진한 테두리 + 개수. 많을수록 조금 커진다. 누르면 그 묶음이 다 보이게 다가간다
      new ScatterplotLayer<Cluster<Pin>>({
        id: 'clusters', data: groups, pickable: true, autoHighlight: true, highlightColor: [47, 91, 211, 60], getPosition: (c) => [c.lon, c.lat], radiusUnits: 'pixels', getRadius: (c) => 14 + Math.min(8, Math.sqrt(c.items.length) * 2),
        getFillColor: [255, 255, 255, 250], stroked: true, getLineColor: [40, 40, 40, 220], lineWidthUnits: 'pixels', getLineWidth: 2, parameters: ON_TOP,
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
        // 못 가는 마을은 모두 X이고 색으로 이유(버스 없음 · 너무 멂)를 나눈다. 대중교통/자가용 중 무엇을 보는지는 useShownJudge가 정한다
        id: 'villages-x', data: badVillages, visible: showDots, pickable: true,
        getPosition: (v) => [v.lon, v.lat], getIcon: (v) => X_ICON[v.state as 1 | 2], sizeUnits: 'pixels',
        getSize: (v) => radius(v.people) * 2 * (v.id === sel || v.id === hoverVillage ? 1.25 : 1), updateTriggers: { getSize: [sel, hoverVillage] },
        parameters: ON_TOP,
        onClick: ({ object }: any) => object && patch((s) => ({ ...s, selectedVillage: object.id })),
        onHover: ({ object }: any) => { const id = object?.id ?? null; if (id !== useStore.getState().hoverVillage) set({ hoverVillage: id }) },
      }),
    )
  }

  if (data && local && screen === 'result') {
    layers.push(
      timeLayer(0.75), // 진단과 같은 바탕 격자(조금 옅게: 노선 · 구역이 위에서 잘 보이게)
      // 수요응답형 버스: 정해진 노선이 없어 운행 구역을 점선 테두리로 칠하고 이름표를 단다
      new GeoJsonLayer({ id: 'plan-drt', data: drtGeo ?? [], filled: true, stroked: true, lineWidthMinPixels: 3,
        getFillColor: [...hexRgb(SUPPLY.drt.color), Math.round((28 + 30 * (0.5 + 0.5 * Math.sin(T * 2.4))) * easeOut(T / 0.6) * dim('drt'))], getLineColor: [...hexRgb(SUPPLY.drt.color), Math.round(255 * easeOut(T / 0.6) * dim('drt'))],
        updateTriggers: { getFillColor: [Math.round(T * 20), hoverSupply], getLineColor: [Math.round(T * 20), hoverSupply] },
        getDashArray: [5, 3], dashJustified: true, extensions: [new PathStyleExtension({ dash: true })], beforeId: labelsBefore } as any),
      myeonLines,
      new ScatterplotLayer<JudgedVillage>({
        // 결과 지도는 노선 · 구역이 주인공이라, 원래 갈 수 있는 마을(초록 원)은 그리지 않고 이 안으로 새로 닿는 마을(파랑)과 여전히 못 가는 마을(빨강)만 작게 찍는다
        id: 'villages', data: badVillages, pickable: true, beforeId: labelsBefore, // 지명 · 도로명이 마을 점 위에 보이게
        getPosition: (v: JudgedVillage) => [v.lon, v.lat], getRadius: (v: JudgedVillage) => 4 + radius(v.people) * 0.35, radiusUnits: 'pixels',
        // 원래 갈 수 있는 마을은 초록, 안 때문에 새로 닿는 마을은 파랑, 아직 못 닿는 마을은 원래 색(빨강·보라). 일부만 닿으면 섞는다
        getFillColor: (v: JudgedVillage) => {
          if (v.state === 0) return [...STATE_RGB[0], 150]
          const c = cover?.get(v.id) ?? 0, a = STATE_RGB[v.state]
          return [a[0] + (NEW_RGB[0] - a[0]) * c, a[1] + (NEW_RGB[1] - a[1]) * c, a[2] + (NEW_RGB[2] - a[2]) * c, 190]
        },
        updateTriggers: { getFillColor: [cover, local] },
        stroked: true, getLineColor: [255, 255, 255, 230], lineWidthUnits: 'pixels', getLineWidth: 1,
        transitions: reduce ? {} : { getFillColor: 500 },
      } as any),
      new ScatterplotLayer({
        id: 'plan-marks', data: planMarks, pickable: true, getPosition: (d: any) => d.at, radiusUnits: 'pixels', getRadius: 13, filled: false, stroked: true,
        getLineColor: (d: any) => [...hexRgb(SUPPLY[d.type as keyof typeof SUPPLY].color), Math.round(255 * dim(d.type))], lineWidthUnits: 'pixels', getLineWidth: 3.5, parameters: ON_TOP, updateTriggers: { getLineColor: hoverSupply },
      }),
      // 순회 진료 버스 노선(버스 노선도처럼): 흰 테두리 + 굵은 노선 선이 보건소에서부터 그려지고 → 정류장이 차례로 뜨고 → 진행 방향 화살표와 이름표가 나타나고 → 버스가 노선을 돈다
      new TripsLayer({ id: 'route-casing', data: routes, getPath: (d: any) => d.path, getTimestamps: (d: any) => d.times, currentTime: draw * Math.max(1, ...routes.map((r) => r.length)), trailLength: 1e6, fadeTrail: false,
        getColor: [255, 255, 255, Math.round(255 * dim('tour'))], widthUnits: 'pixels', getWidth: 10, capRounded: true, jointRounded: true, parameters: ON_TOP, updateTriggers: { getColor: hoverSupply } } as any),
      new TripsLayer({ id: 'route-line', data: routes, getPath: (d: any) => d.path, getTimestamps: (d: any) => d.times, currentTime: draw * Math.max(1, ...routes.map((r) => r.length)), trailLength: 1e6, fadeTrail: false,
        getColor: [...hexRgb(SUPPLY.tour.color), Math.round(255 * dim('tour'))], widthUnits: 'pixels', getWidth: 5.5, capRounded: true, jointRounded: true, parameters: ON_TOP, updateTriggers: { getColor: hoverSupply } } as any),
      // 버스가 지나간 자리에 남는 빛 꼬리
      ...(T > 1.6 ? [new TripsLayer({ id: 'route-glow', data: routes, getPath: (d: any) => d.path, getTimestamps: (d: any) => d.times,
        currentTime: routes.length ? (((T - 1.6) % LOOP) / LOOP) * routes[0].length : 0, trailLength: routes.length ? routes[0].length * 0.18 : 0, fadeTrail: true,
        getColor: [255, 255, 255, Math.round(230 * dim('tour'))], widthUnits: 'pixels', getWidth: 3, capRounded: true, parameters: ON_TOP } as any)] : []),
      new TextLayer({ id: 'route-arrows', data: routeArrows, getPosition: (d: any) => d.at, getText: () => '▶', getAngle: (d: any) => d.angle, getSize: 16, characterSet: ['▶'], fontFamily: LABEL_FONT,
        getColor: [...hexRgb(SUPPLY.tour.color), Math.round(255 * clamp01((T - 1.3) / 0.4) * dim('tour'))], fontSettings: { sdf: true }, outlineWidth: 3, outlineColor: [255, 255, 255, Math.round(255 * clamp01((T - 1.3) / 0.4) * dim('tour'))],
        parameters: ON_TOP, updateTriggers: { getColor: [Math.round(T * 20), hoverSupply] } }),
      new ScatterplotLayer({ id: 'route-stops', data: routeStops, pickable: true, getPosition: (d: any) => d.at, radiusUnits: 'pixels', getRadius: (d: any) => 7 * pop(d.n - 1) * (1 + 0.35 * Math.max(0, 1 - Math.abs(T - 1.1 - (d.n - 1) * 0.12) * 4)),
        getFillColor: [255, 255, 255, Math.round(255 * dim('tour'))], stroked: true, getLineColor: [...hexRgb(SUPPLY.tour.color), Math.round(255 * dim('tour'))], lineWidthUnits: 'pixels', getLineWidth: 3, parameters: ON_TOP,
        updateTriggers: { getRadius: Math.round(T * 30), getFillColor: hoverSupply, getLineColor: hoverSupply } }),
      new TextLayer({ id: 'route-stop-no', data: routeStops, getPosition: (d: any) => d.at, getText: (d: any) => String(d.n), getSize: 10, fontWeight: 700,
        getColor: (d: any) => [60, 40, 0, Math.round(255 * pop(d.n - 1) * dim('tour'))], parameters: ON_TOP, updateTriggers: { getColor: [Math.round(T * 30), hoverSupply] } }),
      new ScatterplotLayer({ id: 'route-depot', data: routeDepots, getPosition: (d: any) => d.at, radiusUnits: 'pixels', getRadius: 10 * easeOut(T / 0.4), getFillColor: [...hexRgb(SUPPLY.tour.color), 255],
        stroked: true, getLineColor: [255, 255, 255, 255], lineWidthUnits: 'pixels', getLineWidth: 3, parameters: ON_TOP, updateTriggers: { getRadius: Math.round(T * 30) } }),
      // 노선을 도는 버스
      ...(T > 1.6 ? [new IconLayer({ id: 'route-bus', data: routes, getPosition: busAt, getIcon: () => ({ id: 'bus', url: BUS_ICON, width: 64, height: 64 }), getSize: 30, sizeUnits: 'pixels',
        getColor: [255, 255, 255, Math.round(255 * dim('tour'))], parameters: ON_TOP, updateTriggers: { getPosition: Math.round(T * 60) } })] : []),
      new TextLayer({ id: 'route-label', data: routeLabels, getPosition: (d: any) => d.at, getText: (d: any) => d.text,
        characterSet: 'auto', fontFamily: LABEL_FONT, getSize: 13, fontWeight: 700, getColor: [255, 255, 255, Math.round(255 * clamp01((T - 1.4) / 0.4) * dim('tour'))], background: true,
        getBackgroundColor: [...hexRgb(SUPPLY.tour.color), Math.round(255 * clamp01((T - 1.4) / 0.4) * dim('tour'))], backgroundPadding: [8, 5], getPixelOffset: [0, -24], parameters: ON_TOP,
        updateTriggers: { getColor: [Math.round(T * 20), hoverSupply], getBackgroundColor: [Math.round(T * 20), hoverSupply] } }),
      new TextLayer({ id: 'drt-label', data: drtLabels, getPosition: (d: any) => d.at, getText: (d: any) => d.text, characterSet: 'auto', fontFamily: LABEL_FONT, getSize: 13, fontWeight: 700,
        getColor: [255, 255, 255, Math.round(255 * clamp01((T - 0.6) / 0.4) * dim('drt'))], background: true, getBackgroundColor: [...hexRgb(SUPPLY.drt.color), Math.round(255 * clamp01((T - 0.6) / 0.4) * dim('drt'))],
        backgroundPadding: [8, 5], parameters: ON_TOP, updateTriggers: { getColor: [Math.round(T * 20), hoverSupply], getBackgroundColor: [Math.round(T * 20), hoverSupply] } }),
      // 이 안으로 새로 닿는 마을: 안을 고르면 물결이 한 번 퍼진다
      ...(T > 1 && T < 2.6 ? [new ScatterplotLayer<JudgedVillage>({ id: 'new-ripple', data: newVillages, getPosition: (v) => [v.lon, v.lat],
        radiusUnits: 'pixels', getRadius: (v) => 4 + radius(v.people) * 0.35 + 22 * easeOut((T - 1) / 1.6), filled: false, stroked: true, lineWidthUnits: 'pixels', getLineWidth: 2.5,
        getLineColor: [...NEW_RGB, Math.round(230 * (1 - clamp01((T - 1) / 1.6)))], parameters: ON_TOP, updateTriggers: { getRadius: Math.round(T * 30), getLineColor: Math.round(T * 30) } })] : []),
      ...(scanning ? [new ScatterplotLayer<JudgedVillage>({
        id: 'scan', data: badVillages, getPosition: (v) => [v.lon, v.lat], radiusUnits: 'pixels', stroked: true, filled: false, lineWidthUnits: 'pixels', getLineWidth: 2, parameters: ON_TOP,
        // 마을마다 시작 시점을 어긋나게 해서, 파동이 하나씩 번져 나가는 것처럼 보인다
        getRadius: (_v: JudgedVillage, { index }: { index: number }) => 6 + 34 * ((ring / 1400 + index * 0.37) % 1),
        getLineColor: (_v: JudgedVillage, { index }: { index: number }) => [214, 69, 93, Math.round(220 * (1 - ((ring / 1400 + index * 0.37) % 1)))],
        updateTriggers: { getRadius: ring, getLineColor: ring },
      })] : []),
    )
  }

  const getTooltip = ({ object, layer }: any) => {
    if (!object) return null
    if (layer?.id.startsWith('facilities')) return { text: `${object.name}\n${object.kind}${object.doctors ? ` · 의사 ${object.doctors}명` : ''}` }
    if (layer?.id === 'time') return { text: `${data?.villages[object.village]?.name ?? ''}\n${CAR_TARGETS.find((x) => x.id === carTarget)!.short}까지 약 ${Math.round(object.minutes)}분 · ${!object.lived ? '사람이 안 사는 곳' : Math.round(object.people) === 0 ? '이 나이대 주민 0명' : `${Math.round(object.people)}명`} (마을 값을 이어 칠함)` }
    if (layer?.id === 'clusters') return { text: `${object.items.length}곳 · 누르면 펼쳐져요\n${clusterText(object)}` }
    if (layer?.id === 'plan-marks') return { text: object.label }
    if (layer?.id.startsWith('villages')) {
      const c = screen === 'result' ? cover?.get(object.id) : undefined
      return { text: `${object.name}\n${Math.round(object.people)}명 · ${STATE_NAME[object.state as 0]}${c != null && object.state !== 0 ? `\n이 안으로 ${Math.round(c * 100)}% 닿음` : ''}` }
    }
    return null
  }
  // 확대 · 축소 버튼은 화면 가운데가 아니라 왼쪽 패널에 가리지 않은 지도 부분의 가운데를 기준으로 한다(가운데가 패널 뒤 바다면 엉뚱한 곳이 커진다)
  const zoomBy = (d: number) => {
    const m = mapRef.current?.getMap()
    if (!m) return
    const { clientWidth: W, clientHeight: H } = m.getContainer()
    const left = W >= 720 && screen !== 'off' ? 446 : 0
    m.easeTo({ zoom: m.getZoom() + d, around: m.unproject([(left + W) / 2, H / 2]), duration: 300 })
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
      {/* 확대 · 축소: 지도 오른쪽 위(결과 화면은 범례 왼쪽). 군 화면에서는 '군 전체' 버튼으로 언제든 돌아온다. 너무 줄이면 마을이 안 보인다고 알려 준다 */}
      {screen !== 'off' && (
        <div className={`zoom-ctrl ${screen === 'result' ? 'beside-legend' : ''}`} role="group" aria-label="지도 확대 축소">
          <button type="button" aria-label="확대" onClick={() => zoomBy(1)} disabled={zoom >= 18}>+</button>
          <button type="button" aria-label="축소" onClick={() => zoomBy(-1)} disabled={zoom <= 5}>−</button>
          {data && screen !== 'select' && <button type="button" className="zoom-home" onClick={() => fitCounty(mapRef.current, boxOf(data.villages), { duration: 800 })}>{data.name} 전체</button>}
          {screen === 'select' && <button type="button" className="zoom-home" onClick={() => mapRef.current?.flyTo({ center: [KOREA_VIEW.longitude, KOREA_VIEW.latitude], zoom: KOREA_VIEW.zoom, duration: 800 })}>전국</button>}
        </div>
      )}
      {data && (screen === 'diag' || screen === 'result') && zoom < 8.5 && (
        <button type="button" className="zoom-hint" onClick={() => fitCounty(mapRef.current, boxOf(data.villages), { duration: 800 })}>지도를 확대하면 마을이 보여요 · {data.name}으로 가기</button>
      )}
      <Map
        ref={mapRef}
        initialViewState={KOREA_VIEW}
        maxBounds={KOREA_BOUNDS}
        minZoom={5}
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
          // 도로 이름은 숨긴다(지명은 그대로 둔다)
          symbols.forEach((l) => { if ((l as any)['source-layer'] === 'transportation_name') map.setLayoutProperty(l.id, 'visibility', 'none') })
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
