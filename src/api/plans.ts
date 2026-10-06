// 대안 계산 (가상). 시제품의 탐욕 배치를 옮기고 「명세서 개선 방향」의 세 안 규칙과 추천 기준을 따른다.
// ponytail: 비용 대비 효과가 큰 것부터 고르는 탐욕 배치, 실서비스는 OR-Tools로 최대커버링(MCLP)을 푼다.
import type { AgeId, ModeId } from './types'
import { tCar, timeTo, type C, type Model } from './mock'

export type OptService = 'med' | 'pha' | 'gro'
export type SupplyId = 'fix' | 'tour' | 'drt' | 'taxi' | 'tele'
export type PlanId = 'A' | 'B' | 'C'

export const SUPPLY: { id: SupplyId; name: Record<OptService, string>; short: string; unit: string }[] = [
  { id: 'fix', name: { med: '보건진료소 신설', pha: '공공약국 유치', gro: '마을 공동 상점' }, short: '시설', unit: '곳' },
  { id: 'tour', name: { med: '순회 진료 버스', pha: '이동 약국 차량', gro: '이동 장터 트럭' }, short: '순회', unit: '대' },
  { id: 'drt', name: { med: '수요응답형 버스', pha: '수요응답형 버스', gro: '수요응답형 버스' }, short: 'DRT', unit: '권역' },
  { id: 'taxi', name: { med: '공공형 택시', pha: '공공형 택시', gro: '공공형 택시' }, short: '택시', unit: '면' },
  { id: 'tele', name: { med: '경로당 원격진료', pha: '원격 복약 상담', gro: '주문 배달 거점' }, short: '원격', unit: '곳' },
]
export const supplyName = (id: SupplyId, s: OptService) => SUPPLY.find((x) => x.id === id)!.name[s]

// [설치비(억), 연 운영비(억), 내용연수(년)] — 모두 가정값. 가정과 단가 화면에서 고친다
type Cost = [number, number, number]
export interface Assumptions {
  tele: number // 원격 서비스 효과계수 (0.3~0.7 민감도)
  taxi: number // 공공형 택시 효과계수 (예약·이용 제약)
  tourWeekly: number // 순회 서비스 주당 정차 횟수
  costs: Record<OptService, Record<SupplyId, Cost>>
}
export const defaultAssumptions = (): Assumptions => ({
  tele: 0.5,
  taxi: 0.6,
  tourWeekly: 2,
  costs: {
    med: { fix: [12, 2.4, 20], tour: [2.5, 1.1, 8], drt: [0.9, 0.8, 8], taxi: [0, 0.18, 1], tele: [0.03, 0.05, 5] },
    pha: { fix: [0, 0.8, 10], tour: [1.5, 0.6, 8], drt: [0.9, 0.8, 8], taxi: [0, 0.18, 1], tele: [0.02, 0.04, 5] },
    gro: { fix: [1.5, 0.5, 15], tour: [1.0, 0.5, 8], drt: [0.9, 0.8, 8], taxi: [0, 0.18, 1], tele: [0.01, 0.06, 5] },
  },
})
export const yearCost = ([cap, op, life]: Cost) => (life ? cap / life : 0) + op

export interface Goal {
  service: OptService
  mode: ModeId
  age: AgeId
  T: number
  target: number // 0~1
  budget: number // 연 억
  allowed: Record<SupplyId, boolean>
}

export interface Pick {
  type: SupplyId
  village: number // 시설·원격·택시는 그 마을, DRT는 권역 중심, 순회는 출발지(읍)
  stops?: number[] // 순회 정차 마을 (돌아오는 순서)
  cells: number[]
  factor: number // 그 칸을 얼마나 '닿은 것'으로 칠지 (원격 0.5 등)
  year: number
  cap: number
  key: string
}

export interface Plan {
  id: PlanId
  name: string
  desc: string
  types: SupplyId[]
  picks: Pick[]
  year: number
  cap: number
  base: number // 지금 달성률
  rate: number // 안 시행 후 달성률
  future: number // 10년 뒤 달성률
  gapBefore: number
  gapAfter: number
  meets: boolean
  withinBudget: boolean
  robust: boolean // 효과계수 0.3, 단가 +20%에서도 목표와 예산을 지키는지
  baseCov: Float32Array
  cov: Float32Array
  recommended: boolean
}

const weight = (c: C, age: AgeId, future = false) => (age === 'a80' ? (future ? c.f80 : c.p80) : age === 'a65' ? c.p65 : c.pop)
const optMode = (mode: ModeId): ModeId => (mode === 'walk' ? 'bus' : mode)

// 후보 계산이 무거운 것(시설 신설이 닿는 칸)은 모델별로 기억해 둔다
const cache = new WeakMap<Model, Map<string, number[]>>()
function memo(m: Model, key: string, f: () => number[]) {
  let mm = cache.get(m)
  if (!mm) cache.set(m, (mm = new Map()))
  let v = mm.get(key)
  if (!v) mm.set(key, (v = f()))
  return v
}
// 순회 정차·원격 거점이 닿는 범위: 그 마을에 속하고 대표점에서 2km 안의 칸
const near2km = (m: Model, vi: number) => memo(m, `w${vi}`, () => m.cells.filter((c) => c.village === vi && c.dv <= 2).map((c) => c.i))

function nearestFacKm(m: Model, s: OptService, c: C) {
  let best = Infinity
  for (const f of m.fac[s]) { const v = m.villages[f.village]; best = Math.min(best, Math.hypot(v.x - c.cx, v.y - c.cy)) }
  return best
}

function orderTour(m: Model, start: number, stops: number[]) {
  const out: number[] = [], left = stops.slice()
  let cur = m.villages[start]
  while (left.length) {
    let bi = 0, bd = 1e9
    left.forEach((s, k) => { const d = Math.hypot(m.villages[s].x - cur.x, m.villages[s].y - cur.y); if (d < bd) { bd = d; bi = k } })
    cur = m.villages[left[bi]]
    out.push(left.splice(bi, 1)[0])
  }
  return out
}
function tourKm(m: Model, start: number, stops: number[]) {
  const o = orderTour(m, start, stops)
  let cur = m.villages[start], L = 0
  for (const s of o) { L += Math.hypot(m.villages[s].x - cur.x, m.villages[s].y - cur.y) * 1.4; cur = m.villages[s] }
  return L + Math.hypot(cur.x - m.villages[start].x, cur.y - m.villages[start].y) * 1.4
}

const gainOf = (cells: number[], f: number, cov: Float32Array, w: Float32Array) => cells.reduce((g, i) => (f > cov[i] ? g + (f - cov[i]) * w[i] : g), 0)

function bestCandidate(m: Model, g: Goal, a: Assumptions, type: SupplyId, cov: Float32Array, w: Float32Array, used: Set<string>): Omit<Pick, 'year' | 'cap'> & { gain: number } | null {
  const mode = optMode(g.mode), s = g.service
  const town = m.villages.find((v) => v.isCenter && v.busRuns >= 30) ?? m.villages[0]
  let best: (Omit<Pick, 'year' | 'cap'> & { gain: number }) | null = null
  const offer = (p: Omit<Pick, 'year' | 'cap'>) => {
    const gain = gainOf(p.cells, p.factor, cov, w)
    if (!best || gain > best.gain) best = { ...p, gain }
  }
  const facVillages = new Set(m.fac[s].map((f) => f.village))
  if (type === 'fix' || type === 'tele') {
    for (const v of m.villages) {
      const key = type + v.id
      if (used.has(key) || (type === 'fix' && facVillages.has(v.id))) continue
      const cells = type === 'fix'
        ? memo(m, `fix${v.id}${mode}${g.T}`, () => m.cells.filter((c) => timeTo(m, c, v.id, mode) <= g.T).map((c) => c.i))
        : near2km(m, v.id)
      offer({ type, village: v.id, cells, factor: type === 'tele' ? a.tele : 1, key })
    }
  } else if (type === 'drt') {
    // 읍면 소재지를 중심으로 9km 권역, 부르면 오는 차로 시설까지 (대기 20분 포함) 기준 안에 닿는 칸
    for (const v of m.villages.filter((x) => x.isCenter)) {
      const key = 'drt' + v.id
      if (used.has(key)) continue
      const cells = memo(m, `drt${v.id}${s}${g.T}`, () => m.cells.filter((c) => Math.hypot(c.cx - v.x, c.cy - v.y) <= 9 && tCar(nearestFacKm(m, s, c)) + 20 <= g.T).map((c) => c.i))
      offer({ type, village: v.id, cells, factor: 1, key })
    }
  } else if (type === 'taxi') {
    // 면 단위로 운영. 마을 대표점 1.5km 안에 사는 사람이 불러서 (대기 15분) 시설까지
    for (const v of m.villages.filter((x) => x.isCenter)) {
      const key = 'taxi' + v.myeon
      if (used.has(key)) continue
      const cells = memo(m, `taxi${v.myeon}${s}${g.T}`, () => m.cells.filter((c) => c.myeon === v.myeon && c.dv <= 1.5 && tCar(nearestFacKm(m, s, c)) + 15 <= g.T).map((c) => c.i))
      offer({ type, village: v.id, cells, factor: a.taxi, key })
    }
  } else if (type === 'tour') {
    if (a.tourWeekly < 2) return null // 주 2회 이상 정차할 때만 닿은 것으로 친다
    const stops: number[] = [], tmp = new Float32Array(cov), covered = new Set<number>()
    for (let k = 0; k < 8; k++) {
      let pick = -1, pg = 0
      for (const v of m.villages) {
        if (v.id === town.id || stops.includes(v.id) || used.has('stop' + v.id)) continue
        if (tourKm(m, town.id, [...stops, v.id]) > 110) continue // 하루 운행 거리
        const gg = gainOf(near2km(m, v.id), 1, tmp, w)
        if (gg > pg) { pg = gg; pick = v.id }
      }
      if (pick < 0 || pg < 1) break
      stops.push(pick)
      near2km(m, pick).forEach((i) => { tmp[i] = 1; covered.add(i) })
    }
    if (!stops.length) return null
    offer({ type, village: town.id, stops: orderTour(m, town.id, stops), cells: [...covered], factor: 1, key: 'tour' + stops.join('-') })
  }
  return best
}

// seed: 처음 하나는 이 수단으로 고른다 (시설 위주 안이 시설 없이 끝나지 않게)
function greedy(m: Model, g: Goal, a: Assumptions, types: SupplyId[], budget: number, stopAt: number | null, seed?: SupplyId) {
  const mode = optMode(g.mode)
  const t = m.times[g.service][mode].t
  const w = new Float32Array(m.cells.length)
  let tot = 0
  m.cells.forEach((c, i) => { w[i] = weight(c, g.age); tot += w[i] })
  const baseCov = new Float32Array(m.cells.length)
  let cur = 0
  m.cells.forEach((_, i) => { baseCov[i] = t[i] <= g.T ? 1 : 0; cur += baseCov[i] * w[i] })
  const base = cur
  const cov = new Float32Array(baseCov)
  const picks: Pick[] = [], used = new Set<string>()
  let year = 0, cap = 0
  for (let it = 0; it < 40; it++) {
    if (stopAt != null && cur / tot >= stopAt) break
    const choose = (pool: SupplyId[]) => {
      let best: (Pick & { gain: number; ratio: number }) | null = null
      for (const ty of pool) {
        if (!g.allowed[ty]) continue
        const c = bestCandidate(m, g, a, ty, cov, w, used)
        if (!c || c.gain < 1) continue
        const y = yearCost(a.costs[g.service][ty])
        if (year + y > budget + 1e-9) continue
        const ratio = c.gain / Math.max(y, 0.01)
        if (!best || ratio > best.ratio) best = { ...c, year: y, cap: a.costs[g.service][ty][0], ratio }
      }
      return best
    }
    // 첫 공급은 seed 수단으로 (예산이 모자라면 나머지 수단으로)
    const best = (seed && it === 0 ? choose([seed]) : null) ?? choose(types)
    if (!best) break
    const { gain: _g, ratio: _r, ...pick } = best
    picks.push(pick)
    year += pick.year
    cap += pick.cap
    used.add(pick.key)
    pick.stops?.forEach((s) => used.add('stop' + s))
    for (const i of pick.cells) if (pick.factor > cov[i]) { cur += (pick.factor - cov[i]) * w[i]; cov[i] = pick.factor }
  }
  return { picks, year, cap, base: base / tot, rate: cur / tot, gapBefore: tot - base, gapAfter: tot - cur, baseCov, cov }
}

// 고른 공급을 그대로 두고 효과계수만 바꿨을 때 달성률 (민감도 확인용)
export function rateWith(m: Model, g: Goal, picks: Pick[], a: Assumptions, future = false) {
  const t = m.times[g.service][optMode(g.mode)].t
  const cov = new Float32Array(m.cells.length)
  m.cells.forEach((_, i) => { cov[i] = t[i] <= g.T ? 1 : 0 })
  for (const p of picks) {
    const f = p.type === 'tele' ? a.tele : p.type === 'taxi' ? a.taxi : p.factor
    for (const i of p.cells) cov[i] = Math.max(cov[i], f)
  }
  let tot = 0, got = 0
  m.cells.forEach((c, i) => { const w = weight(c, g.age, future); tot += w; got += cov[i] * w })
  return tot ? got / tot : 0
}

const PLAN_DEFS: { id: PlanId; name: string; desc: string; types: SupplyId[] }[] = [
  { id: 'A', name: '시설 위주 안', desc: '보건진료소를 새로 짓고 수요응답형으로 잇는다', types: ['fix', 'drt'] },
  { id: 'B', name: '이동형 위주 안', desc: '순회·수요응답형·택시·원격으로 찾아간다', types: ['tour', 'drt', 'taxi', 'tele'] },
  { id: 'C', name: '최소 비용 안', desc: '모든 수단을 섞어 목표를 가장 싸게 맞춘다', types: ['fix', 'tour', 'drt', 'taxi', 'tele'] },
]

export function planSet(m: Model, g: Goal, a: Assumptions): Plan[] {
  const plans: Plan[] = PLAN_DEFS.map((d) => {
    // A·B는 예산 안에서 목표보다 3%p 여유 있게(그 수단만으로), C는 모든 수단으로 목표를 맞추는 최소 비용.
    // C는 예산과 상관없이 구하고, 예산을 넘으면 넘는다고 표시한다
    const r = d.id === 'C' ? greedy(m, g, a, d.types, 30, g.target) : greedy(m, g, a, d.types, g.budget, Math.min(1, g.target + 0.03), d.id === 'A' ? 'fix' : undefined)
    const meets = r.rate >= g.target - 1e-9
    const withinBudget = r.year <= g.budget + 1e-9
    const worse = { ...a, tele: Math.min(a.tele, 0.3), taxi: Math.min(a.taxi, 0.4) }
    const robust = meets && withinBudget && rateWith(m, g, r.picks, worse) >= g.target - 1e-9 && r.year * 1.2 <= g.budget + 1e-9
    return { ...d, ...r, future: rateWith(m, g, r.picks, a, true), meets, withinBudget, robust, recommended: false }
  })
  const ok = plans.filter((p) => p.meets && p.withinBudget)
  const pool = ok.filter((p) => p.robust).length ? ok.filter((p) => p.robust) : ok
  const rec = pool.length ? pool.reduce((b, p) => (p.year < b.year ? p : b)) : plans.reduce((b, p) => (p.rate > b.rate ? p : b))
  rec.recommended = true
  return plans
}

// formal: 검토 메모(공문체)용 문장
export function recommendReason(plans: Plan[], g: Goal, formal = false) {
  const rec = plans.find((p) => p.recommended)!
  const pctT = Math.round(g.target * 100)
  const [a, b, c] = formal ? ['골랐다', '가장 적다', '있다'] : ['골랐어요', '가장 적어요', '있어요']
  if (!rec.meets || !rec.withinBudget) return `예산 연 ${g.budget}억 안에서 목표 ${pctT}%를 넘기는 안이 없어, 달성률이 가장 높은 ${rec.name}을 ${a}.`
  if (rec.robust) return `목표 ${pctT}%를 넘기는 안 가운데, 원격 효과가 0.3으로 낮아지고 단가가 20% 올라도 목표와 예산을 지키는 안 중 연 비용이 ${b}.`
  return `목표 ${pctT}%를 넘기는 안 가운데 연 비용이 ${b}. 다만 원격 효과가 낮아지거나 단가가 오르면 목표를 못 지킬 수 ${c}.`
}

export function summarize(p: Plan, s: OptService) {
  const cnt = new Map<SupplyId, number>()
  p.picks.forEach((x) => cnt.set(x.type, (cnt.get(x.type) ?? 0) + 1))
  if (!cnt.size) return '추가 공급 없음'
  return [...cnt].map(([id, n]) => `${supplyName(id, s)} ${n}${SUPPLY.find((x) => x.id === id)!.unit}`).join(', ')
}
