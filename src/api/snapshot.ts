// 서버 전체 장애 때 쓰는 정적 스냅샷(/data/snapshot). 지역별로 나눠, 처음에는 목록(manifest)만 받고 지역 파일은 고를 때 하나씩 받는다.
// 공개 형식(schema 3)은 공공데이터 파일과 OSM 파생 파일(ODbL)이 따로 있어 둘 다 받아 합친다. 하나라도 없거나 틀리면 그 지역을 쓰지 않는다.
// 파일이 없거나 깨졌으면 null을 돌려준다: 값을 채워 넣지 않고 화면이 오류를 보여 준다. 만드는 법과 공개 조건은 docs/offline-snapshot.md
import { validRegionData, validRegionList, validMap } from './fallback'
import { mergeRegion, type BaseIndicators, type BaseRegion, type OsmIndicators, type OsmRegion } from './snapshotSplit'
import type { Indicators, RegionData, RegionItem, State, Tier } from './types'

export interface SnapshotPart { path: string; bytes: number; gzipBytes?: number; sha256: string }
export interface SnapshotFile extends SnapshotPart { villages: number; facilities?: number; myeons?: number; boundaries?: number; status: 'ok'; indicators?: Indicators | BaseIndicators; osm?: SnapshotPart }
// 정적 자료에 없는 지역: 서버가 정상일 때만 볼 수 있다
export interface UnsupportedRegion { code: string; name: string; sido: string }
export interface SnapshotManifest {
  schema?: number
  dataVersion?: string
  capturedAt: string // 수집일(YYYY-MM-DD). 원본 통계의 기준 시점이 아니다
  origin: string // 수집한 서버 주소
  complete?: boolean // 서버의 전 지역을 담았는지
  totalRegions: number // 서버 전체 지역 수. 담긴 지역 수와 비교해 안내한다
  totalVillages?: number
  tiers?: Record<Tier, number>
  regions: RegionItem[]
  unsupported?: UnsupportedRegion[]
  defaultState: State
  files?: Record<string, SnapshotFile> // 지역 코드 → 파일 정보(크기 · 무결성 값 · 카드에 쓸 지표)
  osmIndex?: SnapshotPart // 지역 중심 좌표와 군 지표의 OSM 파생 칸(ODbL)
  sources?: (SnapshotNote & { regions: number })[]
}
// 원자료 출처: 서버 레포트 각주의 주소와 기준 시점 그대로. date가 원본 자료의 시점이고 capturedAt(수집일)과 다르다
export interface SnapshotNote { org?: string; title: string; url?: string; date?: string | null; license?: string }
export interface SnapshotRegion { data: RegionData; map: GeoJSON.FeatureCollection | null; notes?: SnapshotNote[] }
export interface OsmIndex { regions: Record<string, { center: [number, number]; indicators: OsmIndicators }> }
interface BaseFile { data: BaseRegion; map: GeoJSON.FeatureCollection | null; notes?: SnapshotNote[] }

const BASE = '/data/snapshot'
const TIMEOUT_MS = 15_000 // 정적 호스팅까지 멈추면 끝없이 기다리지 않는다

// 파일이 없는 주소에 앱 첫 화면(HTML)이 200으로 돌아와도 JSON으로 읽히지 않아 null이 된다
async function readBytes(path: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok || /text\/html/i.test(res.headers.get('content-type') ?? '')) return null
    return await res.arrayBuffer()
  } catch { return null }
}
const parse = <T,>(buf: ArrayBuffer): T | null => {
  try { return JSON.parse(new TextDecoder().decode(buf)) as T } catch { return null }
}
// 받은 파일이 manifest에 적힌 그 파일인지 본다. 보안 컨텍스트가 아니라 crypto.subtle이 없으면 형식 검사만 한다
async function sameHash(buf: ArrayBuffer, want?: string) {
  if (!want || !globalThis.crypto?.subtle) return true
  const got = new Uint8Array(await crypto.subtle.digest('SHA-256', buf))
  return [...got].map((b) => b.toString(16).padStart(2, '0')).join('') === want
}

function validManifest(m: SnapshotManifest | null): m is SnapshotManifest {
  if (!m || !validRegionList(m) || !m.capturedAt) return false
  if (new Set(m.regions.map((r) => r.code)).size !== m.regions.length) return false
  // 지금 형식(schema 2)은 모든 지역의 파일 정보가 있어야 한다
  if (m.schema != null && m.schema >= 2 && !m.regions.every((r) => { const f = m.files?.[r.code]; return f && f.status === 'ok' && f.villages === r.villages })) return false
  return true
}

// 파일 하나를 받아 manifest의 무결성 값과 맞는지 보고 읽는다
async function readPart<T>(part: SnapshotPart): Promise<T | null> {
  const buf = await readBytes(part.path)
  if (!buf || !(await sameHash(buf, part.sha256))) return null
  return parse<T>(buf)
}
// 공개 형식: 목록의 중심 좌표와 카드 지표는 OSM 파생값이라 별도 파일에 있다. 합치지 못하면 목록 전체를 쓰지 않는다
async function withOsmIndex(m: SnapshotManifest): Promise<SnapshotManifest | null> {
  if (!m.osmIndex) return m
  const index = await readPart<OsmIndex>(m.osmIndex)
  if (!index?.regions || !m.regions.every((r) => index.regions[r.code]?.center && index.regions[r.code]?.indicators && m.files?.[r.code])) return null
  return {
    ...m,
    regions: m.regions.map((r) => ({ ...r, center: index.regions[r.code].center })),
    files: Object.fromEntries(m.regions.map((r) => {
      const f = m.files![r.code]
      return [r.code, { ...f, indicators: { ...f.indicators, ...index.regions[r.code].indicators } as Indicators }]
    })),
  }
}

// 받아서 틀린 결과는 기억하지 않는다(파일 배포가 끝나면 다시 시도할 수 있게). 맞는 결과는 기억해 같은 파일을 다시 받지 않는다
let manifest: Promise<SnapshotManifest | null> | null = null
const regions = new Map<string, Promise<SnapshotRegion | null>>()
export function loadSnapshotManifest(): Promise<SnapshotManifest | null> {
  if (manifest) return manifest
  const p = readBytes('manifest.json').then(async (b) => {
    const m = b && parse<SnapshotManifest>(b)
    if (!validManifest(m ?? null)) return null
    return withOsmIndex(m!)
  })
  manifest = p
  p.then((m) => { if (!m && manifest === p) manifest = null })
  return p
}

// 지역 하나의 파일을 검사한다: 코드 · 이름 · 마을 수가 manifest와 맞는지, 칸이 비지 않았는지. 다른 지역 파일이 잘못 와도 여기서 걸린다
export function validSnapshotRegion(item: RegionItem, s: SnapshotRegion | null): s is SnapshotRegion {
  return !!s && !!s.data && s.data.code === item.code && s.data.name === item.name && s.data.tier === item.tier
    && validRegionData(s.data) && s.data.villages.length === item.villages && (s.map == null || validMap(s.map))
}

export function snapshotRegion(code: string): Promise<SnapshotRegion | null> {
  const hit = regions.get(code)
  if (hit) return hit
  const p = (async () => {
    const m = await loadSnapshotManifest()
    const item = m?.regions.find((r) => r.code === code)
    if (!m || !item) return null // 담지 않은 지역은 없는 자료다. 비슷한 값을 만들어 채우지 않는다
    const file = m.files?.[code]
    if (file?.osm) {
      const [base, osm] = await Promise.all([readPart<BaseFile>(file), readPart<OsmRegion>(file.osm)])
      if (!base?.data || !osm) return null
      const data = mergeRegion(base.data, osm)
      const s = data && { data, map: base.map, notes: base.notes }
      return validSnapshotRegion(item, s) ? s : null
    }
    const buf = await readBytes(file?.path ?? `${code}.json`)
    if (!buf || !(await sameHash(buf, file?.sha256))) return null
    const s = parse<SnapshotRegion>(buf)
    return validSnapshotRegion(item, s) ? s : null
  })()
  regions.set(code, p)
  p.then((s) => { if (!s && regions.get(code) === p) regions.delete(code) })
  return p
}

// 지역 카드에 쓸 군 지표. 지표가 manifest에 있으면 지역 파일을 받지 않는다(카드 72개가 파일 72개를 받지 않게)
export async function snapshotIndicators(code: string): Promise<Pick<RegionData, 'indicators'> | null> {
  const m = await loadSnapshotManifest()
  const inManifest = m?.files?.[code]?.indicators
  if (inManifest) return { indicators: inManifest as Indicators }
  const s = await snapshotRegion(code)
  return s ? { indicators: s.data.indicators } : null
}

// 정적 자료에 없어 서버 장애 때 지원하지 않는 지역인지
export async function snapshotUnsupported(code: string): Promise<UnsupportedRegion | null> {
  const m = await loadSnapshotManifest()
  return m?.unsupported?.find((r) => r.code === code) ?? null
}

export const resetSnapshotCache = () => { manifest = null; regions.clear() }
