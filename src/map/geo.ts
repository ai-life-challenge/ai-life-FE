export const KOREA_VIEW = { longitude: 127.9, latitude: 35.95, zoom: 6.2, pitch: 0, bearing: 0 }

let sigunguCache: Promise<any> | null = null
export const loadSigungu = () => (sigunguCache ??= fetch('/data/sigungu.geojson').then((r) => r.json()))

type CamMap = { flyTo: (o: object) => unknown; getContainer: () => HTMLElement }
type Box = [number, number, number, number] // [west, south, east, north]
type Pad = { top: number; bottom: number; left: number; right: number }

// 왼쪽 패널(폭 400 + 여백 12) 오른쪽 빈 곳. 좁은 화면(모바일)은 아래 패널 위쪽
export const panelPadding = (W: number, H: number): Pad =>
  W >= 720 ? { top: 40, bottom: 40, left: 440, right: 40 } : { top: 16, bottom: Math.round(H * 0.55), left: 16, right: 16 }

// 범위가 빈 곳에 꼭 맞는 가운데·배율을 웹 메르카토르로 직접 계산한다.
// maplibre-gl 6의 cameraForBounds/fitBounds는 기기 픽셀 비율(2배 화면)에서 배율을 한 단계 낮게 잡고,
// 여백이 화면 절반을 넘으면 아예 계산을 포기해서 쓰지 않는다.
const mx = (lon: number) => (lon + 180) / 360
const my = (lat: number) => { const r = (lat * Math.PI) / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 }
const lonOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
export function cameraFor(box: Box, W: number, H: number, pad: Pad, maxZoom = 13.5) {
  const x0 = mx(box[0]), x1 = mx(box[2]), y0 = my(box[3]), y1 = my(box[1])
  const availW = Math.max(50, W - pad.left - pad.right), availH = Math.max(50, H - pad.top - pad.bottom)
  const zoom = Math.min(maxZoom, Math.log2(Math.min(availW / ((x1 - x0) * 512), availH / ((y1 - y0) * 512))))
  const world = 512 * 2 ** zoom
  // 범위의 가운데가 빈 곳의 가운데에 오도록 지도 중심을 옮긴다
  const cx = (x0 + x1) / 2 - (pad.left - pad.right) / 2 / world
  const cy = (y0 + y1) / 2 - (pad.top - pad.bottom) / 2 / world
  return { center: [lonOf(cx), latOf(cy)] as [number, number], zoom }
}

function flyToBox(map: CamMap | undefined | null, box: Box, duration: number, extra: Partial<Pad> = {}) {
  if (!map) return
  const { clientWidth: W, clientHeight: H } = map.getContainer()
  const base = panelPadding(W, H)
  const pad = W >= 720 ? { ...base, ...extra } : base
  // 기울이면 먼 쪽이 작아져 잘리므로, 범위를 맞출 때는 똑바로 내려다본다
  map.flyTo({ ...cameraFor(box, W, H, pad), pitch: 0, bearing: 0, duration, essential: true })
}

// 군 전체가 빈 곳에 꽉 차게
export function fitCounty(map: CamMap | undefined | null, bbox: Box, opts: { pitch?: number; duration?: number } = {}) {
  flyToBox(map, bbox, opts.duration ?? 1600)
}

// 고른 안이 그리는 범위가 빠짐없이 다 보이는 만큼만 다가간다
// bottom: 지도 아래쪽 범례 높이만큼 비워 둘 때
export function flyToArea(map: CamMap | undefined | null, area: Box, opts: { duration?: number; bottom?: number } = {}) {
  flyToBox(map, area, opts.duration ?? 1200, opts.bottom ? { bottom: opts.bottom } : {})
}
