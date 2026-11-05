// 서버 전체 장애 때 쓰는 정적 스냅샷(public/data/snapshot). 지금은 이용 조건을 확인하지 못해 저장소와 배포에 넣지 않았다: 폴더가 없으면 null을 돌려주고 화면은 오류 안내를 보여 준다.
// 팀이 확인한 뒤 scripts/make-snapshot.mjs로 만든 파일을 이 폴더에 넣으면 저장한 지역만 쓸 수 있다
import type { RegionData, RegionItem, State } from './types'

export interface SnapshotManifest {
  capturedAt: string // 수집일(YYYY-MM-DD)
  origin: string // 수집한 서버 주소
  totalRegions: number // 서버 전체 지역 수. 저장한 지역 수와 비교해 안내한다
  regions: RegionItem[]
  defaultState: State
}
export interface SnapshotRegion { data: RegionData; map: GeoJSON.FeatureCollection | null }

const BASE = '/data/snapshot'
async function read<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/${path}`)
    if (!res.ok) return null
    return (await res.json()) as T // 파일이 없을 때 앱 첫 화면(HTML)이 돌아와도 여기서 실패해 null이 된다
  } catch { return null }
}

let manifest: Promise<SnapshotManifest | null> | null = null
export function loadSnapshotManifest() {
  manifest ??= read<SnapshotManifest>('manifest.json').then((m) => (m && Array.isArray(m.regions) && m.regions.length && m.defaultState ? m : null))
  return manifest
}
export const snapshotRegion = async (code: string): Promise<SnapshotRegion | null> => {
  const m = await loadSnapshotManifest()
  if (!m?.regions.some((r) => r.code === code)) return null // 저장하지 않은 지역은 없는 자료다. 비슷한 값을 만들어 채우지 않는다
  const s = await read<SnapshotRegion>(`${code}.json`)
  return s?.data && Array.isArray(s.data.villages) && s.data.villages.length ? s : null
}
export const resetSnapshotCache = () => { manifest = null }
