import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { regionOf } from '../data/regions'
import { DEFAULT_COSTS, costAt, optimize, preset } from '../sim/model'
import { BASE, buildGrid, diagnoseGrid, travel } from './grid'
import { planMap } from './planMap'
import { ask, type AgentCtx } from '../api/agent'
import { planSet } from '../sim/model'

const geo = JSON.parse(readFileSync(new URL('../../public/data/myeon.geojson', import.meta.url), 'utf8'))
const r = regionOf('48740')!
const g = buildGrid(r, geo.features)
const c = costAt(DEFAULT_COSTS, 'mid')

test('격자: 응급 거점·DRT·버스 증차를 놓으면 응급실까지 공백이 줄고, 결과 지도에 정책이 놓인다', () => {
  expect(g.cells.length).toBeGreaterThan(500)
  expect(g.hotspots).toHaveLength(r.hotspots)
  const car = diagnoseGrid(g, travel(g, 'car').t, 'all', 30).gap
  const center = g.villages.find((v) => v.isCenter && v.id !== g.hospital)!.id
  expect(diagnoseGrid(g, travel(g, 'car', { ...BASE, centers: [center] }).t, 'all', 30).gap).toBeLessThan(car)
  const bus = diagnoseGrid(g, travel(g, 'bus').t, 'all', 60).gap
  expect(diagnoseGrid(g, travel(g, 'bus', { ...BASE, busMul: 2 }).t, 'all', 60).gap).toBeLessThanOrEqual(bus)

  const opt = optimize(r, preset('med'), 100, c)
  const pm = planMap(g, opt, c, 'car', 30, 'all')
  expect(pm.picks.some((p) => p.type === 'er')).toBe(true)
  expect(pm.reached).toBeGreaterThan(0)
})

test('AI 질문: 예산을 말하면 그 예산으로 다시 계산하라고 화면에 알린다', async () => {
  const ctx: AgentCtx = { region: r, screen: 'result', budget: 100, main: 'bal', level: 'mid', costs: DEFAULT_COSTS, minMed: 0, plans: planSet(r, 100, DEFAULT_COSTS, 'mid'), pending: null }
  const evs = []
  for await (const e of ask('예산이 150억이면요?', ctx)) evs.push(e)
  expect(evs.find((e) => e.type === 'apply')).toMatchObject({ patch: { budget: 150 } })
  expect(evs.at(-1)).toMatchObject({ type: 'done', intent: 'budget' })
}, 10000)
