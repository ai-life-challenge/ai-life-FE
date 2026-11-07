// 비공개 수집본(snapshot.local)에서 공개용 정적 자료(public/data/snapshot)를 만든다. 서버를 부르지 않고, 값을 바꾸지 않고, 파일만 나눈다.
//   node scripts/make-public-snapshot.mjs
// 공개 조건: scripts/snapshot-sources.json의 판정표에 없는 출처나 보류(hold) 출처를 쓰는 지역은 넣지 않는다. 보류 지역이 EXPECTED_HOLD와 다르면
// 사람이 판정을 다시 봐야 하는 변화이므로 아무것도 저장하지 않고 멈춘다. 이유와 확인 근거는 docs/data-licenses.md
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { isDeepStrictEqual } from 'node:util'
import { scanSensitive } from './snapshot-check.mjs'
import { mergeRegion, splitRegion } from '../src/api/snapshotSplit.ts'

const ROOT = path.join(import.meta.dirname, '..')
const FROM = path.join(ROOT, 'snapshot.local')
const OUT = path.join(ROOT, 'public/data/snapshot')
const TMP = `${OUT}.tmp-${process.pid}`
const NOTICES = path.join(import.meta.dirname, 'snapshot-notices')
const EXPECTED_HOLD = ['12770', '12860', '28710', '43720', '43740', '43760', '44710', '44790', '44800', '44810', '44825', '47900', '51830']
export const ODBL = {
  license: { name: 'Open Database License (ODbL) 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
  attribution: '© OpenStreetMap contributors',
  notice: 'Contains information from OpenStreetMap (https://www.openstreetmap.org/copyright), which is made available here under the Open Database License (ODbL) (https://opendatacommons.org/licenses/odbl/1-0/).',
  readme: 'README.txt',
}

// ODbL 파일의 값에 실제로 들어가는 비OSM 자료의 판정. 생명표(a80In10y) · 고시 값은 공공데이터 파일에 있고, 행정 경계는 시설을 읍면에 잇는 데만 쓴다
const CONTENT_STATUS = ['open', 'kogl1']
const table = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'snapshot-sources.json'), 'utf8'))
const byDisplay = new Map(table.sources.map((s) => [s.display, s]))
const byUrl = new Map(table.sources.filter((s) => s.url).map((s) => [s.url, s]))
const m = JSON.parse(fs.readFileSync(path.join(FROM, 'manifest.json'), 'utf8'))
if (m.schema !== 2 || !m.complete) throw new Error('snapshot.local이 전 지역 수집본이 아니에요. npm run snapshot을 먼저 돌려 주세요')

const problems = []
const unsupported = []
const included = []
for (const item of m.regions) {
  const file = JSON.parse(fs.readFileSync(path.join(FROM, m.files[item.code].path), 'utf8'))
  const unknown = file.data.sources.filter((d) => !byDisplay.has(d))
  if (unknown.length) problems.push(`${item.code} ${item.name}: 판정표에 없는 출처 ${unknown.join(', ')}`)
  if (file.data.sources.some((d) => byDisplay.get(d)?.status === 'hold')) unsupported.push({ code: item.code, name: item.name, sido: item.sido })
  else included.push({ item, file })
}
if (!isDeepStrictEqual(unsupported.map((r) => r.code).sort(), EXPECTED_HOLD)) problems.push(`보류 지역이 바뀌었어요: ${unsupported.map((r) => r.code).join(',')}. 판정을 다시 확인해 주세요`)

fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(path.join(TMP, 'osm'), { recursive: true })
const write = (rel, text) => {
  const buf = Buffer.from(text)
  fs.writeFileSync(path.join(TMP, rel), buf)
  return { path: rel, bytes: buf.length, gzipBytes: gzipSync(buf).length, sha256: createHash('sha256').update(buf).digest('hex') }
}

const files = {}, index = {}, sourceSet = new Map(), usedDisplays = new Set()
for (const { item, file } of included) {
  const { code } = item
  const { base, osm } = splitRegion(file.data)
  // 나눈 뒤 합친 값이 원본과 칸 순서까지 같아야 한다
  if (JSON.stringify(mergeRegion(base, osm)) !== JSON.stringify(file.data)) problems.push(`${code}: 나눈 뒤 합친 값이 원본과 달라요`)
  const errs = scanSensitive({ base, osm, map: file.map })
  if (errs.length) problems.push(`${code}: ${errs.slice(0, 4).join(' / ')}`)
  const notes = file.notes.map((n) => {
    const s = byUrl.get(n.url)
    if (!s || s.status === 'hold') problems.push(`${code}: 출처 각주를 판정표에서 찾지 못했어요 ${n.url ?? n.title}`)
    return { ...n, license: s?.license }
  })
  for (const n of notes) { const k = n.url ?? n.title; const e = sourceSet.get(k) ?? { ...n, regions: 0 }; e.regions++; sourceSet.set(k, e) }
  for (const d of file.data.sources) usedDisplays.add(d)
  const contents = file.data.sources.map((d) => byDisplay.get(d)).filter((s) => s && CONTENT_STATUS.includes(s.status)).map((s) => ({ source: s.display, license: s.license }))
  const basePart = write(`${code}.json`, JSON.stringify({ data: base, map: file.map, notes }))
  const osmPart = write(`osm/${code}.json`, JSON.stringify({ ...ODBL, contents, ...osm }))
  files[code] = {
    ...basePart, osm: osmPart,
    villages: base.villages.length, facilities: base.facilities.length, myeons: base.myeons.length, boundaries: file.map.features.length,
    status: 'ok', indicators: base.indicators,
  }
  index[code] = { center: item.center, indicators: osm.indicators }
}
const osmIndex = write('osm/index.json', JSON.stringify({ ...ODBL, capturedAt: m.capturedAt, regions: index }))

if (problems.length) {
  fs.rmSync(TMP, { recursive: true, force: true })
  console.error(`공개 자료를 만들지 않았어요. 문제 ${problems.length}건\n- ${problems.join('\n- ')}`)
  process.exit(1)
}

const regions = included.map(({ item: { center: _c, ...rest } }) => rest)
const hashes = Object.keys(files).sort().flatMap((c) => [files[c].sha256, files[c].osm.sha256]).concat(osmIndex.sha256).join('')
const manifest = {
  schema: 3,
  dataVersion: `${m.capturedAt}-${createHash('sha256').update(hashes).digest('hex').slice(0, 12)}`,
  capturedAt: m.capturedAt,
  origin: m.origin,
  complete: false, // 전 지역이 아니다. 나머지는 unsupported
  totalRegions: m.totalRegions,
  totalVillages: m.totalVillages,
  tiers: { precise: regions.filter((r) => r.tier === 'precise').length, auto: regions.filter((r) => r.tier === 'auto').length },
  regions,
  unsupported,
  defaultState: m.defaultState,
  files,
  osmIndex,
  sources: [...sourceSet.values()].sort((a, b) => b.regions - a.regions || a.title.localeCompare(b.title, 'ko')),
}
fs.writeFileSync(path.join(TMP, 'manifest.json'), JSON.stringify(manifest))

// 고지 문서. OSM 파생 자료의 범위와 만든 방법(ODbL 제4.6조), 공공데이터 출처 표시
const fill = (t) => t.replaceAll('{{capturedAt}}', m.capturedAt).replaceAll('{{regions}}', String(regions.length)).replaceAll('{{unsupported}}', unsupported.map((r) => r.name).join(', '))
fs.writeFileSync(path.join(TMP, 'osm/README.txt'), fill(fs.readFileSync(path.join(NOTICES, 'osm-README.txt'), 'utf8')))
const used = table.sources.filter((s) => usedDisplays.has(s.display) && s.status !== 'absent')
const group = (status) => used.filter((s) => s.status === status).map((s) => `- ${s.display} (${s.org}): ${s.license}${s.url ? ` · ${s.url}` : ''}`).join('\n')
const licenses = fill(fs.readFileSync(path.join(NOTICES, 'LICENSES.txt'), 'utf8'))
  .replace('{{open}}', group('open')).replace('{{kogl1}}', group('kogl1')).replace('{{notice}}', group('notice')).replace('{{checkedAt}}', table.checkedAt)
fs.writeFileSync(path.join(TMP, 'LICENSES.txt'), licenses)

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.renameSync(TMP, OUT)
const sum = (f) => Object.values(files).reduce((a, x) => a + f(x), 0)
console.log(`저장: ${path.relative(ROOT, OUT)}\n지역 ${regions.length}/${m.totalRegions} · 마을 ${regions.reduce((a, r) => a + r.villages, 0)} · 보류 ${unsupported.length}곳 (${unsupported.map((r) => r.name).join(', ')})`)
console.log(`공공데이터 파일 ${(sum((x) => x.bytes) / 1048576).toFixed(1)}MB · ODbL 파일 ${(sum((x) => x.osm.bytes) / 1048576).toFixed(1)}MB · gzip 합계 ${(sum((x) => x.gzipBytes + x.osm.gzipBytes) / 1048576).toFixed(1)}MB · 버전 ${manifest.dataVersion}`)
