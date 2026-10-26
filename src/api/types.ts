// 백엔드 API(https://api.village-coverage.kro.kr/api/docs)의 요청·응답 타입. 계산은 서버가 하고 화면은 결과만 그린다.

export type Service = 'med' | 'bus'
export type AgeId = 'all' | 'a65' | 'a80'
export type SupplyId = 'fix' | 'tour' | 'drt' | 'tele'
export type Tier = 'precise' | 'auto'
export type Stage = 'diag' | 'alt' | 'memo' // 질문 창 단계: 현황 진단 · 대안 · 검토 메모
export type ReportForm = 'official' | 'resident'
export type SectionKey = '현황' | '공급 방식 비교' | '권고' | '가정과 한계' | '주민 안내문'

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

// shrinkingArea: 행정안전부 인구감소지역(2021 지정) · erVulnerable: 보건복지부 응급의료 취약지(고시 제2021-306호). 둘 다 판정에는 쓰지 않는 표시값이다
export interface RegionItem { code: string; name: string; sido: string; tier: Tier; villages: number; center: [number, number]; shrinkingArea: boolean; erVulnerable: boolean }
export interface RegionList { regions: RegionItem[]; defaultState: State }

export interface NearestMed { minutes: number; name: string; kind: string; outside: boolean }
// 응급의료기관 하나까지 자가용 분(도로 기준)
export interface ErHit { minutes: number; name: string; kind: '권역응급의료센터' | '지역응급의료센터' | '지역응급의료기관' }
// regional: 권역센터(E60 기준) · center: 지역센터 이상(E30 기준) · facility: 지역응급의료기관 이상. 길이 없거나 반경 밖이면 null
export interface NearestEr { regional: ErHit | null; center: ErHit | null; facility: ErHit | null }
// 지도 병원 필터(시험안 2026-10-25): 필터별 가장 가까운 곳. 판정에는 안 쓰고, 필터 판정은 med 대신 이 값과 그 종류 시설만 본다
export type KindFilter = 'hospital' | 'clinic' | 'public'
export type NearestByKind = Record<KindFilter, NearestMed | null> // hospital 병원급 · clinic 의원 · public 보건기관
export interface RawVillage {
  id: string; name: string; myeon: string; lon: number; lat: number
  pop: { all: number; a65: number; a80: number }
  a80In10y: number
  seniorCenter: boolean
  bus: { stopWalkMin: number; noStop: boolean; dailyRuns: number; firstToTownMin: number | null; firstEstimated: boolean; dailyRunsBis?: number } // dailyRunsBis: TS-BIS 41곳만, 참고용(판정에 안 씀)
  nearest: { med: NearestMed | null; school: number | null; library: number | null; er: NearestEr | null; byKind?: NearestByKind }
}
export interface RawFacility { id: string; name: string; kind: string; village: string | null; lon: number; lat: number; doctors: number }
// 군 지표(서버가 기본 기준으로 한 번 계산). 비율은 0~1, 인구 가중. 기준을 바꾼 값은 마을 원자료로 화면이 다시 계산한다
export interface Indicators {
  pop: number; elderly: number
  walkMin: number | null; walkMinExcluded: number
  stopShare: number; stopShareMinutes: number
  runsShare: number | null; runsShareMin: number // 정밀 지역만
  minRuns: number | null; minRunsVillages: number | null
  doctors: number; doctorsPer1k: number; healthPosts: number; healthPostsNoDoctor: number
  e30: number | null; e30Minutes: number // 지역응급의료센터 이상까지 30분 넘는(길 없는 곳 포함) 인구 비율
  e60: number | null; e60Minutes: number // 권역응급의료센터까지 60분 넘는 인구 비율
  erCenterMin: number | null; erRegionalMin: number | null // 응급의료센터까지 인구 가중 평균 분
  runsShareBis: number | null // TS-BIS 41곳만, 참고용
}
export interface RegionData {
  code: string; name: string; sido: string; tier: Tier; town: string; depot: string
  shrinkingArea: boolean; erVulnerable: boolean
  sources: string[]
  myeons: { id: string; name: string; pharmacy: boolean }[]
  villages: RawVillage[]
  facilities: RawFacility[]
  indicators: Indicators
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
  baseRate: number; rate: number; future: number | null // future: 10년 뒤 달성률. 서버는 80세 이상일 때만 주고 나머지 나이대는 null
  gapBefore: number; gapAfter: number
  meetsTarget: boolean; withinBudget: boolean; timedOut: boolean
  sameAs: number | null; recommended: boolean
  coverage: number[] // judge.villages와 같은 순서, 0~1
}
export interface Plans { service: Service; age: AgeId; target: number; budget: number; recommended: number; plans: Plan[] }
export interface PlanLite { k: number; name: string; rate: number; year: number; summary: string }
export interface Sensitivity { base: PlanLite; lo: PlanLite; hi: PlanLite; same: boolean }

// 각주: 레포트 본문 속 [n]은 notes[]의 n번이다. kind: source 자료 · rule 기준 · calc 계산 · assumption 가정
export interface NoteTerm { name?: string; expr: string }
export interface NoteLine { label?: string; value?: string; terms?: NoteTerm[]; text?: string } // 식 줄은 `label value = terms` 꼴로 읽는다
export interface Note {
  n: number; kind: 'source' | 'rule' | 'calc' | 'assumption'; title: string
  org?: string; url?: string; date?: string // source
  text?: string // rule
  lines?: NoteLine[] // calc · assumption
  id?: string // 질문 답의 각주([^id])와 이어지는 이름
}
export interface ReportSection { key: SectionKey | null; title: string; text: string; rewritten: boolean } // key가 null인 '출처와 근거' 문단은 고칠 수 없다
export interface Report {
  form: ReportForm; title: string; plan: number
  sections: ReportSection[]
  table: {
    k: number; name: string; summary: string; rate: number; year: number; install: number; future: number | null; recommended: boolean; chosen: boolean
    gapVillagesBefore: number; reachedVillages: number; teleOnlyVillages: number; gapVillagesAfter: number // 앞의 셋을 더하면 지금 공백 마을 수
  }[]
  notes: Note[] // 공문만. 주민 안내문은 빈 목록
  tableNotes: { future?: number } // 비교 표 머리에 다는 각주 번호(80세 이상이 아니면 빈 객체)
  markdown: string // 문서 전체. 각주는 GFM 각주([^n])
}

export interface Examples { region: string; name: string; examples: Record<Stage, string[]> } // 질문 창 예시 질문(단계마다 4개, 모델을 부르지 않는다)
export interface Turn { role: 'user' | 'assistant'; text: string } // 질문 API의 앞선 대화 한 줄
export interface Health { ok: boolean; regions: number; tiers: Record<Tier, number>; agent: boolean; examples: Record<string, number> } // examples는 미리 만든 답이 없어 늘 빈 객체(옛 FE가 읽던 칸이라 남겼다)

export interface ApiErrorBody { error: string; message: string; detail?: string }
