// /test — public/data/mapdata.json(창녕군 예시)이 지도에 어떻게 보이는지 확인하는 화면. 다른 화면과 분리된 독립 페이지다.
// 마을 = 원(크기 ∝ √인원, 색 = 상태), 의료시설 = 흰 원 + 종류별 테두리, 공백 상위 10곳은 왼쪽 목록과 지도 이름표로 연결된다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Map, useControl, type MapRef } from 'react-map-gl/maplibre'
import { MapLibreOverlay } from '@deck.gl/maplibre'
import { GeoJsonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers'
import 'maplibre-gl/dist/maplibre-gl.css'
import { cameraFor, loadSigungu } from '../map/geo'
import { loadMyeon } from '../map/grid'
import { fmt, pct } from '../motion/useCountUp'
import { AiBadge } from '../ui/Badges'

interface MapData {
  service: string
  age: string
  town: string
  summary: { total: number; gap: number; rate: number; noBus: number; noFacility: number; villagesNoBus: number; villagesNoFacility: number; gapVillages: number }
  busReasons: unknown
  top: { id: string; name: string; people: number; state: number; stateText: string; reason: string }[]
  villages: { id: string; name: string; myeon: string; lon: number; lat: number; people: number; state: number; popEstimated: boolean }[]
  facilities: { id: string; name: string; kind: string; village: string }[]
  estimatedVillages: number
}

const AGE: Record<string, string> = { all: '전체', a65: '65세 이상', a80: '80세 이상' }
const SERVICE: Record<string, string> = { med: '의료', pha: '약국', gro: '식료품' }
const STATE_COLOR: Record<number, [number, number, number]> = { 0: [47, 158, 98], 1: [215, 48, 39] } // 0 닿음, 1 공백
const KIND_COLOR: Record<string, [number, number, number]> = { 병원: [214, 69, 93], 보건지소: [47, 111, 214], 보건진료소: [20, 149, 143] }
const ON_TOP = { depthCompare: 'always', depthWriteEnabled: false } as const
const css = (c: number[]) => `rgb(${c.join(',')})`

function Overlay({ layers, getTooltip }: { layers: any[]; getTooltip: (i: any) => any }) {
  const ov = useControl<MapLibreOverlay>(() => new MapLibreOverlay({ interleaved: true }))
  ov.setProps({ layers, getTooltip })
  return null
}

export function TestMap() {
  const mapRef = useRef<MapRef>(null)
  const [d, setD] = useState<MapData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [county, setCounty] = useState<any>(null)
  const [myeon, setMyeon] = useState<any>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)

  useEffect(() => {
    fetch('/data/mapdata.json').then((r) => r.json()).then(setD).catch((e) => setErr(String(e)))
    loadSigungu().then((g) => setCounty({ ...g, features: g.features.filter((f: any) => f.properties.sgg === '48740') }))
    loadMyeon().then((g) => setMyeon({ ...g, features: g.features.filter((f: any) => f.properties.sgg === '48740') }))
  }, [])

  const byId = useMemo(() => new globalThis.Map(d?.villages.map((v) => [v.id, v]) ?? []), [d])
  const topById = useMemo(() => new globalThis.Map(d?.top.map((t) => [t.id, t]) ?? []), [d])
  const facs = useMemo(() => d?.facilities.map((f) => ({ ...f, v: byId.get(f.village) })).filter((f) => f.v) ?? [], [d, byId])
  const maxP = useMemo(() => Math.max(1, ...(d?.villages.map((v) => v.people) ?? [1])), [d])

  // 마을 범위가 왼쪽 패널 오른쪽 빈 곳에 꽉 차게
  const fit = () => {
    const map = mapRef.current?.getMap()
    if (!map || !d) return
    const lons = d.villages.map((v) => v.lon), lats = d.villages.map((v) => v.lat)
    const { clientWidth: W, clientHeight: H } = map.getContainer()
    const pad = W >= 720 ? { top: 60, bottom: 60, left: 460, right: 60 } : { top: 30, bottom: Math.round(H * 0.55), left: 20, right: 20 }
    map.flyTo({ ...cameraFor([Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)], W, H, pad, 13), duration: 1200 })
  }
  useEffect(fit, [d])

  const flyTo = (id: string) => {
    const v = byId.get(id)
    if (v) mapRef.current?.flyTo({ center: [v.lon, v.lat], zoom: 13, duration: 1000, padding: { left: 440, top: 0, right: 0, bottom: 0 } })
  }

  const layers = d ? [
    new GeoJsonLayer({ id: 'county', data: county ?? [], filled: true, getFillColor: [47, 91, 211, 14], getLineColor: [47, 91, 211, 200], lineWidthMinPixels: 2 }),
    new GeoJsonLayer({ id: 'myeon', data: myeon ?? [], filled: false, getLineColor: [60, 60, 70, 110], lineWidthMinPixels: 1 }),
    new ScatterplotLayer({
      id: 'villages',
      data: d.villages,
      getPosition: (v: any) => [v.lon, v.lat],
      getRadius: (v: any) => 5 + 22 * Math.sqrt(v.people / maxP),
      radiusUnits: 'pixels',
      getFillColor: (v: any) => [...STATE_COLOR[v.state] ?? [120, 120, 120], v.id === hover ? 255 : 170],
      stroked: true,
      getLineColor: (v: any) => (v.id === hover ? [0, 0, 0, 255] : v.popEstimated ? [155, 63, 232, 255] : [255, 255, 255, 230]),
      getLineWidth: (v: any) => (v.id === hover || v.popEstimated ? 3 : 1.5),
      lineWidthUnits: 'pixels',
      pickable: true,
      autoHighlight: true,
      highlightColor: [0, 0, 0, 60],
      updateTriggers: { getFillColor: hover, getLineColor: hover, getLineWidth: hover },
      onHover: ({ object }: any) => setHover(object?.id ?? null),
      onClick: ({ object }: any) => object && flyTo(object.id),
      parameters: ON_TOP,
    }),
    new ScatterplotLayer({
      id: 'facilities',
      data: facs,
      getPosition: (f: any) => [f.v.lon, f.v.lat],
      getRadius: (f: any) => (f.kind === '병원' ? 9 : 6),
      radiusUnits: 'pixels',
      getFillColor: [255, 255, 255],
      getLineColor: (f: any) => KIND_COLOR[f.kind] ?? [28, 28, 26],
      stroked: true,
      lineWidthUnits: 'pixels',
      getLineWidth: (f: any) => (f.kind === '병원' ? 4 : 3),
      pickable: true,
      parameters: ON_TOP,
    }),
    // 공백 상위 10곳과 읍 소재지는 이름을 단다
    new TextLayer({
      id: 'labels',
      data: d.villages.filter((v) => topById.has(v.id) || v.id === d.town || v.id === hover),
      getPosition: (v: any) => [v.lon, v.lat],
      getText: (v: any) => (v.id === d.town ? `${v.name} (읍)` : v.name),
      characterSet: 'auto',
      fontFamily: 'Pretendard Variable, Pretendard, sans-serif',
      fontWeight: 600,
      getSize: 12,
      getColor: [28, 28, 26],
      getPixelOffset: (v: any) => [0, -(10 + 22 * Math.sqrt(v.people / maxP))],
      background: true,
      getBackgroundColor: (v: any) => (v.state === 1 ? [253, 238, 238, 240] : [255, 255, 255, 235]),
      backgroundPadding: [5, 2],
      updateTriggers: { getText: hover },
      parameters: ON_TOP,
    }),
  ] : []

  const getTooltip = ({ object, layer }: any) => {
    if (!object) return null
    if (layer?.id === 'facilities') return { text: `${object.name}\n${object.kind} · ${object.v.name}` }
    if (layer?.id === 'villages') {
      const t = topById.get(object.id)
      const here = facs.filter((f) => f.village === object.id).map((f) => f.name)
      return { text: `${object.name} (${object.myeon})\n${AGE[d!.age] ?? d!.age} ${fmt(object.people)}명${object.popEstimated ? ' · AI 추정' : ''}\n${object.state === 1 ? `공백${t ? ` — ${t.reason}` : ''}` : '기준 안에 닿음'}${here.length ? `\n시설: ${here.join(', ')}` : ''}` }
    }
    return null
  }

  const s = d?.summary
  return (
    <div className="app with-map">
      <div className="map-layer" style={{ top: 0 }}>
        <Map ref={mapRef} initialViewState={{ longitude: 128.5, latitude: 35.52, zoom: 9.6 }} mapStyle="https://tiles.openfreemap.org/styles/positron" style={{ position: 'absolute', inset: 0 }} attributionControl={{ compact: true }} onLoad={(e) => {
          // 지명은 한글을 먼저 쓴다 (공용 지도와 같게)
          const map = e.target
          map.getStyle().layers.filter((l) => l.type === 'symbol').forEach((l) => { if (map.getLayoutProperty(l.id, 'text-field')) map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]) })
          fit()
        }}>
          <Overlay layers={layers} getTooltip={getTooltip} />
        </Map>
      </div>

      <aside className="panel test-panel">
        <p className="eyebrow">/test · 데이터 미리보기</p>
        <h1>mapdata.json · 창녕군</h1>
        {err && <p className="toast-inline">불러오지 못했어요: {err}</p>}
        {!d && !err && <p className="muted">불러오는 중…</p>}
        {d && s && (
          <>
            <div className="row" style={{ marginBottom: 6 }}>
              <span className="badge">서비스 {SERVICE[d.service] ?? d.service}</span>
              <span className="badge">{AGE[d.age] ?? d.age}</span>
              <span className="badge">읍 소재지 {byId.get(d.town)?.name ?? d.town}</span>
            </div>
            <div className="hero">
              <p className="muted small" style={{ margin: 0 }}>{SERVICE[d.service] ?? d.service}에 닿지 못하는 {AGE[d.age] ?? d.age}</p>
              <p className="big bad" style={{ margin: '2px 0' }}>{fmt(s.gap)}<small>명</small></p>
              <p className="muted small" style={{ margin: 0 }}>전체 {fmt(s.total)}명의 {pct(s.rate)} · 공백 마을 {s.gapVillages}곳</p>
            </div>
            <dl className="stats">
              <div><dt>버스 없어서 공백</dt><dd>{fmt(s.noBus)}명 · {s.villagesNoBus}곳</dd></div>
              <div><dt>시설 없어서 공백</dt><dd>{fmt(s.noFacility)}명 · {s.villagesNoFacility}곳</dd></div>
              <div><dt>마을 / 시설</dt><dd>{d.villages.length}곳 / {d.facilities.length}곳</dd></div>
              <div><dt>인구 추정 마을</dt><dd>{d.estimatedVillages}곳 <AiBadge>추정</AiBadge></dd></div>
            </dl>
            <p className="muted small">busReasons: {d.busReasons == null ? '없음(null)' : JSON.stringify(d.busReasons)}</p>

            <h3 style={{ marginTop: 18 }}>공백이 큰 마을 (top {d.top.length})</h3>
            <ol className="villages test-top">
              {d.top.map((t) => (
                <li key={t.id} className={hover === t.id ? 'on' : ''} onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)} onClick={() => flyTo(t.id)}>
                  <span>
                    <b>{t.name}</b> <span className="badge red">{t.stateText}</span>
                    <br /><span className="muted small">{t.reason}</span>
                  </span>
                  <span className="muted num">{fmt(t.people)}명</span>
                </li>
              ))}
            </ol>

            <h3 style={{ marginTop: 18 }}>범례</h3>
            <div className="test-legend">
              <p><i style={{ background: css(STATE_COLOR[1]) }} /> 공백 마을 (state 1)</p>
              <p><i style={{ background: css(STATE_COLOR[0]) }} /> 닿는 마을 (state 0)</p>
              <p><i style={{ background: '#fff', boxShadow: 'inset 0 0 0 3px #9b3fe8' }} /> 인구 AI 추정 (popEstimated)</p>
              <p className="muted small">원 크기 ∝ √인원</p>
              {Object.entries(KIND_COLOR).map(([k, c]) => <p key={k}><i style={{ background: '#fff', boxShadow: `inset 0 0 0 3px ${css(c)}` }} /> {k}</p>)}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="ghost" onClick={fit}>전체 보기</button>
              <button className="ghost" onClick={() => setShowRaw(!showRaw)}>{showRaw ? '원본 JSON 닫기' : '원본 JSON 보기'}</button>
            </div>
            {showRaw && <pre className="raw-json">{JSON.stringify(d, null, 2)}</pre>}
          </>
        )}
      </aside>
    </div>
  )
}
