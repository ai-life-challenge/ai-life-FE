// 서버 전체 장애 때 쓸 정적 스냅샷을 만든다. 서버 응답(지역 목록 · 기본 상태 · 마을 자료 · 읍면 경계)을 값을 고치지 않고 그대로 저장한다.
//   node scripts/make-snapshot.mjs                    전 지역 수집 → snapshot.local/ (Git · 배포 제외)
//   node scripts/make-snapshot.mjs 48740 12710        일부 지역만(manifest.complete=false, 완성본으로 취급하지 않는다)
//   공개용 파일은 이 결과에서 node scripts/make-public-snapshot.mjs로 만든다
// 하나라도 실패하거나 검증을 통과하지 못하면 임시 폴더를 버리고 종료 코드 1로 끝난다. 기존 결과는 그대로 남는다.
// 수집한 파일을 서버와 다시 대조하려면 scripts/verify-snapshot.mjs를 쓴다.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { checkRegion, scanSensitive, stripRegion } from './snapshot-check.mjs'

const API = (process.env.VITE_API_URL ?? 'https://api.village-coverage.kro.kr').replace(/\/$/, '')
const ROOT = path.join(import.meta.dirname, '..')
const args = process.argv.slice(2)
const outAt = args.indexOf('--out')
const OUT = path.resolve(ROOT, outAt >= 0 ? args[outAt + 1] : 'snapshot.local')
// 이 스크립트의 파일에는 공개 조건을 확인하지 않은 값과 OSM 값이 섞여 있다. 공개 폴더에는 make-public-snapshot.mjs만 쓴다
if (OUT.startsWith(path.join(ROOT, 'public') + path.sep)) throw new Error('공개 폴더로 바로 수집할 수 없어요. node scripts/make-public-snapshot.mjs를 쓰세요')
const codes = args.filter((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1))
const TRIES = 4, TIMEOUT_MS = 30_000, WORKERS = 3

const sleep = (ms) => new Promise((go) => setTimeout(go, ms))
// 실패하면 간격을 늘려 몇 번만 다시 묻는다. 4xx는 다시 물어도 같으므로 바로 실패한다
const get = (p) => request(p)
const post = (p, body) => request(p, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Accept: 'application/json' } })
async function request(p, init) {
  let last
  for (let i = 1; i <= TRIES; i++) {
    try {
      const r = await fetch(API + p, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' }, ...init })
      if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(`${p}: HTTP ${r.status}`), { fatal: true })
      if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`)
      return await r.json()
    } catch (e) {
      last = e
      if (e.fatal) throw e
      if (i < TRIES) await sleep(500 * 2 ** i)
    }
  }
  throw last
}

const list = await get('/api/regions')
const health = await get('/api/health')
if (!Array.isArray(list.regions) || !list.defaultState) throw new Error('지역 목록 응답 형식이 올바르지 않아요')
if (health.regions !== list.regions.length) throw new Error(`지역 수 불일치: health ${health.regions} · regions ${list.regions.length}`)
if (new Set(list.regions.map((r) => r.code)).size !== list.regions.length) throw new Error('지역 코드가 겹쳐요')

const targets = codes.length ? codes.map((c) => list.regions.find((r) => r.code === c) ?? (() => { throw new Error(`없는 지역: ${c}`) })()) : list.regions
const TMP = `${OUT}.tmp-${process.pid}`
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

const problems = []
const files = {}
const sourceSet = new Map() // 출처 주소 → 출처 정보와 쓰는 지역 수
const seenIds = new Map() // 마을 id → 지역(지역 자료가 뒤섞이지 않았는지)
const queue = [...targets]
async function worker() {
  for (let item = queue.shift(); item; item = queue.shift()) {
    const { code } = item
    try {
      const [raw, map, report] = await Promise.all([get(`/api/regions/${code}`), get(`/api/regions/${code}/map`), post('/api/report', { region: code, state: list.defaultState })])
      const errs = checkRegion(item, raw, map)
      if (errs.length) { problems.push(`${code} ${item.name}: ${errs.slice(0, 8).join(' / ')}${errs.length > 8 ? ` 외 ${errs.length - 8}건` : ''}`); continue }
      const data = stripRegion(raw)
      // 출처별 주소와 기준 시점: 서버 레포트 각주에 있는 값 그대로. 수집일과 달리 원본 자료의 시점이다
      const notes = report.notes.filter((n) => n.kind === 'source').map(({ org, title, url, date }) => ({ org, title, url, date: date ?? null }))
      if (!notes.length) errs.push('출처 각주가 없음')
      for (const v of data.villages ?? []) {
        if (seenIds.has(v.id)) errs.push(`마을 id ${v.id}가 ${seenIds.get(v.id)}에도 있음`)
        seenIds.set(v.id, code)
      }
      errs.push(...scanSensitive({ data, map }))
      const body = JSON.stringify({ data, map, notes })
      if (errs.length) { problems.push(`${code} ${item.name}: ${errs.slice(0, 8).join(' / ')}${errs.length > 8 ? ` 외 ${errs.length - 8}건` : ''}`); continue }
      fs.writeFileSync(path.join(TMP, `${code}.json`), body)
      for (const n of notes) { const k = n.url ?? n.title; const e = sourceSet.get(k) ?? { ...n, regions: 0 }; e.regions++; sourceSet.set(k, e) }
      files[code] = {
        path: `${code}.json`, bytes: Buffer.byteLength(body), gzipBytes: gzipSync(body).length,
        sha256: createHash('sha256').update(body).digest('hex'),
        villages: data.villages.length, facilities: data.facilities.length, myeons: data.myeons.length, boundaries: map.features.length,
        status: 'ok', indicators: data.indicators, // 지역 카드가 지역 파일을 받지 않고 요약을 그리는 데 쓴다
      }
      console.log(code, item.name, item.tier, `마을 ${data.villages.length}곳`, `시설 ${data.facilities.length}곳`, `${Math.round(files[code].bytes / 1024)}KB`)
    } catch (e) { problems.push(`${code} ${item.name}: ${e.message}`) }
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker))

const fail = (msgs) => {
  fs.rmSync(TMP, { recursive: true, force: true })
  console.error(`\n수집 실패 ${msgs.length}건. 결과를 저장하지 않았어요.\n- ${msgs.join('\n- ')}`)
  process.exit(1)
}
if (problems.length) fail(problems)
const totalVillages = Object.values(files).reduce((a, f) => a + f.villages, 0)
const fullVillages = list.regions.reduce((a, r) => a + r.villages, 0)
const complete = targets.length === list.regions.length
if (complete && totalVillages !== fullVillages) fail([`마을 수 불일치: 수집 ${totalVillages} · 지역 목록 합계 ${fullVillages}`])

const capturedAt = new Date().toISOString().slice(0, 10)
const hashes = Object.keys(files).sort().map((c) => files[c].sha256).join('')
const manifest = {
  schema: 2,
  dataVersion: `${capturedAt}-${createHash('sha256').update(hashes).digest('hex').slice(0, 12)}`,
  capturedAt, // 수집일. 원본 통계의 기준 시점이 아니다(자료마다 다르다: docs/offline-snapshot.md)
  origin: API,
  complete, // 서버의 전 지역을 수집했는지
  totalRegions: list.regions.length, // 서버 전체 지역 수
  totalVillages: fullVillages,
  tiers: health.tiers,
  regions: targets,
  defaultState: list.defaultState,
  files,
  sources: [...sourceSet.values()].sort((a, b) => b.regions - a.regions || a.title.localeCompare(b.title, 'ko')),
}
fs.writeFileSync(path.join(TMP, 'manifest.json'), JSON.stringify(manifest))
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.renameSync(TMP, OUT)

const bytes = Object.values(files).reduce((a, f) => a + f.bytes, 0), gz = Object.values(files).reduce((a, f) => a + f.gzipBytes, 0)
console.log(`\n저장: ${OUT}\n수집일 ${capturedAt} · 지역 ${targets.length}/${list.regions.length} · 마을 ${totalVillages} · 원본 ${(bytes / 1048576).toFixed(1)}MB · gzip ${(gz / 1048576).toFixed(1)}MB · manifest ${(Buffer.byteLength(JSON.stringify(manifest)) / 1024).toFixed(0)}KB`)
