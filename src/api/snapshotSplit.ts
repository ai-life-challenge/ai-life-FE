// 공개 스냅샷의 지역 자료를 공공데이터 파일(base)과 OSM 파생 파일(osm, ODbL)로 나누고 다시 합친다.
// 합친 결과는 나누기 전과 칸 순서까지 같아야 한다(서버 응답과 비교하는 복구 로직이 그대로 동작한다). 공개 범위와 이유는 docs/data-licenses.md
import type { Indicators, RawFacility, RawVillage, RegionData } from './types'

// OSM에 조금이라도 의존하는 값은 모두 osm 파일에 둔다. 비OSM 값이 ODbL 파일에 들어가는 것은 괜찮지만, 그 반대는 공유 의무를 어긴다
export type BaseVillage = Pick<RawVillage, 'id' | 'name' | 'myeon' | 'pop' | 'a80In10y'>
export type OsmVillage = Pick<RawVillage, 'id' | 'lon' | 'lat' | 'seniorCenter' | 'bus' | 'nearest'>
export type BaseFacility = Omit<RawFacility, 'village'>
export type BaseIndicators = Pick<Indicators, 'pop' | 'elderly'>
export type OsmIndicators = Omit<Indicators, 'pop' | 'elderly'>

export interface BaseRegion extends Omit<RegionData, 'depot' | 'villages' | 'facilities' | 'indicators'> {
  villages: BaseVillage[]
  facilities: BaseFacility[]
  indicators: BaseIndicators
}
export interface OsmRegion {
  code: string
  depot: string
  facilityVillages: Record<string, string | null> // 시설 id → 시설이 속한 마을. 마을 대표점으로 정한 값이다
  indicators: OsmIndicators
  villages: OsmVillage[]
}

export function splitRegion(d: RegionData): { base: BaseRegion; osm: OsmRegion } {
  const { pop, elderly, ...osmIndicators } = d.indicators
  return {
    base: {
      code: d.code, name: d.name, sido: d.sido, tier: d.tier, shrinkingArea: d.shrinkingArea, erVulnerable: d.erVulnerable, town: d.town,
      sources: d.sources, myeons: d.myeons,
      villages: d.villages.map(({ id, name, myeon, pop: p, a80In10y }) => ({ id, name, myeon, pop: p, a80In10y })),
      facilities: d.facilities.map(({ id, name, kind, lon, lat, doctors }) => ({ id, name, kind, lon, lat, doctors })),
      indicators: { pop, elderly },
    },
    osm: {
      code: d.code, depot: d.depot,
      facilityVillages: Object.fromEntries(d.facilities.map((f) => [f.id, f.village])),
      indicators: osmIndicators,
      villages: d.villages.map(({ id, lon, lat, seniorCenter, bus, nearest }) => ({ id, lon, lat, seniorCenter, bus, nearest })),
    },
  }
}

// 짝이 맞지 않으면(다른 지역 파일, 빠진 마을 · 시설) null. 값을 채워 넣지 않는다
export function mergeRegion(b: BaseRegion, o: OsmRegion): RegionData | null {
  if (!b || !o || b.code !== o.code || !Array.isArray(b.villages) || !Array.isArray(o.villages) || b.villages.length !== o.villages.length) return null
  if (!o.facilityVillages || !b.indicators || !o.indicators || !Array.isArray(b.facilities)) return null
  const byId = new Map(o.villages.map((v) => [v.id, v]))
  const villages: RawVillage[] = []
  for (const v of b.villages) {
    const x = byId.get(v.id)
    if (!x) return null
    villages.push({ id: v.id, name: v.name, myeon: v.myeon, lon: x.lon, lat: x.lat, pop: v.pop, a80In10y: v.a80In10y, seniorCenter: x.seniorCenter, bus: x.bus, nearest: x.nearest })
  }
  const facilities: RawFacility[] = []
  for (const f of b.facilities) {
    if (!(f.id in o.facilityVillages)) return null
    facilities.push({ id: f.id, name: f.name, kind: f.kind, village: o.facilityVillages[f.id], lon: f.lon, lat: f.lat, doctors: f.doctors })
  }
  return {
    code: b.code, name: b.name, sido: b.sido, tier: b.tier, shrinkingArea: b.shrinkingArea, erVulnerable: b.erVulnerable, town: b.town, depot: o.depot,
    sources: b.sources, myeons: b.myeons, villages, facilities, indicators: { ...b.indicators, ...o.indicators } as Indicators,
  }
}
