// 서버 전체 장애 때 쓸 정적 스냅샷을 만든다: 서버 응답(지역 목록 · 기본 상태 · 마을 자료 · 읍면 경계)을 그대로 저장하고 값을 고치지 않는다.
//   node scripts/make-snapshot.mjs [지역코드 ...]
// 결과는 Git과 배포에 들어가지 않는 snapshot.local/에 저장한다. public/data/snapshot으로 옮겨야 앱이 쓰고 함께 배포된다.
// 옮기기 전에 자료별 이용 조건을 확인한다(docs/estimated-simulation.md의 '스냅샷' 절).
import fs from 'node:fs'
import path from 'node:path'

const API = (process.env.VITE_API_URL ?? 'https://api.village-coverage.kro.kr').replace(/\/$/, '')
const OUT = path.join(import.meta.dirname, '..', 'snapshot.local')
const codes = process.argv.slice(2)
if (!codes.length) codes.push('48740', '12710', '44825') // 창녕군(정밀 · 랜딩 예시 지역) · 담양군(간이) · 태안군(정밀 · 작은 군)

const get = async (p) => {
  const r = await fetch(API + p)
  if (!r.ok) throw new Error(`${p}: ${r.status}`)
  return r.json()
}
const list = await get('/api/regions')
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const regions = []
for (const code of codes) {
  const item = list.regions.find((r) => r.code === code)
  if (!item) throw new Error(`없는 지역: ${code}`)
  const [data, map] = [await get(`/api/regions/${code}`), await get(`/api/regions/${code}/map`)]
  fs.writeFileSync(path.join(OUT, `${code}.json`), JSON.stringify({ data, map }))
  regions.push(item)
  console.log(code, item.name, item.tier, `마을 ${data.villages.length}곳`)
}
const capturedAt = new Date().toISOString().slice(0, 10)
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ capturedAt, origin: API, totalRegions: list.regions.length, regions, defaultState: list.defaultState }, null, 1))
console.log('저장:', OUT, capturedAt)
