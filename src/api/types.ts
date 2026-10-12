// 백엔드 API(https://api.village-coverage.kro.kr/api/docs)의 요청·응답 타입. 계산은 서버가 하고 화면은 결과만 그린다.

export type Service = 'med' | 'bus'
export type AgeId = 'all' | 'a65' | 'a80'
export type SupplyId = 'fix' | 'tour' | 'drt' | 'tele'
export type Tier = 'precise' | 'auto'
export type Stage = 'diag' | 'alt' | 'memo'
export type ReportForm = 'official' | 'resident'
export type SectionKey = '현황' | '권고' | '가정과 한계' | '주민 안내문'

export interface Cost { install: number; yearly: number; years: number }
export type Costs = Record<SupplyId, Cost>
export interface Criteria { carMinutes: number; stopWalkMinutes: number; dailyRuns: number }
export interface Assumptions { version: number; costs: Costs; teleEffect: number; tourWeekly: number }

// 서버는 state를 믿지 않는다: 범위를 벗어나거나 모르는 칸이 있으면 400
export interface State {
  service: Service
  age: AgeId
  criteria: Criteria
  assumptions: Assumptions
  allowedSupply: Record<SupplyId, boolean>
  budget: number // 연 예산(억), 0~30
  target: number // 목표 달성률, 0.5~1
  planShow: number // 보여 줄 안 번호 0~2
  selectedVillage: string | null
  report: { form: ReportForm; sections: Partial<Record<SectionKey, string | null>> }
}

export interface RegionItem { code: string; name: string; sido: string; tier: Tier; villages: number; center: [number, number] }
export interface RegionList { regions: RegionItem[]; defaultState: State }

export interface NearestMed { minutes: number; name: string; kind: string; outside: boolean }
export interface RawVillage {
  id: string; name: string; myeon: string; lon: number; lat: number
  pop: { all: number; a65: number; a80: number }
  a80In10y: number
  seniorCenter: boolean
  bus: { stopWalkMin: number; noStop: boolean; dailyRuns: number; firstToTownMin: number | null; firstEstimated: boolean }
  nearest: { med: NearestMed | null; school: number | null; library: number | null }
}
export interface RawFacility { id: string; name: string; kind: string; village: string | null; lon: number; lat: number; doctors: number }
export interface RegionData {
  code: string; name: string; sido: string; tier: Tier; town: string; depot: string
  sources: string[]
  myeons: { id: string; name: string; pharmacy: boolean }[]
  villages: RawVillage[]
  facilities: RawFacility[]
  indicators: Record<string, number>
}

// 0 = 갈 수 있음, 1 = 버스가 없어 못 감, 2 = 자가용 기준 안에 시설이 없음
export type VillageState = 0 | 1 | 2
export interface JudgedVillage { id: string; name: string; myeon: string; lon: number; lat: number; people: number; state: VillageState }
export interface JudgeSummary { total: number; gap: number; rate: number; noBus: number; noFacility: number; villagesNoBus: number; villagesNoFacility: number; gapVillages: number }
export interface Judge {
  service: Service; age: AgeId; tier: Tier; town: string
  summary: JudgeSummary
  busReasons: unknown
  top: { id: string; name: string; people: number; state: VillageState; stateText: string; reason: string }[]
  villages: JudgedVillage[]
  facilities: { id: string; name: string; kind: string; village: string | null }[]
}

export interface VillageDetail {
  id: string; tier: Tier; name: string; myeon: string
  pop: { all: number; a65: number; a80: number }
  bus: { stopWalkMin: number; noStop: boolean; dailyRuns: number; firstToTown: string | null; ok: boolean; reasons: string[] }
  med: { state: VillageState; stateText: string; reason: string; nearest: { name: string; kind: string; minutes: number; outside: boolean; inVillage: boolean } | null }
  noFacility: boolean
}

export interface Pick { type: SupplyId; typeName: string; label: string; year: number; install: number; villages: string[]; myeon: string | null }
export interface Plan {
  k: number; name: string; summary: string; picks: Pick[]
  year: number; install: number
  baseRate: number; rate: number; future: number
  gapBefore: number; gapAfter: number
  meetsTarget: boolean; withinBudget: boolean; timedOut: boolean
  sameAs: number | null; recommended: boolean
  coverage: number[] // judge.villages와 같은 순서, 0~1
}
export interface Plans { service: Service; age: AgeId; target: number; budget: number; recommended: number; plans: Plan[] }
export interface PlanLite { k: number; name: string; rate: number; year: number; summary: string }
export interface Sensitivity { base: PlanLite; lo: PlanLite; hi: PlanLite; same: boolean }

export interface ReportSection { key: SectionKey; title: string; text: string; rewritten: boolean }
export interface Report {
  form: ReportForm; title: string; plan: number
  sections: ReportSection[]
  table: { k: number; name: string; summary: string; rate: number; year: number; install: number; future: number; recommended: boolean; chosen: boolean }[]
}

export interface Examples { region: string; name: string; examples: Record<Stage, string[]> }
export interface Turn { role: 'user' | 'assistant'; text: string }
export interface Answer { answer: string; toolLog: string[]; state: State; remainingToday: number }
export interface Health { ok: boolean; regions: number; tiers: Record<Tier, number>; agent: boolean; examples: Record<string, number> } // examples: 지역마다 미리 만든 답 수

export interface ApiErrorBody { error: string; message: string; detail?: string }
