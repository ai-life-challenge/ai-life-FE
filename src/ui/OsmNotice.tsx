// OpenStreetMap 출처와 ODbL 고지(ODbL 제4.3조). 이동 시간과 마을 위치를 보여 주는 화면과 문서에 붙인다
export const OSM_COPYRIGHT = 'https://www.openstreetmap.org/copyright'
export const ODBL_URL = 'https://opendatacommons.org/licenses/odbl/1-0/'
export const OSM_DATA = '/data/snapshot/osm/README.txt'
export const LICENSES = '/data/snapshot/LICENSES.txt'

export function OsmNotice() {
  const ext = { target: '_blank', rel: 'noopener noreferrer' }
  return (
    <p className="source">
      이동 시간과 마을 위치 일부는 <a href={OSM_COPYRIGHT} {...ext}>OpenStreetMap</a> 자료를 담고 있고, <a href={ODBL_URL} {...ext}>Open Database License</a>로 제공돼요. <a href={OSM_DATA} {...ext}>파생 자료 받기</a> · <a href={LICENSES} {...ext}>자료별 출처와 조건</a>
    </p>
  )
}
