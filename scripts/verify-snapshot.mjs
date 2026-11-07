// 스냅샷 폴더를 검사한다. 서버를 부르지 않는 파일 검사가 기본이고, --live를 주면 서버 응답과 값까지 하나하나 대조한다.
//   node scripts/verify-snapshot.mjs [폴더=snapshot.local] [--live]
// 비공개 수집본(schema 2)과 공개본(schema 3: 공공데이터 파일 + OSM 파생 파일)을 모두 읽는다. 공개본은 나눈 파일을 합쳐서 검사하고,
// OSM 값이 공공데이터 파일에 남지 않았는지, 보류 지역이 섞이지 않았는지, ODbL 고지가 있는지도 본다.
// 문제가 하나라도 있으면 종료 코드 1로 끝난다.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { checkRegion, scanSensitive, stripRegion } from './snapshot-check.mjs'
import { mergeRegion } from '../src/api/snapshotSplit.ts'

const args = process.argv.slice(2)
const live = args.includes('--live')
const DIR = path.resolve(import.meta.dirname, '..', args.find((a) => !a.startsWith('--')) ?? 'snapshot.local')
const problems = []
const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
const isPublic = m.schema === 3

const sum = (xs) => xs.reduce((a, x) => a + x, 0)
if (m.schema !== 2 && !isPublic) problems.push(`manifest 형식 ${m.schema}`)
if (new Set(m.regions.map((r) => r.code)).size !== m.regions.length) problems.push('지역 코드 중복')
if (isPublic) {
  if (m.complete !== false) problems.push('공개본은 complete가 false여야 해요')
  if (m.regions.length + m.unsupported.length !== m.totalRegions) problems.push(`담은 지역 ${m.regions.length} + 지원하지 않는 지역 ${m.unsupported.length} ≠ 전체 ${m.totalRegions}`)
  if (m.unsupported.some((u) => m.regions.some((r) => r.code === u.code))) problems.push('지원하지 않는 지역이 목록에 있음')
  if (m.regions.some((r) => 'center' in r)) problems.push('manifest에 OSM 파생 중심 좌표가 있음')
} else {
  if (!m.complete) problems.push('manifest.complete가 false: 일부 지역만 담은 스냅샷')
  if (m.regions.length !== m.totalRegions) problems.push(`지역 수 ${m.regions.length} ≠ 전체 ${m.totalRegions}`)
  if (sum(m.regions.map((r) => r.villages)) !== m.totalVillages) problems.push('지역 목록의 마을 수 합계가 totalVillages와 다름')
}
const onDisk = fs.readdirSync(DIR, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.relative(DIR, path.join(e.parentPath, e.name)))
const expected = new Set(['manifest.json'])
for (const r of m.regions) { expected.add(m.files[r.code]?.path); if (isPublic) expected.add(m.files[r.code]?.osm?.path) }
if (isPublic) for (const f of ['osm/index.json', 'osm/README.txt', 'LICENSES.txt']) expected.add(f)
for (const f of onDisk) if (!expected.has(f)) problems.push(`manifest에 없는 파일 ${f}`)
for (const f of expected) if (f && !onDisk.includes(f)) problems.push(`파일 없음 ${f}`)

function readChecked(part, label) {
  const raw = fs.readFileSync(path.join(DIR, part.path))
  if (createHash('sha256').update(raw).digest('hex') !== part.sha256) problems.push(`${label}: sha256 불일치`)
  if (raw.length !== part.bytes) problems.push(`${label}: 크기 불일치`)
  return raw
}
// ODbL 고지: 파일마다 라이선스 주소와 출처가 있어야 한다(ODbL 제4.2조)
const hasOdbl = (o) => o.license?.url === 'https://opendatacommons.org/licenses/odbl/1-0/' && /OpenStreetMap/.test(o.attribution ?? '') && /Open Database License/.test(o.notice ?? '')
// 공공데이터 파일에 OSM 파생 칸이 남으면 안 된다
const OSM_VILLAGE = ['lon', 'lat', 'seniorCenter', 'bus', 'nearest']
const OSM_INDICATOR = ['walkMin', 'stopShare', 'runsShare', 'minRuns', 'doctors', 'e30', 'e60', 'erCenterMin', 'erRegionalMin']

let index = null
if (isPublic) {
  index = JSON.parse(readChecked(m.osmIndex, 'osm/index.json').toString('utf8'))
  if (!hasOdbl(index)) problems.push('osm/index.json: ODbL 고지 없음')
  if (!isDeepStrictEqual(Object.keys(index.regions).sort(), m.regions.map((r) => r.code).sort())) problems.push('osm/index.json 지역 목록이 manifest와 다름')
  const readme = fs.readFileSync(path.join(DIR, 'osm/README.txt'), 'utf8')
  for (const w of ['Open Database License', 'opendatacommons.org/licenses/odbl/1-0', 'openstreetmap.org/copyright', '만든 방법', 'OSRM v5.27.1']) if (!readme.includes(w)) problems.push(`osm/README.txt에 '${w}' 없음`)
  const lic = fs.readFileSync(path.join(DIR, 'LICENSES.txt'), 'utf8')
  for (const w of ['CC BY 4.0', '공공누리 제1유형', '이용허락범위 제한 없음', 'kosis.kr', 'openstreetmap.org/copyright']) if (!lic.includes(w)) problems.push(`LICENSES.txt에 '${w}' 없음`)
  for (const u of m.unsupported) if (fs.existsSync(path.join(DIR, `${u.code}.json`)) || fs.existsSync(path.join(DIR, `osm/${u.code}.json`))) problems.push(`${u.code} ${u.name}: 보류 지역 파일이 있음`)
}

const heldPrefixes = (m.unsupported ?? []).map((u) => u.code)
const seen = new Map()
let villages = 0, facilities = 0, bytes = 0, gzip = 0, largest = 0
for (const item of m.regions) {
  const f = m.files[item.code]
  if (!f) { problems.push(`${item.code}: manifest 파일 정보 없음`); continue }
  if (!fs.existsSync(path.join(DIR, f.path))) continue
  const raw = readChecked(f, item.code)
  const s = JSON.parse(raw.toString('utf8'))
  let data = s.data, listItem = item
  if (isPublic) {
    if (!f.osm || !fs.existsSync(path.join(DIR, f.osm.path))) { problems.push(`${item.code}: OSM 파생 파일 없음`); continue }
    const o = JSON.parse(readChecked(f.osm, `osm/${item.code}`).toString('utf8'))
    if (!hasOdbl(o)) problems.push(`${item.code}: ODbL 고지 없음`)
    if (!Array.isArray(o.contents) || !o.contents.length) problems.push(`${item.code}: ODbL 파일에 비OSM 출처 표시 없음`)
    for (const v of s.data.villages) for (const k of OSM_VILLAGE) if (k in v) problems.push(`${item.code}: 공공데이터 파일 마을에 ${k} 칸이 남음`)
    for (const k of OSM_INDICATOR) if (k in s.data.indicators) problems.push(`${item.code}: 공공데이터 파일 지표에 ${k} 칸이 남음`)
    for (const x of s.data.facilities) if ('village' in x) problems.push(`${item.code}: 공공데이터 파일 시설에 마을 연결이 남음`)
    if ('depot' in s.data) problems.push(`${item.code}: 공공데이터 파일에 depot이 남음`)
    data = mergeRegion(s.data, o)
    if (!data) { problems.push(`${item.code}: 두 파일을 합칠 수 없음`); continue }
    listItem = { ...item, center: index.regions[item.code]?.center }
    if (!isDeepStrictEqual({ ...f.indicators, ...index.regions[item.code]?.indicators }, data.indicators)) problems.push(`${item.code}: manifest · index 지표 불일치`)
    bytes += f.osm.bytes; gzip += f.osm.gzipBytes
  } else if (!isDeepStrictEqual(f.indicators, data.indicators)) problems.push(`${item.code}: manifest 지표 불일치`)
  const errs = [...checkRegion(item, data, s.map), ...scanSensitive({ data, map: s.map })]
  if (!s.notes?.length) errs.push('출처 각주 없음')
  if (errs.length) problems.push(`${item.code} ${item.name}: ${errs.slice(0, 5).join(' / ')}`)
  if (f.villages !== data.villages.length) problems.push(`${item.code}: manifest 마을 수 불일치`)
  for (const v of data.villages) {
    if (seen.has(v.id)) problems.push(`마을 ${v.id}: ${seen.get(v.id)} · ${item.code}에 중복`)
    if (heldPrefixes.includes(v.id.slice(0, 5))) problems.push(`마을 ${v.id}: 보류 지역 자료가 ${item.code} 파일에 있음`)
    seen.set(v.id, item.code)
  }
  villages += data.villages.length; facilities += data.facilities.length; bytes += raw.length; gzip += f.gzipBytes; largest = Math.max(largest, raw.length)
  if (live) {
    const [d, b] = await Promise.all([fetchJson(`/api/regions/${item.code}`), fetchJson(`/api/regions/${item.code}/map`)])
    // 칸 순서까지 같아야 복구 때 같은 자료로 알아본다
    if (JSON.stringify(stripRegion(d)) !== JSON.stringify(data)) problems.push(`${item.code}: 서버 마을 자료와 다름`)
    if (!isDeepStrictEqual(b, s.map)) problems.push(`${item.code}: 서버 경계와 다름`)
    m.__list ??= await fetchJson('/api/regions')
    const fromServer = m.__list.regions.find((r) => r.code === item.code)
    if (!isDeepStrictEqual(fromServer, listItem)) problems.push(`${item.code}: 서버 지역 목록과 다름`)
  }
}
if (villages !== sum(m.regions.map((r) => r.villages))) problems.push(`마을 수 합계 ${villages} ≠ 목록 합계`)
if (live) {
  const l = m.__list ?? await fetchJson('/api/regions')
  if (!isDeepStrictEqual(l.defaultState, m.defaultState)) problems.push('서버 기본 상태와 다름')
  const serverCodes = l.regions.map((r) => r.code).sort()
  const listed = [...m.regions.map((r) => r.code), ...(m.unsupported ?? []).map((r) => r.code)].sort()
  if (!isDeepStrictEqual(serverCodes, listed)) problems.push('서버 지역 목록과 담은 지역 · 지원하지 않는 지역 합이 다름')
  for (const u of m.unsupported ?? []) { const r = l.regions.find((x) => x.code === u.code); if (r?.name !== u.name) problems.push(`${u.code}: 지역 이름이 서버와 다름`) }
}
async function fetchJson(p) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(m.origin + p, { signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return await r.json()
    } catch (e) { if (i >= 3) throw new Error(`${p}: ${e.message}`); await new Promise((go) => setTimeout(go, 1000 * (i + 1))) }
  }
}

const manifestKB = fs.statSync(path.join(DIR, 'manifest.json')).size / 1024
console.log(`지역 ${m.regions.length}/${m.totalRegions}${isPublic ? ` · 지원하지 않는 지역 ${m.unsupported.length}` : ''} · 마을 ${villages} · 시설 ${facilities} · 파일 ${onDisk.length}개`)
console.log(`원본 ${(bytes / 1048576).toFixed(2)}MB · gzip ${(gzip / 1048576).toFixed(2)}MB · 가장 큰 파일 ${(largest / 1024).toFixed(0)}KB · manifest ${manifestKB.toFixed(0)}KB`)
console.log(`수집일 ${m.capturedAt} · 버전 ${m.dataVersion}${live ? ' · 서버와 값 대조함' : ''}`)
if (problems.length) { console.error(`\n문제 ${problems.length}건\n- ${problems.slice(0, 40).join('\n- ')}`); process.exit(1) }
console.log('문제 없음')
