// 브라우저 마을 카드(localVillageDetail)를 서버 POST /api/village와 대조한다. 운영 서버를 부르므로 npm test에서는 건너뛴다.
//   COMPARE_SERVER=1 npx vitest run scripts/compare-village.test.ts --disableConsoleIntercept
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import type { SnapshotManifest, SnapshotRegion } from '../src/api/snapshot'
import type { State } from '../src/api/types'
import { localVillageDetail } from '../src/api/villageLocal'

const DIR = path.join(import.meta.dirname, '..', process.env.SNAPSHOT_DIR ?? 'snapshot.local')
const API = (process.env.VITE_API_URL ?? 'https://api.village-coverage.kro.kr').replace(/\/$/, '')

describe.skipIf(!process.env.COMPARE_SERVER)('마을 카드 대조', () => {
  test('72개 지역의 다양한 마을에서 서버 응답과 같다', async () => {
    const m: SnapshotManifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'))
    const rules: Partial<State['criteria']>[] = [{}, { carMinutes: 10, stopWalkMinutes: 5, dailyRuns: 8 }]
    let checked = 0
    const diffs: string[] = []
    for (const r of m.regions) {
      const { data }: SnapshotRegion = JSON.parse(fs.readFileSync(path.join(DIR, `${r.code}.json`), 'utf8'))
      const vs = data.villages
      const sample = [vs[0], vs.find((v) => v.bus.noStop), vs.find((v) => v.bus.firstToTownMin == null && r.tier === 'precise'), vs.find((v) => (v.bus.firstToTownMin ?? 0) >= 720), vs.find((v) => v.bus.firstEstimated), vs.find((v) => !v.nearest.med)].filter((v) => !!v)
      for (const v of new Set(sample)) for (const c of rules) {
        const st = { ...m.defaultState, criteria: { ...m.defaultState.criteria, ...c } }
        const res = await fetch(`${API}/api/village`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region: r.code, state: st, villageId: v.id }) })
        const server = await res.json()
        const local = localVillageDetail(data, st, v.id)!
        // 간이 지역의 없는 운행 칸은 서버가 null, 원자료는 칸이 없다(화면은 정밀 지역에서만 읽는다)
        const norm = (d: typeof local) => ({ ...d, bus: { ...d.bus, dailyRuns: d.bus.dailyRuns ?? null } })
        checked++
        try { expect(norm(local)).toEqual(norm(server)) } catch { diffs.push(`${r.code} ${v.id} ${JSON.stringify(c)}\n  local  ${JSON.stringify(local)}\n  server ${JSON.stringify(server)}`) }
      }
    }
    console.log(`대조 ${checked}건, 다름 ${diffs.length}건`)
    if (diffs.length) console.log(diffs.slice(0, 10).join('\n'))
    expect(diffs).toEqual([])
  }, 600_000)
})
