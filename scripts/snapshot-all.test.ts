// 수집한 스냅샷 전 지역 스모크 테스트: 파일 검증 → 진단 → 대안 → 민감도 → 마을 카드가 모든 지역에서 NaN · Infinity 없이 끝나는지.
// 스냅샷 폴더(기본 public/data/snapshot, 없으면 snapshot.local)가 없으면 건너뛴다. 다른 폴더: SNAPSHOT_DIR=...
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { estimateJudge, estimatePlans, estimateSensitivity, EstimateError } from '../src/api/estimatePlans'
import { validJudge, validPlans, validRegionData, validRegionList, validSens } from '../src/api/fallback'
import { judgeCar, judgeLocal } from '../src/api/judge'
import { validSnapshotRegion, type SnapshotManifest, type SnapshotRegion } from '../src/api/snapshot'
import type { State } from '../src/api/types'
import { localVillageDetail } from '../src/api/villageLocal'
import { vulnOf } from '../src/api/vuln'

const root = path.join(import.meta.dirname, '..')
const DIR = [process.env.SNAPSHOT_DIR, 'public/data/snapshot', 'snapshot.local'].filter(Boolean).map((d) => path.resolve(root, d!)).find((d) => fs.existsSync(path.join(d, 'manifest.json')))
const m: SnapshotManifest | null = DIR ? JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) : null
const load = (code: string): SnapshotRegion => JSON.parse(fs.readFileSync(path.join(DIR!, m!.files![code].path), 'utf8'))
// 숫자가 들어갈 자리에 NaN · Infinity · undefined가 있는지 찾아 경로를 돌려준다
function badNumbers(o: unknown, at = ''): string[] {
  if (typeof o === 'number') return Number.isFinite(o) ? [] : [at]
  if (o === undefined) return [at]
  if (Array.isArray(o)) return o.flatMap((x, i) => badNumbers(x, `${at}[${i}]`))
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => badNumbers(v, `${at}.${k}`))
  return []
}

describe.skipIf(!m)('스냅샷 전 지역', () => {
  test('manifest가 완전하다: 지역 수 · 마을 수 · 파일 수', () => {
    expect(validRegionList(m!)).toBe(true)
    expect(m!.complete).toBe(true)
    expect(m!.regions).toHaveLength(m!.totalRegions)
    expect(new Set(m!.regions.map((r) => r.code)).size).toBe(m!.totalRegions)
    expect(m!.regions.reduce((a, r) => a + r.villages, 0)).toBe(m!.totalVillages)
    expect(fs.readdirSync(DIR!).filter((f) => f !== 'manifest.json').sort()).toEqual(m!.regions.map((r) => `${r.code}.json`).sort())
    expect(m!.regions.filter((r) => r.tier === 'precise')).toHaveLength(m!.tiers!.precise)
    expect(m!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  test('어느 마을 id도 두 지역에 나오지 않는다', () => {
    const seen = new Map<string, string>()
    for (const r of m!.regions) for (const v of load(r.code).data.villages) { expect(seen.has(v.id), v.id).toBe(false); seen.set(v.id, r.code) }
    expect(seen.size).toBe(m!.totalVillages)
  })

  const regions = m?.regions ?? []
  test.each(regions.map((r) => [r.code, r.name, r] as const))('%s %s', (code, name, item) => {
    const s = load(code)
    const { data } = s
    // 파일이 앱의 검증을 통과하고 지역 목록과 맞다
    expect(validSnapshotRegion(item, s)).toBe(true)
    expect(validRegionData(data)).toBe(true)
    expect(data.name).toBe(name)
    expect(data.villages.every((v) => v.id.startsWith(code))).toBe(true)
    const myeons = new Set(data.myeons.map((x) => x.id))
    expect(data.villages.every((v) => myeons.has(v.myeon))).toBe(true)
    expect(s.map!.features.length).toBeGreaterThan(0)
    expect(data.facilities.every((f) => f.village == null || data.villages.some((v) => v.id === f.village))).toBe(true)
    // 인구 합계: 지역 지표와 마을 합이 맞는다(중복 집계 없음)
    expect(data.villages.reduce((a, v) => a + v.pop.all, 0)).toBe(data.indicators.pop)

    const st: State = { ...m!.defaultState }
    const n = data.villages.length
    // 진단
    const vuln = vulnOf(data)
    expect(badNumbers(vuln, 'vuln')).toEqual([])
    for (const age of ['all', 'a65', 'a80'] as const) {
      const j = judgeLocal(data, { ...st, age })
      expect(j.villages).toHaveLength(n)
      expect(badNumbers(j.summary, 'judge')).toEqual([])
      expect(j.summary.gap).toBeLessThanOrEqual(j.summary.total)
      expect(badNumbers(judgeCar(data, age, 30).summary, 'car')).toEqual([])
    }
    expect(validJudge(estimateJudge(data, st), n)).toBe(true)
    // 마을 카드
    for (const v of data.villages) {
      const d = localVillageDetail(data, st, v.id)!
      expect(d.med.state).toBe(judgeLocal(data, st).villages.find((x) => x.id === v.id)!.state)
      expect(d.pop).toEqual(v.pop)
    }
    // 대안: 예산 범위 끝과 기본값, 나이대
    let ran = 0
    for (const o of [{}, { budget: 0.5 }, { budget: 30, target: 1 }, { age: 'all' as const }, { allowedSupply: { fix: false, tour: false, drt: false, tele: true } }]) {
      const cur = { ...st, ...o }
      let p
      try { p = estimatePlans(data, cur) } catch (e) {
        // 그 나이대 주민이 0명이면 추정하지 않는다: 값을 만들지 않는 정상 동작이고 이유를 알린다
        expect(e).toBeInstanceOf(EstimateError)
        continue
      }
      ran++
      expect(validPlans(p, n), `${code} ${JSON.stringify(o)}`).toBe(true)
      expect(badNumbers(p.plans, 'plans')).toEqual([])
      expect(p.plans.filter((x) => x.recommended)).toHaveLength(1)
      for (const x of p.plans) {
        expect(x.coverage).toHaveLength(n)
        expect(x.withinBudget, `${code} 예산 초과 ${x.year}/${cur.budget}`).toBe(true)
        expect(x.year).toBeLessThanOrEqual(cur.budget + 1e-9)
        expect(x.rate).toBeGreaterThanOrEqual(x.baseRate - 1e-9)
        expect(x.picks.flatMap((q) => q.villages).every((id) => id.startsWith(code))).toBe(true)
      }
      expect(p.estimate!.basis).toHaveLength(n)
    }
    expect(ran).toBeGreaterThan(0)
    const sens = estimateSensitivity(data, st)
    expect(validSens(sens)).toBe(true)
    expect(badNumbers(sens, 'sens')).toEqual([])
  })
})
