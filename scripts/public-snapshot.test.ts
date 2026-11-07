// 공개 스냅샷(public/data/snapshot) 검증: 나눈 파일을 합친 값이 비공개 전체 수집본과 같은지, 계산 결과가 같은지, 공개 조건을 지키는지.
// 비공개 수집본(snapshot.local)이 없으면 그 대조만 건너뛴다.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { estimateJudge, estimatePlans, estimateSensitivity, EstimateError } from '../src/api/estimatePlans'
import { judgeCar, judgeLocal } from '../src/api/judge'
import { mergeRegion, type BaseRegion, type OsmRegion } from '../src/api/snapshotSplit'
import type { SnapshotManifest } from '../src/api/snapshot'
import type { RegionData, State } from '../src/api/types'
import { localVillageDetail } from '../src/api/villageLocal'
import { vulnOf } from '../src/api/vuln'

const root = path.join(import.meta.dirname, '..')
const PUB = path.join(root, 'public/data/snapshot')
const PRIV = path.join(root, 'snapshot.local')
const hasPub = fs.existsSync(path.join(PUB, 'manifest.json'))
const hasPriv = fs.existsSync(path.join(PRIV, 'manifest.json'))
const read = (...p: string[]) => JSON.parse(fs.readFileSync(path.join(...p), 'utf8'))
const m: SnapshotManifest = hasPub ? read(PUB, 'manifest.json') : ({ regions: [] } as unknown as SnapshotManifest)
const table = read(root, 'scripts/snapshot-sources.json') as { sources: { id: string; display: string; status: string; license: string }[] }
const byDisplay = new Map(table.sources.map((s) => [s.display, s]))
const merged = (code: string): RegionData => {
  const f = m.files![code]
  return mergeRegion(read(PUB, f.path).data as BaseRegion, read(PUB, f.osm!.path) as OsmRegion)!
}

describe.skipIf(!hasPub)('공개 조건', () => {
  test('59개 지역만 담고 보류 13곳은 이름만 있다', () => {
    expect(m.regions).toHaveLength(59)
    expect(m.unsupported).toHaveLength(13)
    expect(m.complete).toBe(false)
    expect(m.totalRegions).toBe(72)
    const files = fs.readdirSync(PUB, { recursive: true }).map(String)
    for (const u of m.unsupported!) {
      expect(files).not.toContain(`${u.code}.json`)
      expect(files).not.toContain(path.join('osm', `${u.code}.json`))
      expect(Object.keys(u).sort()).toEqual(['code', 'name', 'sido'])
    }
    expect(files.filter((f) => f.endsWith('.json') && !f.includes('/')).length).toBe(60) // manifest + 59
    expect(files.filter((f) => f.startsWith('osm/')).length).toBe(61) // index + README + 59
  })
  test.each(m.regions.map((r) => [r.code, r.name] as const))('%s %s: 원자료가 모두 허용된 출처이고 ODbL 파일에 맞지 않는 조건이 없다', (code) => {
    const b = read(PUB, m.files![code].path)
    for (const d of b.data.sources) {
      const s = byDisplay.get(d)
      expect(s, d).toBeTruthy()
      expect(s!.status, d).not.toBe('hold')
    }
    const o = read(PUB, m.files![code].osm!.path)
    expect(o.license.url).toBe('https://opendatacommons.org/licenses/odbl/1-0/')
    // ODbL 파일은 누구나 상업적으로 쓰고 고칠 수 있어야 한다: 상업 금지(제2 · 4유형) · 변경 금지(제3 · 4유형) 자료가 들어가면 안 된다
    for (const c of o.contents) expect(c.license, c.source).not.toMatch(/제[234]유형|상업적\s*이용\s*금지|변경\s*금지|사전 협의|표시 없음/)
    // 공공데이터 파일도 공개 재배포를 막는 유형이 없어야 한다. 생명표의 '임의 변경 금지'는 통계 왜곡 금지이고 재배포 조건이 아니다(a80In10y는 계산값으로 표기)
    for (const n of b.notes) expect(n.license, n.title).not.toMatch(/제[234]유형|상업적\s*이용\s*금지|사전 협의|표시 없음/)
  })
  test('공공데이터 파일에 OSM 파생 칸이 없다', () => {
    for (const r of m.regions) {
      const { data } = read(PUB, m.files![r.code].path)
      for (const v of data.villages) expect(Object.keys(v).sort()).toEqual(['a80In10y', 'id', 'myeon', 'name', 'pop'])
      for (const f of data.facilities) expect('village' in f).toBe(false)
      expect(Object.keys(data.indicators).sort()).toEqual(['elderly', 'pop'])
      expect('depot' in data).toBe(false)
    }
    expect(m.regions.some((r) => 'center' in r)).toBe(false)
  })
})

describe.skipIf(!hasPub || !hasPriv)('비공개 전체 수집본과 대조', () => {
  const pm = hasPriv ? read(PRIV, 'manifest.json') : null
  test('목록과 중심 좌표 · 지표가 같다', () => {
    const index = read(PUB, 'osm/index.json')
    for (const r of m.regions) {
      const o = pm.regions.find((x: { code: string }) => x.code === r.code)
      expect({ ...r, center: index.regions[r.code].center }).toEqual(o)
      expect({ ...m.files![r.code].indicators, ...index.regions[r.code].indicators }).toEqual(pm.files[r.code].indicators)
    }
    expect(m.defaultState).toEqual(pm.defaultState)
  })
  test.each(m.regions.map((r) => [r.code, r.name] as const))('%s %s: 합친 값과 계산 결과가 원본과 같다', (code) => {
    const orig = read(PRIV, pm.files[code].path)
    const data = merged(code)
    // 칸 순서까지 같다
    expect(JSON.stringify(data)).toBe(JSON.stringify(orig.data))
    const base = read(PUB, m.files![code].path)
    expect(base.map).toEqual(orig.map)
    const st: State = { ...m.defaultState }
    expect(vulnOf(data)).toEqual(vulnOf(orig.data))
    for (const age of ['all', 'a65', 'a80'] as const) {
      expect(judgeLocal(data, { ...st, age })).toEqual(judgeLocal(orig.data, { ...st, age }))
      expect(judgeCar(data, age, 30)).toEqual(judgeCar(orig.data, age, 30))
    }
    expect(estimateJudge(data, st)).toEqual(estimateJudge(orig.data, st))
    const plan = (d: RegionData) => { try { return estimatePlans(d, st) } catch (e) { if (e instanceof EstimateError) return e.message; throw e } }
    expect(plan(data)).toEqual(plan(orig.data))
    expect(estimateSensitivity(data, st)).toEqual(estimateSensitivity(orig.data, st))
    const id = data.villages[0].id
    expect(localVillageDetail(data, st, id)).toEqual(localVillageDetail(orig.data, st, id))
  })
})
