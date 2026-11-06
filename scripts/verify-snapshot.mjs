// 스냅샷 폴더를 검사한다. 서버를 부르지 않는 파일 검사가 기본이고, --live를 주면 서버 응답과 값까지 하나하나 대조한다.
//   node scripts/verify-snapshot.mjs [폴더=snapshot.local] [--live]
// 문제가 하나라도 있으면 종료 코드 1로 끝난다.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { checkRegion, scanSensitive, stripRegion } from './snapshot-check.mjs'

const args = process.argv.slice(2)
const live = args.includes('--live')
const DIR = path.resolve(import.meta.dirname, '..', args.find((a) => !a.startsWith('--')) ?? 'snapshot.local')
const problems = []
const m = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))

const sum = (xs) => xs.reduce((a, x) => a + x, 0)
if (m.schema !== 2) problems.push(`manifest 형식 ${m.schema}`)
if (!m.complete) problems.push('manifest.complete가 false: 일부 지역만 담은 스냅샷')
if (m.regions.length !== m.totalRegions) problems.push(`지역 수 ${m.regions.length} ≠ 전체 ${m.totalRegions}`)
if (new Set(m.regions.map((r) => r.code)).size !== m.regions.length) problems.push('지역 코드 중복')
if (sum(m.regions.map((r) => r.villages)) !== m.totalVillages) problems.push('지역 목록의 마을 수 합계가 totalVillages와 다름')
const onDisk = fs.readdirSync(DIR).filter((f) => f !== 'manifest.json')
const expected = m.regions.map((r) => m.files[r.code]?.path)
for (const f of onDisk) if (!expected.includes(f)) problems.push(`manifest에 없는 파일 ${f}`)

const seen = new Map()
let villages = 0, facilities = 0, bytes = 0, gzip = 0, largest = 0
for (const item of m.regions) {
  const f = m.files[item.code]
  if (!f) { problems.push(`${item.code}: manifest 파일 정보 없음`); continue }
  const p = path.join(DIR, f.path)
  if (!fs.existsSync(p)) { problems.push(`${item.code}: 파일 없음 ${f.path}`); continue }
  const raw = fs.readFileSync(p)
  if (createHash('sha256').update(raw).digest('hex') !== f.sha256) problems.push(`${item.code}: sha256 불일치`)
  if (raw.length !== f.bytes) problems.push(`${item.code}: 크기 불일치`)
  const s = JSON.parse(raw.toString('utf8'))
  const errs = [...checkRegion(item, s.data, s.map), ...scanSensitive({ data: s.data, map: s.map })]
  if (!s.notes?.length) errs.push('출처 각주 없음')
  if (errs.length) problems.push(`${item.code} ${item.name}: ${errs.slice(0, 5).join(' / ')}`)
  if (f.villages !== s.data.villages.length) problems.push(`${item.code}: manifest 마을 수 불일치`)
  if (!isDeepStrictEqual(f.indicators, s.data.indicators)) problems.push(`${item.code}: manifest 지표 불일치`)
  for (const v of s.data.villages) {
    if (seen.has(v.id)) problems.push(`마을 ${v.id}: ${seen.get(v.id)} · ${item.code}에 중복`)
    seen.set(v.id, item.code)
  }
  villages += s.data.villages.length; facilities += s.data.facilities.length; bytes += raw.length; gzip += f.gzipBytes; largest = Math.max(largest, raw.length)
  if (live) {
    const [d, b] = await Promise.all([fetchJson(`/api/regions/${item.code}`), fetchJson(`/api/regions/${item.code}/map`)])
    if (!isDeepStrictEqual(stripRegion(d), s.data)) problems.push(`${item.code}: 서버 마을 자료와 다름`)
    if (!isDeepStrictEqual(b, s.map)) problems.push(`${item.code}: 서버 경계와 다름`)
  }
}
if (villages !== m.totalVillages) problems.push(`마을 수 합계 ${villages} ≠ ${m.totalVillages}`)
if (live) {
  const l = await fetchJson('/api/regions')
  if (!isDeepStrictEqual(l.regions, m.regions)) problems.push('서버 지역 목록과 다름')
  if (!isDeepStrictEqual(l.defaultState, m.defaultState)) problems.push('서버 기본 상태와 다름')
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
console.log(`지역 ${m.regions.length}/${m.totalRegions} · 마을 ${villages} · 시설 ${facilities} · 파일 ${onDisk.length + 1}개`)
console.log(`원본 ${(bytes / 1048576).toFixed(2)}MB · gzip ${(gzip / 1048576).toFixed(2)}MB · 가장 큰 파일 ${(largest / 1024).toFixed(0)}KB · manifest ${manifestKB.toFixed(0)}KB`)
console.log(`수집일 ${m.capturedAt} · 버전 ${m.dataVersion}${live ? ' · 서버와 값 대조함' : ''}`)
if (problems.length) { console.error(`\n문제 ${problems.length}건\n- ${problems.join('\n- ')}`); process.exit(1) }
console.log('문제 없음')
