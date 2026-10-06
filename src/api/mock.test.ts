import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { COUNTIES, buildModel, diagnose, routeFrom } from './mock'

const myeon = JSON.parse(readFileSync(new URL('../../public/data/myeon.geojson', import.meta.url), 'utf8'))
const m = buildModel(COUNTIES[0], myeon.features) // 창녕

describe('mock 계산 모델', () => {
  it('500m 격자와 마을을 만든다', () => {
    expect(m.cells.length).toBeGreaterThan(1500) // 창녕 약 533㎢ → 2천 칸 안팎
    expect(m.villages.filter((v) => v.isCenter)).toHaveLength(14) // 창녕 14개 읍면
    expect(m.cells.every((c) => c.village >= 0)).toBe(true)
  })

  it('같은 입력이면 같은 결과 (시드 고정)', () => {
    const again = buildModel(COUNTIES[0], myeon.features)
    expect(diagnose(again, 'med', 'bus', 'a80', 30).gap).toBe(diagnose(m, 'med', 'bus', 'a80', 30).gap)
  })

  it('공백 인구는 기준 시간을 넘는 칸의 합이고, 기준을 늘리면 줄어든다', () => {
    const d30 = diagnose(m, 'med', 'bus', 'a80', 30)
    const manual = m.cells.reduce((s, c) => s + (d30.times[c.i] > 30 ? c.p80 : 0), 0)
    expect(d30.gap).toBeCloseTo(manual, 6)
    expect(diagnose(m, 'med', 'bus', 'a80', 60).gap).toBeLessThan(d30.gap)
    expect(d30.topVillages.reduce((s, v) => s + v.gap, 0)).toBeCloseTo(d30.gap, 6)
  })

  it('경로의 끝 시각은 그 칸의 이동시간과 같다', () => {
    const d = diagnose(m, 'med', 'bus', 'all', 30)
    for (const i of [0, 100, 500, 1000]) {
      const r = routeFrom(m, i, 'med', 'bus')
      expect(r.timestamps.at(-1)).toBeCloseTo(d.times[i], 4)
      expect(r.steps.reduce((s, st) => s + st.minutes, 0)).toBeCloseTo(d.times[i], 4)
    }
  })
})

import { defaultAssumptions, planSet } from './plans'
describe('대안 계산', () => {
  const goal = { service: 'med' as const, mode: 'bus' as const, age: 'a80' as const, T: 30, target: 0.9, budget: 6, allowed: { fix: true, tour: true, drt: true, taxi: true, tele: true } }
  const plans = planSet(m, goal, defaultAssumptions())
  it('세 안을 만들고 하나만 추천한다', () => {
    expect(plans.map((p) => p.id)).toEqual(['A', 'B', 'C'])
    expect(plans.filter((p) => p.recommended)).toHaveLength(1)
    console.log(plans.map((p) => `${p.id} ${p.name} picks=${p.picks.length} year=${p.year.toFixed(2)} base=${p.base.toFixed(3)} rate=${p.rate.toFixed(3)} fut=${p.future.toFixed(3)} meets=${p.meets} budget=${p.withinBudget} robust=${p.robust} rec=${p.recommended}`).join('\n'))
  })
  it('A·B는 예산을 넘지 않고, C는 목표를 맞춘다(가능하면)', () => {
    expect(plans[0].year).toBeLessThanOrEqual(6 + 1e-9)
    expect(plans[1].year).toBeLessThanOrEqual(6 + 1e-9)
    expect(plans[2].rate).toBeGreaterThanOrEqual(plans[2].base)
  })
})

import { cameraFor } from '../map/geo'
describe('카메라 맞추기', () => {
  it('범위의 네 모서리가 패널을 뺀 빈 곳 안에 들어온다', () => {
    const box: [number, number, number, number] = [128.28, 35.19, 128.59, 35.36]
    const W = 961, H = 987, pad = { top: 40, bottom: 40, left: 440, right: 40 }
    const { center, zoom } = cameraFor(box, W, H, pad)
    const world = 512 * 2 ** zoom
    const px = (lon: number, lat: number) => {
      const x = (lon + 180) / 360, y = (1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2
      const cx = (center[0] + 180) / 360, cy = (1 - Math.log(Math.tan((center[1] * Math.PI) / 180) + 1 / Math.cos((center[1] * Math.PI) / 180)) / Math.PI) / 2
      return [W / 2 + (x - cx) * world, H / 2 + (y - cy) * world]
    }
    const [l, t] = px(box[0], box[3]), [r, b] = px(box[2], box[1])
    expect(l).toBeGreaterThanOrEqual(pad.left - 0.5)
    expect(r).toBeLessThanOrEqual(W - pad.right + 0.5)
    expect(t).toBeGreaterThanOrEqual(pad.top - 0.5)
    expect(b).toBeLessThanOrEqual(H - pad.bottom + 0.5)
    expect(Math.min(l - pad.left, W - pad.right - r)).toBeLessThan(1) // 가로가 꽉 찬다 (더 멀리 있지 않다)
  })
})
