// 서버 장애 때만 쓰는 추정 계산: 이미 받은 마을 원자료와 화면의 가정값으로 대안 3개를 브라우저에서 다시 계산한다.
// 서버의 OR-Tools 최적화를 복제한 것이 아니라, 서버 응답으로 확인한 규칙에 맞춘 결정적 근사다. 규칙과 근거는 docs/estimated-simulation.md
//  - fix: 신설한 마을과, 새 진료소까지 자가용 기준 안이면서 버스로 갈 수 있는 '너무 먼' 마을에 닿는다 · drt: 그 읍면의 '버스가 없어 못 감' 마을만 닿는다(너무 먼 마을은 그대로)
//  - tele: 경로당이 있는 마을만, 효과 계수만큼만 닿는다 · tour: 정차한 마을만, 주 2회 이상일 때만 닿는다
//  - 한 마을의 coverage는 수단별 값 중 큰 값이다(같은 주민을 두 번 세지 않는다)
import { judgeLocal } from './judge'
import type { Cost, EstimateInfo, Judge, JudgedVillage, Pick, Plan, Plans, RawVillage, RegionData, Sensitivity, State, SupplyId } from './types'

export const TOUR_MAX_STOPS = 8 // 서버 응답 72개 지역에서 확인한 한 대의 최대 정차 수
export const TOUR_MAX_MINUTES = 165 // 레포트 각주의 순회 경로 기준: 보건소 → 정차 마을 → 보건소 자가용 시간
export const TOUR_MIN_WEEKLY = 2 // 서버는 주 1회면 순회 진료를 놓지 않는다(주 2~7회는 결과가 같다)
const PLAN_NAMES = ['비용 절감안', '균형안', '적극 투자안']
export const TYPE_NAME: Record<SupplyId, string> = { fix: '보건진료소 신설', drt: '수요응답형 버스', tour: '순회 진료 버스', tele: '경로당 원격진료' }
const UNIT: Record<SupplyId, string> = { fix: '곳', drt: '대', tour: '대', tele: '곳' }
const PICK_ORDER: SupplyId[] = ['fix', 'drt', 'tour', 'tele']
const DENSE_LEVELS = 16 // 수량 후보: 이 수까지는 하나씩, 넘으면 간격을 넓힌다(아주 싼 단가에서 계산이 폭증하지 않게)
const EPS = 1e-9

// 추정조차 할 수 없을 때(자료 없음 · 값이 잘못됨). message는 화면에 그대로 보여 줘도 된다
export class EstimateError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const yearCost = (c: Cost) => c.install / c.years + c.yearly

type Rule = { age: State['age']; criteria: State['criteria'] }

// 공백 마을 하나. 계산은 공백 마을만 놓고 한다
interface Gap { i: number; v: RawVillage; people: number; state: 1 | 2; myeon: number }
interface Prepared {
  data: RegionData
  basis: JudgedVillage[]
  total: number
  reachedBase: number // 원래 갈 수 있는 주민
  gaps: Gap[]
  myeonNames: string[]
  teleOrder: number[] // 경로당이 있는 공백 마을(주민 많은 순)
  tourDepot: number[] // 보건소 ↔ 공백 마을 도로 시간 상한(분). 모르면 Infinity
  tourLeg: Float64Array // 공백 마을 ↔ 공백 마을 도로 시간 상한(분). 모르면 Infinity
  fixReach: number[][] // 그 마을에 진료소를 열면 함께 닿는 공백 마을: '너무 먼' 마을 중 버스로 갈 수 있고 도로 시간 상한이 자가용 기준 안인 곳
  routes: Map<string, number[]> // 같은 '남은 공백'에는 같은 노선: 조합마다 다시 만들지 않는다
}

// 값 검사: 잘못된 값을 조용히 0으로 바꾸면 그럴듯한 숫자가 나오므로, 추정하지 않고 이유를 알린다
function checkState(st: State) {
  const costs = st.assumptions?.costs
  if (!costs) throw new EstimateError('bad-state', '가정값이 없어 추정할 수 없어요.')
  for (const k of PICK_ORDER) {
    const c = costs[k]
    if (!c || !(c.install >= 0) || !(c.yearly >= 0) || !(c.years > 0) || !Number.isFinite(c.install + c.yearly + c.years)) throw new EstimateError('bad-state', '공급수단 단가가 올바르지 않아 추정할 수 없어요.')
  }
  if (!Number.isFinite(st.budget) || st.budget < 0) throw new EstimateError('bad-state', '연 예산 값이 올바르지 않아 추정할 수 없어요.')
  if (!Number.isFinite(st.target)) throw new EstimateError('bad-state', '목표 달성률 값이 올바르지 않아 추정할 수 없어요.')
  if (!(st.assumptions.teleEffect >= 0 && st.assumptions.teleEffect <= 1)) throw new EstimateError('bad-state', '원격진료 효과 값이 올바르지 않아 추정할 수 없어요.')
}
function checkData(data: RegionData | null | undefined, age: Rule['age']) {
  if (!data || !Array.isArray(data.villages) || !data.villages.length) throw new EstimateError('no-data', '이 지역의 마을 자료가 없어 추정할 수 없어요.')
  const ids = new Set<string>()
  for (const v of data.villages) {
    const p = v.pop?.[age]
    if (!v.id || ids.has(v.id) || !Number.isFinite(p) || p < 0) throw new EstimateError('bad-data', '마을 자료 형식이 올바르지 않아 추정할 수 없어요.')
    ids.add(v.id)
  }
}

// 도로 시간 상한: 서버가 준 '마을 → 시설' 도로 시간들을 잇는 그래프의 최단 경로. 시설을 거쳐 가는 길도 실제 길이므로 진짜 시간은 이 값을 넘지 않는다(양방향 시간은 같다고 본다).
// 직선거리는 쓰지 않는다. 이어지지 않으면 모른다(Infinity) → 그 구간은 쓰지 않는다
function villageAnchors(v: RawVillage, inVillage: string[]) {
  const m = new Map<string, number>()
  const put = (name: string | undefined, min: number | undefined | null) => {
    if (name && min != null && Number.isFinite(min) && min >= 0 && !(m.get(name)! <= min)) m.set(name, min)
  }
  const n = v.nearest
  for (const h of [n?.med, n?.er?.regional, n?.er?.center, n?.er?.facility, n?.byKind?.hospital, n?.byKind?.clinic, n?.byKind?.public]) put(h?.name, h?.minutes)
  for (const name of inVillage) put(name, 0) // 마을 안 시설은 그 마을과 같은 자리로 본다
  return m
}
function roadGraph(data: RegionData) {
  const inVillage = new Map<string, string[]>()
  for (const f of data.facilities ?? []) if (f.village) inVillage.set(f.village, [...(inVillage.get(f.village) ?? []), f.name])
  const index = new Map<string, number>(data.villages.map((v, i) => [v.id, i]))
  const edges: [number, number][][] = data.villages.map(() => [])
  const facility = new Map<string, number>()
  data.villages.forEach((v, i) => {
    for (const [name, t] of villageAnchors(v, inVillage.get(v.id) ?? [])) {
      let f = facility.get(name)
      if (f == null) { f = edges.length; facility.set(name, f); edges.push([]) }
      edges[i].push([f, t]); edges[f].push([i, t])
    }
  })
  // 출발점 하나에서 모든 곳까지 최단 시간. 점이 수백 개라 단순한 방식으로 충분하다
  const from = (start: number) => {
    const dist = new Float64Array(edges.length).fill(Infinity), done = new Uint8Array(edges.length)
    dist[start] = 0
    for (;;) {
      let u = -1
      for (let i = 0; i < edges.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i
      if (u < 0) return dist
      done[u] = 1
      for (const [w, t] of edges[u]) if (dist[u] + t < dist[w]) dist[w] = dist[u] + t
    }
  }
  return { index, from }
}

// 판정과 도로 시간 표는 기준 · 나이대가 같으면 그대로라 한 번만 만든다(What-if가 같은 조건으로 여러 번 부른다)
const prepared = new WeakMap<RegionData, Map<string, Prepared>>()
function prepare(data: RegionData, rule: Rule): Prepared {
  const key = JSON.stringify([rule.age, rule.criteria])
  let byRule = prepared.get(data)
  if (!byRule) prepared.set(data, (byRule = new Map()))
  const hit = byRule.get(key)
  if (hit) return hit
  // 서버 대안은 service와 상관없이 '병원 가는 길'(모든 병의원 · 대중교통) 판정에서 출발한다(서버 응답으로 확인). 진단 화면의 자가용 탭 · 시설 필터는 여기 들어오지 않는다
  const judged = judgeLocal(data, { service: 'med', age: rule.age, criteria: rule.criteria }, 'med')
  const nameOf = new Map((data.myeons ?? []).map((m) => [m.id, m.name]))
  const basis = judged.villages.map((v) => ({ ...v, myeon: nameOf.get(v.myeon) ?? v.myeon }))
  const myeonNames: string[] = []
  const myeonIdx = new Map<string, number>()
  const gaps: Gap[] = []
  let reachedBase = 0
  basis.forEach((b, i) => {
    if (b.state === 0) { reachedBase += b.people; return }
    if (!myeonIdx.has(b.myeon)) { myeonIdx.set(b.myeon, myeonNames.length); myeonNames.push(b.myeon) }
    gaps.push({ i, v: data.villages[i], people: b.people, state: b.state, myeon: myeonIdx.get(b.myeon)! })
  })
  const G = gaps.length
  const graph = roadGraph(data)
  const depotAt = graph.index.get(data.depot)
  const depotDist = depotAt == null ? null : graph.from(depotAt)
  const tourDepot = gaps.map((g) => (depotDist ? depotDist[g.i] : Infinity))
  const tourLeg = new Float64Array(G * G).fill(Infinity)
  for (let a = 0; a < G; a++) {
    const d = graph.from(gaps[a].i)
    for (let b = 0; b < G; b++) if (a !== b) tourLeg[a * G + b] = d[gaps[b].i]
  }
  // 버스 이용 판정이 '갈 수 있음'이면 버스 조건을 채운 마을이다(판정 규칙을 다시 쓰지 않는다)
  const busOk = judgeLocal(data, { service: 'bus', age: rule.age, criteria: rule.criteria }, 'med').villages
  const fixReach = gaps.map((_, f) => gaps.flatMap((g, k) => (k !== f && g.state === 2 && busOk[g.i].state === 0 && tourLeg[f * G + k] <= rule.criteria.carMinutes ? [k] : [])))
  const p: Prepared = {
    data, basis, total: judged.summary.total, reachedBase, gaps, myeonNames,
    teleOrder: gaps.map((g, k) => ({ g, k })).filter(({ g }) => g.v.seniorCenter && g.people > 0).sort((x, y) => y.g.people - x.g.people || (x.g.v.id < y.g.v.id ? -1 : 1)).map(({ k }) => k),
    tourDepot, tourLeg, fixReach, routes: new Map(),
  }
  byRule.set(key, p)
  return p
}

// 순회 노선 하나: 남은 공백 마을을 도로 시간 상한이 왕복 165분 안인 동안 끼워 넣는다(가장 적게 늘어나는 자리에). 정차 8곳까지.
// 주민 많은 마을부터(A)와 늘어나는 시간 대비 주민이 많은 마을부터(B)를 다 만들어 더 많이 닿는 쪽을 쓴다
function routeFor(p: Prepared, covered: Uint8Array): number[] {
  const key = covered.join('')
  const hit = p.routes.get(key)
  if (hit) return hit
  const G = p.gaps.length
  const leg = (a: number, b: number) => (a < 0 ? p.tourDepot[b] : b < 0 ? p.tourDepot[a] : p.tourLeg[a * G + b])
  const open: number[] = []
  for (let k = 0; k < G; k++) if (!covered[k] && p.gaps[k].people > 0 && 2 * p.tourDepot[k] <= TOUR_MAX_MINUTES) open.push(k)
  const build = (score: (people: number, extra: number) => number) => {
    const route: number[] = []
    let time = 0
    const left = new Set(open)
    while (route.length < TOUR_MAX_STOPS && left.size) {
      let best = -1, bestPos = 0, bestExtra = 0, bestScore = -Infinity
      for (const k of left) {
        let extra = Infinity, pos = 0
        for (let at = 0; at <= route.length; at++) {
          const a = at === 0 ? -1 : route[at - 1], b = at === route.length ? -1 : route[at]
          const d = leg(a, k) + leg(k, b) - (route.length ? leg(a, b) : 0)
          if (d < extra) { extra = d; pos = at }
        }
        if (time + extra > TOUR_MAX_MINUTES) continue
        const s = score(p.gaps[k].people, extra)
        if (s > bestScore + EPS || (Math.abs(s - bestScore) <= EPS && best >= 0 && p.gaps[k].v.id < p.gaps[best].v.id)) { best = k; bestPos = pos; bestExtra = extra; bestScore = s }
      }
      if (best < 0) break
      route.splice(bestPos, 0, best)
      time += bestExtra
      left.delete(best)
    }
    return route
  }
  const sum = (r: number[]) => r.reduce((a, k) => a + p.gaps[k].people, 0)
  const a = build((people) => people), b = build((people, extra) => people / (extra + 1))
  const route = sum(b) > sum(a) ? b : a
  p.routes.set(key, route)
  return route
}

interface Quota { fix: number; tour: number; drt: number }
interface Placed { fix: number[]; drt: number[]; tour: number[][]; covered: Uint8Array; reached: number }
interface Cand { q: Placed; teles: number; year: number; reached: number; count: number }

// 조합 하나(수단별 수량)를 실제 마을에 놓는다: 매번 새로 닿는 주민이 가장 많은 것부터. 원격진료는 나머지를 놓은 뒤라 같은 주민을 겹쳐 세지 않는다
function place(p: Prepared, q: Quota): Placed {
  const G = p.gaps.length
  const covered = new Uint8Array(G)
  const fix: number[] = [], drt: number[] = [], tour: number[][] = []
  const usedMyeon = new Set<number>()
  let left = { ...q }, reached = p.reachedBase
  while (left.fix + left.tour + left.drt > 0) {
    let bestGain = 0, bestType: 'fix' | 'drt' | 'tour' | null = null, bestFix = -1, bestDrt = -1
    let bestRoute: number[] | null = null
    if (left.drt > 0) {
      const gain = new Map<number, number>()
      for (let k = 0; k < G; k++) { const g = p.gaps[k]; if (!covered[k] && g.state === 1 && !usedMyeon.has(g.myeon)) gain.set(g.myeon, (gain.get(g.myeon) ?? 0) + g.people) }
      for (const [m, s] of gain) if (s > bestGain || (s === bestGain && s > 0 && bestType === 'drt' && p.myeonNames[m] < p.myeonNames[bestDrt])) { bestGain = s; bestType = 'drt'; bestDrt = m }
    }
    if (left.tour > 0) {
      const r = routeFor(p, covered)
      const s = r.reduce((a, k) => a + p.gaps[k].people, 0)
      if (s > bestGain) { bestGain = s; bestType = 'tour'; bestRoute = r }
    }
    if (left.fix > 0) {
      for (let k = 0; k < G; k++) {
        if (covered[k]) continue
        const s = p.fixReach[k].reduce((a, n) => a + (covered[n] ? 0 : p.gaps[n].people), p.gaps[k].people)
        if (s > bestGain) { bestGain = s; bestType = 'fix'; bestFix = k }
      }
    }
    if (!bestType) break // 더 놓아도 새로 닿는 주민이 없다: 놓지 않고 그 비용도 쓰지 않는다
    reached += bestGain
    if (bestType === 'fix') { fix.push(bestFix); covered[bestFix] = 1; for (const n of p.fixReach[bestFix]) covered[n] = 1; left = { ...left, fix: left.fix - 1 } }
    else if (bestType === 'drt') {
      drt.push(bestDrt); usedMyeon.add(bestDrt)
      for (let k = 0; k < G; k++) if (p.gaps[k].myeon === bestDrt && p.gaps[k].state === 1) covered[k] = 1
      left = { ...left, drt: left.drt - 1 }
    } else {
      tour.push(bestRoute!)
      for (const k of bestRoute!) covered[k] = 1
      left = { ...left, tour: left.tour - 1 }
    }
  }
  return { fix, drt, tour, covered, reached }
}

// 수단별 수량 후보(0, 1, 2 … limit). 예산과 상관없는 값이라 예산이 늘면 후보가 늘기만 한다 → 예산을 늘려 달성률이 떨어지는 일이 없다
function levels(limit: number) {
  const out: number[] = []
  for (let n = 0; n <= limit; n += n < DENSE_LEVELS ? 1 : Math.ceil(n / 8)) out.push(n)
  if (limit > 0 && out[out.length - 1] !== limit) out.push(limit)
  return out
}

function search(p: Prepared, st: State) {
  const a = st.assumptions, on = st.allowedSupply
  const unit = { fix: yearCost(a.costs.fix), tour: yearCost(a.costs.tour), drt: yearCost(a.costs.drt), tele: yearCost(a.costs.tele) }
  const budget = st.budget
  const useTour = !!on.tour && a.tourWeekly >= TOUR_MIN_WEEKLY
  const e = on.tele ? a.teleEffect : 0
  const drtCount = new Set(p.gaps.filter((g) => g.state === 1 && g.people > 0).map((g) => g.myeon)).size
  const peopleGaps = p.gaps.filter((g) => g.people > 0).length
  const fixes = on.fix ? levels(peopleGaps) : [0]
  const tours = useTour ? levels(peopleGaps) : [0]
  const drts = on.drt ? levels(drtCount) : [0]

  const total = p.total
  const meets = (reached: number) => total > 0 && reached / total >= st.target - 1e-12
  // 비교: 목표 안(k0 · k1) → 목표를 채우면 싼 것, 못 채우면 많이 닿는 것 / 적극 투자안(k2) → 많이 닿는 것, 같으면 싼 것. 먼저 찾은 것이 동률에서 이긴다
  const betterTarget = (x: Cand, y: Cand | null) => {
    if (!y) return true
    const mx = meets(x.reached), my = meets(y.reached)
    if (mx !== my) return mx
    if (mx) return x.year < y.year - EPS || (Math.abs(x.year - y.year) <= EPS && (x.reached > y.reached + EPS || (Math.abs(x.reached - y.reached) <= EPS && x.count < y.count)))
    return betterReach(x, y)
  }
  const betterReach = (x: Cand, y: Cand | null) => !y || x.reached > y.reached + EPS || (Math.abs(x.reached - y.reached) <= EPS && (x.year < y.year - EPS || (Math.abs(x.year - y.year) <= EPS && x.count < y.count)))
  let k0: Cand | null = null, k1: Cand | null = null, k2: Cand | null = null

  // 수량이 늘수록 비싸지므로 예산을 넘으면 그 줄은 끝이고, 더 놓아도 닿는 주민이 없으면 그보다 큰 수량은 볼 필요가 없다
  fixLoop: for (const nFix of fixes) {
    for (const nTour of tours) {
      for (const nDrt of drts) {
        if (nFix * unit.fix + nTour * unit.tour + nDrt * unit.drt > budget + EPS) { if (nDrt === 0 && nTour === 0) break fixLoop; break }
        const placed = place(p, { fix: nFix, tour: nTour, drt: nDrt })
        const baseYear = placed.fix.length * unit.fix + placed.tour.length * unit.tour + placed.drt.length * unit.drt // 실제로 놓은 수량의 비용
        const noTele: Cand = { q: placed, teles: 0, year: baseYear, reached: placed.reached, count: placed.fix.length + placed.tour.length + placed.drt.length }
        if (betterTarget(noTele, k1)) k1 = noTele
        if (betterTarget(noTele, k0)) k0 = noTele
        if (betterReach(noTele, k2)) k2 = noTele
        if (e > 0) {
          let year = baseYear, reached = placed.reached, teles = 0, hitTarget = meets(reached)
          for (const k of p.teleOrder) {
            if (placed.covered[k]) continue
            if (year + unit.tele > budget + EPS) break
            year += unit.tele; reached += p.gaps[k].people * e; teles++
            const c: Cand = { q: placed, teles, year, reached, count: noTele.count + teles }
            if (!hitTarget) { if (betterTarget(c, k0)) k0 = c; hitTarget = meets(reached) }
            if (betterReach(c, k2)) k2 = c
          }
        }
        if (placed.drt.length < nDrt) break
      }
    }
  }
  return { k0: k0!, k1: k1!, k2: k2!, unit, e }
}

const round = (x: number, digits: number) => { const f = 10 ** digits; return Math.round(x * f) / f }

function buildPlan(p: Prepared, st: State, k: number, c: Cand, unit: Record<SupplyId, number>, e: number): Plan {
  const G = p.gaps.length, costs = st.assumptions.costs
  const cov = new Float64Array(G)
  for (let g = 0; g < G; g++) if (c.q.covered[g]) cov[g] = 1
  const tele: number[] = []
  for (const g of p.teleOrder) {
    if (tele.length >= c.teles) break
    if (!c.q.covered[g]) { tele.push(g); cov[g] = e }
  }
  const byId = (x: number, y: number) => (p.gaps[x].v.id < p.gaps[y].v.id ? -1 : 1)
  const pick = (type: SupplyId, label: string, villages: string[], myeon: string | null): Pick => ({ type, typeName: TYPE_NAME[type], label: `${TYPE_NAME[type]} (${label})`, year: round(unit[type], 6), install: costs[type].install, villages, myeon })
  const picks: Pick[] = [
    ...[...c.q.fix].sort(byId).map((g) => pick('fix', p.gaps[g].v.name, [p.gaps[g].v.id], null)),
    ...[...c.q.drt].sort((x, y) => (p.myeonNames[x] < p.myeonNames[y] ? -1 : 1)).map((m) => pick('drt', `${p.myeonNames[m]} 권역`, [], p.myeonNames[m])),
    ...c.q.tour.map((r) => pick('tour', `${r.length}곳 정차`, r.map((g) => p.gaps[g].v.id), null)),
    ...tele.sort(byId).map((g) => pick('tele', p.gaps[g].v.name, [p.gaps[g].v.id], null)),
  ]
  const coverage = new Array<number>(p.basis.length)
  p.basis.forEach((b, i) => { coverage[i] = b.state === 0 ? 1 : 0 })
  p.gaps.forEach((g, n) => { coverage[g.i] = cov[n] })
  const counts = PICK_ORDER.flatMap((t) => { const n = picks.filter((x) => x.type === t).length; return n ? [`${TYPE_NAME[t]} ${n}${UNIT[t]}`] : [] })
  const reached = p.reachedBase + p.gaps.reduce((a, g, n) => a + g.people * cov[n], 0)
  const total = p.total
  const year = picks.reduce((a, x) => a + unit[x.type], 0)
  // 10년 뒤 달성률: 서버와 같은 식(마을 80세 이상 × a80In10y가 10년 뒤 주민). 80세 이상 기준에서만 계산한다
  let future: number | null = null
  if (st.age === 'a80') {
    let top = 0, bottom = 0, ok = true
    p.basis.forEach((_, i) => {
      const w = p.data.villages[i].pop.a80 * p.data.villages[i].a80In10y
      if (!Number.isFinite(w)) ok = false
      top += w * coverage[i]; bottom += w
    })
    future = ok && bottom > 0 ? round(top / bottom, 4) : null
  }
  return {
    k, name: PLAN_NAMES[k], summary: counts.join(', ') || '추가 공급 없음', picks,
    year: round(year, 6), install: round(picks.reduce((a, x) => a + x.install, 0), 6),
    baseRate: round(p.reachedBase / total, 4), rate: round(reached / total, 4), future,
    gapBefore: total - p.reachedBase, gapAfter: Math.max(0, round(total - reached, 1)),
    meetsTarget: reached / total >= st.target - 1e-12,
    withinBudget: year <= st.budget + EPS,
    timedOut: false, // 계산 시간을 끊지 않는다. 근사라는 사실은 출처(추정)로 알린다
    sameAs: null, recommended: false, coverage,
  }
}

const signature = (plan: Plan) => JSON.stringify(plan.picks.map((x) => [x.type, x.myeon, [...x.villages].sort()]).sort())

export function estimatePlans(data: RegionData, st: State): Plans {
  checkState(st)
  checkData(data, st.age)
  const p = prepare(data, st)
  if (p.total <= 0) throw new EstimateError('no-population', '이 나이대 주민 자료가 없어 달성률을 계산할 수 없어요.')
  const { k0, k1, k2, unit, e } = search(p, st)
  const plans = [buildPlan(p, st, 0, k0, unit, e), buildPlan(p, st, 1, k1, unit, e), buildPlan(p, st, 2, k2, unit, e)]
  plans.forEach((plan, i) => {
    const same = plans.slice(0, i).find((x) => signature(x) === signature(plan))
    plan.sameAs = same ? same.k : null
  })
  // 추천 순서: 균형안이 목표를 채우면 균형안, 아니면 비용 절감안, 둘 다 못 채우면 달성률이 가장 높은 안(같으면 앞 번호)
  const rec = plans[1].meetsTarget && plans[1].withinBudget ? 1 : plans[0].meetsTarget && plans[0].withinBudget ? 0
    : plans.reduce((b, x) => (x.rate > plans[b].rate ? x.k : b), 0)
  plans[rec].recommended = true
  return { service: st.service, age: st.age, target: st.target, budget: st.budget, recommended: rec, plans, estimate: estimateInfo(p, st) }
}

function estimateInfo(p: Prepared, st: State): EstimateInfo {
  const notes = ['대안은 조합을 나열해 탐욕적으로 배치한 근사 결과예요. 가장 싸거나 가장 많이 닿는 조합이라고 단정할 수 없어요.']
  if (st.allowedSupply.tour) {
    if (st.assumptions.tourWeekly < TOUR_MIN_WEEKLY) notes.push(`순회 진료 버스는 주 ${TOUR_MIN_WEEKLY}회 이상일 때만 넣었어요(서버와 같은 규칙).`)
    else {
      const far = p.tourDepot.filter((t, k) => p.gaps[k].people > 0 && !(2 * t <= TOUR_MAX_MINUTES)).length
      notes.push(`순회 노선은 도로 시간 자료로 왕복 ${TOUR_MAX_MINUTES}분 안임을 확인한 구간만 잇고 실제 경로를 찾지는 않았어요.${far ? ` 이를 확인하지 못한 공백 마을 ${far}곳은 정차에서 뺐어요.` : ''}`)
    }
  }
  return { basis: p.basis, notes }
}

// 단가 민감도: 단가를 ±20% 바꿔 같은 알고리즘으로 처음부터 다시 계산한다(비용에 0.8 · 1.2만 곱하지 않는다)
export function estimateSensitivity(data: RegionData, st: State): Sensitivity {
  const scaled = (f: number): State => ({
    ...st,
    assumptions: {
      ...st.assumptions,
      costs: Object.fromEntries(PICK_ORDER.map((k) => { const c = st.assumptions.costs[k]; return [k, { ...c, install: c.install * f, yearly: c.yearly * f }] })) as State['assumptions']['costs'],
    },
  })
  const lite = (ps: Plans) => {
    const r = ps.plans[ps.recommended]
    return { lite: { k: r.k, name: r.name, rate: r.rate, year: r.year, summary: r.summary }, sig: signature(r) }
  }
  const base = lite(estimatePlans(data, st)), lo = lite(estimatePlans(data, scaled(0.8))), hi = lite(estimatePlans(data, scaled(1.2)))
  return { base: base.lite, lo: lo.lite, hi: hi.lite, same: lo.sig === base.sig && hi.sig === base.sig }
}

// 서버 판정을 받지 못했을 때 쓰는 브라우저 판정(서버 응답과 같은 모양, 마을 순서는 원자료 그대로). top · busReasons는 서버만 아는 설명이라 비워 둔다
export function estimateJudge(data: RegionData, st: State): Judge {
  checkData(data, st.age)
  const local = judgeLocal(data, st, 'med')
  const nameOf = new Map((data.myeons ?? []).map((m) => [m.id, m.name]))
  return {
    service: st.service, age: st.age, tier: data.tier, town: data.town, summary: local.summary, busReasons: null, top: [],
    villages: local.villages.map((v) => ({ ...v, myeon: nameOf.get(v.myeon) ?? v.myeon })),
    facilities: (data.facilities ?? []).map(({ id, name, kind, village }) => ({ id, name, kind, village })),
  }
}

// 고른 안의 coverage를 마을 id로 잇는다. 추정이면 그 추정의 판정, 서버 안이면 판정 응답(둘 다 없으면 잇지 않는다)과 같은 순서다
export function coverageById(plans: Plans | null | undefined, plan: Plan | null | undefined, judged: { id: string }[] | null | undefined) {
  const order = plans?.estimate?.basis ?? judged
  if (!plan || !order || order.length !== plan.coverage.length) return null
  return new Map(order.map((v, i) => [v.id, plan.coverage[i]]))
}
