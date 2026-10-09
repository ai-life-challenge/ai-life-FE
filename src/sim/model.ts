// 시뮬레이션 엔진 (구현안 4장).
// 지표 → 점수(D2-C) → 레버 효과(체감함수, D6) → 1억 단위 greedy 배분(4-4) → 전/후 비교.
// 모든 계산은 즉시 끝나므로 브라우저에서 바로 돌린다. 화면 연출(블록 쌓기)은 steps를 재생할 뿐이다.
import type { Region } from '../data/regions'

export type LeverId = 'er' | 'doc' | 'bus' | 'drt' | 'safety' | 'struct'
export type PresetId = 'med' | 'bal' | 'safe'
export type CostLevel = 'low' | 'mid' | 'high'
export type Costs = Record<LeverId, Record<CostLevel, number>> // 억 원 / 단위·년
export type Alloc = Record<LeverId, number> // 레버별 투입액(억)

// ---------- 기준값과 효과 가정 (S7에 그대로 공개) ----------
export const STD = {
  theta: 0.27, // 응급의료 취약지 기준 (27%/30% 혼재 → 설정값)
  msTarget: 0.8, // 대중교통 최소서비스 확보 기준
  natD: 2.2, // 인구 1천명당 의사 수 전국 평균
  natAR: 4.9, // 인구 10만명당 교통사고 사망자 전국 평균
  htFull: 120, // 병원까지 대중교통시간 이 값이면 100점 (구현안은 60분, 예시 지역이 60분을 넘어 120분으로 둠)
  ptLimit: 60, // 대중교통 이용자는 병원까지 60분을 기준으로 본다
  ptSpread: 0.6, // 마을마다 대중교통시간이 평균 ±60% 안에 고르게 퍼져 있다고 본다
  tauPerElderly: 0.5, // 대중교통 의존 비율 τ = 고령비율 × 0.5
  deathCost: 5.3379, // 교통사고 사망 1명 사회적 비용(억, 도로교통공단 2022)
}
export const FX = {
  erK: 0.6, // 응급 거점 1개소당 E30 감소 속도 (E30 × e^(-k·n))
  erE60: 0.5, // 지역 거점은 권역센터 60분 접근은 절반만 개선
  docMax: 20, // 의료인력 지원 상한(명), 체감 기준
  drtCover: 1500, // DRT 1대가 맡는 사각지역 인구
  drtWalkCut: 0.5, // DRT로 커버되면 정류장까지 도보가 절반
  safetyCMF: 0.75, // 교통안전시설 CMF (0.7–0.8)
  safetySites: 60, // 군 안 저비용 개선 대상지 규모(체감 기준)
  structCMF: 0.659, // 회전교차로 CMF (FHWA Clearinghouse 5229)
  structShare: 0.3, // 사망사고 중 다발지점 구간 비중
  cmfFloor: 0.5, // 대책을 겹쳐도 사고 감소는 50%까지 (HSM 관행)
}

export interface Lever {
  id: LeverId
  name: string
  short: string
  sector: 'med' | 'tra'
  unit: string
  targets: string // 영향 지표
  model: string // 효과 모델 한 줄
  source: string
  sourceOk: boolean // false면 ⚠ 출처 확인 중
  color: string
  cap: (r: Region) => number // 실행 상한 (단위 수)
  cross?: boolean // 의료×교통 교차효과가 있는 레버
}

export const LEVERS: Lever[] = [
  { id: 'er', name: '응급의료 거점 지원', short: '응급 거점', sector: 'med', unit: '개소', targets: 'E30, E60', model: 'E30 × e^(−0.6·개소), 최대 개선 = 현재 E30', source: '공공병원·응급센터 사례(2안 4장) 기반 운영지원 추정', sourceOk: true, color: '#d6455d', cap: () => 2 },
  { id: 'doc', name: '의료인력 지원 (공보의·순회진료)', short: '의료인력', sector: 'med', unit: '명', targets: '의사 수 D', model: '인원 = 예산 ÷ 1인 단가, 20명 기준 체감', source: '군 계약의사·공보의 인건비 추정 (가정값)', sourceOk: true, color: '#e0892b', cap: () => FX.docMax },
  { id: 'bus', name: '버스 증차', short: '버스 증차', sector: 'tra', unit: '대', targets: 'MS(시간적), HT', model: "배차간격 h' = h·n/(n+Δn)", source: '표준운송원가 788,484원/일(2024 광주, 경실련) → 연 2.9억', sourceOk: true, color: '#2f6fd6', cap: (r) => r.buses, cross: true },
  { id: 'drt', name: 'DRT(수요응답형 교통) 도입', short: 'DRT', sector: 'tra', unit: '대', targets: 'MS(공간적), HT', model: '사각 인구 편입비율 = 1 − e^(−대수·1,500/사각인구)', source: '의성·옥천 DRT 운행비(대한토목학회 2012) 물가 보정', sourceOk: true, color: '#14958f', cap: () => 20, cross: true },
  { id: 'safety', name: '교통안전시설 개선', short: '안전시설', sector: 'tra', unit: '개소', targets: 'AR', model: '사고 × CMF 0.75, 60개소 기준 체감', source: '행안부 2019 생활권 개선 566억/858개소 → 개소당 0.66억', sourceOk: true, color: '#8a63d2', cap: () => 80 },
  { id: 'struct', name: '위험도로·다발지점 구조개선', short: '구조개선', sector: 'tra', unit: '개소', targets: 'AR', model: '다발지점 사고 × CMF 0.659, 상한 = 다발지점 수', source: '행안부 위험도로 구조개선 사업 단가', sourceOk: false, color: '#4d4d4d', cap: (r) => r.hotspots },
]
export const lever = (id: LeverId) => LEVERS.find((l) => l.id === id)!
export const LEVER_IDS = LEVERS.map((l) => l.id)

export const DEFAULT_COSTS: Costs = {
  er: { low: 10, mid: 20, high: 35 },
  doc: { low: 2, mid: 3, high: 4.5 },
  bus: { low: 2.3, mid: 2.9, high: 3.5 },
  drt: { low: 1.5, mid: 2.5, high: 4 },
  safety: { low: 0.5, mid: 0.66, high: 0.9 },
  struct: { low: 4, mid: 6, high: 10 },
}

// ---------- 정책 목표 프리셋 (D3-C). 팀 AHP로 확정 전 예시값 ----------
export interface Preset { id: PresetId; name: string; icon: string; gamma: number; wm: [number, number, number]; wt: [number, number, number] }
export const PRESETS: Preset[] = [
  { id: 'med', name: '응급의료 우선', icon: '🚑', gamma: 0.7, wm: [0.5, 0.3, 0.2], wt: [0.4, 0.2, 0.4] },
  { id: 'bal', name: '균형', icon: '⚖️', gamma: 0.5, wm: [0.4, 0.3, 0.3], wt: [0.4, 0.3, 0.3] },
  { id: 'safe', name: '교통안전 우선', icon: '🚦', gamma: 0.3, wm: [0.4, 0.3, 0.3], wt: [0.3, 0.5, 0.2] },
]
export const preset = (id: PresetId) => PRESETS.find((p) => p.id === id)!

// ---------- 지표 ----------
export interface Ind {
  e30: number; e60: number; D: number
  sp: number; tp: number; ms: number; ar: number
  h: number; walk: number; ht: number
  pt: number // 대중교통 이용자 중 병원까지 60분 넘는 비율
  e30eff: number // 실효 E30 = (1−τ)·E30 + τ·pt  (교차효과 연결고리, D7)
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x))
export const tau = (r: Region) => r.elderly * STD.tauPerElderly
// 마을별 대중교통시간이 [HT(1−s), HT(1+s)]에 고르게 퍼져 있을 때 60분을 넘는 비율
export const ptShare = (ht: number) => clamp((ht * (1 + STD.ptSpread) - STD.ptLimit) / (2 * STD.ptSpread * ht))
export const ZERO: Alloc = { er: 0, doc: 0, bus: 0, drt: 0, safety: 0, struct: 0 }

export type UnitCost = Record<LeverId, number>
export const costAt = (c: Costs, lv: CostLevel): UnitCost => Object.fromEntries(LEVER_IDS.map((id) => [id, c[id][lv]])) as UnitCost

// 투입액 x로 바뀐 지표. 상태 없이 x만 보고 계산해서 어떤 순서로 배정해도 같은 값이 나온다
export function indicators(r: Region, x: Alloc = ZERO, c?: UnitCost): Ind {
  const n = (id: LeverId) => (c && x[id] > 0 ? x[id] / c[id] : 0)
  // 응급 거점
  const er = 1 - Math.exp(-FX.erK * n('er'))
  const e30 = r.e30 * (1 - er)
  const e60 = r.e60 * (1 - FX.erE60 * er)
  // 의료인력
  const addDoc = FX.docMax * (1 - Math.exp(-n('doc') / FX.docMax))
  const D = ((r.doctors + addDoc) / r.pop) * 1000
  // 버스 증차 → 배차간격, 시간적 접근성
  const ratio = r.buses / (r.buses + n('bus'))
  const h = r.headway * ratio
  const tp = r.tp + (1 - r.tp) * (1 - ratio)
  // DRT → 사각지역 편입, 도보시간
  const gap = r.pop * (1 - r.sp)
  const f = gap > 0 ? 1 - Math.exp((-n('drt') * FX.drtCover) / gap) : 0
  const sp = r.sp + (1 - r.sp) * f
  const walk = r.walk * (1 - FX.drtWalkCut * f)
  const ht = walk + h / 2 + r.ride
  // 안전시설·구조개선 → 사망률 (CMF 곱, 하한 0.5)
  const fs = 1 - (1 - FX.safetyCMF) * (1 - Math.exp(-n('safety') / FX.safetySites))
  const ft = 1 - FX.structShare * (1 - FX.structCMF) * (r.hotspots ? Math.min(n('struct'), r.hotspots) / r.hotspots : 0)
  const ar = r.ar * Math.max(FX.cmfFloor, fs * ft)
  const pt = ptShare(ht)
  const t = tau(r)
  return { e30, e60, D, sp, tp, ms: (sp + tp) / 2, ar, h, walk, ht, pt, e30eff: (1 - t) * e30 + t * pt }
}

// ---------- 점수 (D2-C: 비율은 그대로, 수량은 전국 평균 대비 부족률) ----------
export interface Score { mvi: number; tvi: number; v: number; parts: { e30: number; e60: number; d: number; ms: number; ar: number; ht: number } }
export function score(ind: Ind, p: Preset): Score {
  const parts = {
    e30: ind.e30eff,
    e60: ind.e60,
    d: clamp((STD.natD - ind.D) / STD.natD),
    ms: 1 - ind.ms,
    ar: clamp(ind.ar / (2 * STD.natAR)),
    ht: clamp(ind.ht / STD.htFull),
  }
  const mvi = 100 * (p.wm[0] * parts.e30 + p.wm[1] * parts.e60 + p.wm[2] * parts.d)
  const tvi = 100 * (p.wt[0] * parts.ms + p.wt[1] * parts.ar + p.wt[2] * parts.ht)
  return { mvi, tvi, v: p.gamma * mvi + (1 - p.gamma) * tvi, parts }
}

export const isVulnerable = (ind: Pick<Ind, 'e30' | 'e60'>) => ind.e30 >= STD.theta || ind.e60 >= STD.theta
export const capEok = (r: Region, id: LeverId, c: UnitCost) => lever(id).cap(r) * c[id]

// ---------- 배분 (4-4) ----------
export const STEP = 1 // 억
export interface Step { lever: LeverId; gain: number } // gain = 그 1억으로 줄어든 종합 취약도
export interface OptResult {
  alloc: Alloc
  steps: Step[]
  left: number // 모든 레버가 상한에 닿아 못 쓴 예산
  before: Ind
  after: Ind
}

export function optimize(r: Region, p: Preset, B: number, c: UnitCost, minMed = 0): OptResult {
  const x: Alloc = { ...ZERO }
  const steps: Step[] = []
  let v = score(indicators(r, x, c), p).v
  let spent = 0
  let med = 0
  while (spent + STEP <= B + 1e-9) {
    // 분야 최소 보장(옵션): 남은 돈으로 의료 최소액을 겨우 채울 수 있으면 의료 레버만 고른다
    const mustMed = minMed > 0 && minMed * B - med >= B - spent - 1e-9 && minMed * B - med > 1e-9
    let best: LeverId | null = null
    let bestV = v
    for (const l of LEVERS) {
      if (mustMed && l.sector !== 'med') continue
      if (x[l.id] + STEP > capEok(r, l.id, c) + 1e-9) continue
      x[l.id] += STEP
      const nv = score(indicators(r, x, c), p).v
      x[l.id] -= STEP
      if (nv < bestV - 1e-12) { bestV = nv; best = l.id }
    }
    if (!best) break
    steps.push({ lever: best, gain: v - bestV })
    x[best] += STEP
    spent += STEP
    if (lever(best).sector === 'med') med += STEP
    v = bestV
  }
  return { alloc: x, steps, left: B - spent, before: indicators(r), after: indicators(r, x, c) }
}

// ---------- 결과 요약 ----------
export interface PlanOutcome {
  preset: PresetId
  opt: OptResult
  before: Score
  after: Score
  neutral: { before: number; after: number } // 균형 가중치로 잰 종합 취약도 (안끼리 비교용)
  benefit: number // 수혜 인구
  benefitParts: { er: number; transit: number }
  vulnerableBefore: boolean
  vulnerableAfter: boolean
  deathsAvoided: number // 연간
  safetyBenefit: number // 억/년 (사회적 비용 절감)
}

export function outcome(r: Region, p: Preset, opt: OptResult): PlanOutcome {
  const bal = preset('bal')
  const { before: b, after: a } = opt
  const er = Math.max(0, r.pop * (b.e30eff - a.e30eff))
  const transit = Math.max(0, r.pop * (a.ms - b.ms))
  const deathsAvoided = ((b.ar - a.ar) * r.pop) / 1e5
  return {
    preset: p.id,
    opt,
    before: score(b, p),
    after: score(a, p),
    neutral: { before: score(b, bal).v, after: score(a, bal).v },
    benefit: er + transit,
    benefitParts: { er, transit },
    vulnerableBefore: isVulnerable(b),
    vulnerableAfter: isVulnerable(a),
    deathsAvoided,
    safetyBenefit: deathsAvoided * STD.deathCost,
  }
}

// AI 추천 기준: 같은 잣대(균형 가중치)로 잰 종합 취약도 감소 × 수혜 인구가 가장 큰 안
export const recScore = (o: PlanOutcome) => (o.neutral.before - o.neutral.after) * o.benefit

export interface Plan extends PlanOutcome {
  range: { low: PlanOutcome; high: PlanOutcome } // 단가 저/고로 다시 돌린 결과 (결과 범위 띠)
  recommended: boolean
}

export function planSet(r: Region, B: number, costs: Costs, level: CostLevel, minMed = 0): Plan[] {
  const run = (p: Preset, lv: CostLevel) => outcome(r, p, optimize(r, p, B, costAt(costs, lv), minMed))
  const plans = PRESETS.map((p) => ({ ...run(p, level), range: { low: run(p, 'low'), high: run(p, 'high') }, recommended: false }))
  const best = plans.reduce((a, b) => (recScore(b) > recScore(a) ? b : a))
  best.recommended = true
  return plans
}

// What-if 곡선: 예산별 종합 취약도
export function curve(r: Region, p: Preset, c: UnitCost, budgets: number[], minMed = 0) {
  return budgets.map((B) => ({ B, v: score(optimize(r, p, B, c, minMed).after, p).v }))
}

// "왜 이 금액?" — 다른 레버는 그대로 두고 이 레버만 0→상한까지 움직였을 때의 종합 취약도 감소
export function leverCurve(r: Region, p: Preset, id: LeverId, alloc: Alloc, c: UnitCost) {
  const base = score(indicators(r, { ...alloc, [id]: 0 }, c), p).v
  const max = capEok(r, id, c)
  const n = 40
  const pts = Array.from({ length: n + 1 }, (_, k) => {
    const x = (max * k) / n
    return { x, dv: base - score(indicators(r, { ...alloc, [id]: x }, c), p).v }
  })
  const marginal = (lid: LeverId) => {
    if (alloc[lid] + STEP > capEok(r, lid, c) + 1e-9) return null
    const v0 = score(indicators(r, alloc, c), p).v
    return v0 - score(indicators(r, { ...alloc, [lid]: alloc[lid] + STEP }, c), p).v
  }
  const mine = marginal(id)
  const others = LEVER_IDS.filter((l) => l !== id).map((l) => ({ l, g: marginal(l) })).filter((o) => o.g != null) as { l: LeverId; g: number }[]
  const rival = others.sort((a, b) => b.g - a.g)[0] ?? null
  return { pts, max, at: alloc[id], dvAt: base - score(indicators(r, alloc, c), p).v, mine, rival, capped: mine == null }
}

// 교차효과 (D7): 버스·DRT가 병원 접근시간과 의료 점수를 얼마나 바꿨는지
export function crossChain(r: Region, p: Preset, alloc: Alloc, c: UnitCost) {
  const noTransit = indicators(r, { ...alloc, bus: 0, drt: 0 }, c)
  const withAll = indicators(r, alloc, c)
  return {
    h: [r.headway, withAll.h] as const,
    ht: [noTransit.ht, withAll.ht] as const,
    mvi: score(withAll, p).mvi - score(noTransit, p).mvi, // 음수 = 의료 점수 개선
  }
}

// 그 레버의 단위 수 (화면 표시용)
export const units = (id: LeverId, eok: number, c: UnitCost) => eok / c[id]
