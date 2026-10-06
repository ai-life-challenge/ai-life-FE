// 프론트와 백엔드(FastAPI + 에이전트 도구)가 주고받는 형식.
// 이름은 기능 명세서의 에이전트 도구(diagnose, optimize, compare, explain_area, get_assumptions)에 맞춘다.

export type ServiceId = 'med' | 'pha' | 'gro' | 'edu' | 'cul' | 'adm' | 'fin'
export type ModeId = 'walk' | 'bus' | 'car'
export type AgeId = 'all' | 'a65' | 'a80'
export type DataLevel = 'precise' | 'estimated' // 정밀 / 추정 포함

export interface Service { id: ServiceId; name: string; full: string; icon: string; optimizable: boolean; T: number }

export interface County {
  sgg: string
  name: string
  level: DataLevel
  role: string // 정밀 데모 / 정책 연결 / 데이터 희박형
}

export interface Village {
  id: number
  name: string
  myeon: string
  lon: number
  lat: number
  pop: number
  isCenter: boolean // 읍면 소재지
  busRuns: number // 하루 버스 횟수 (0이면 정류장 없음)
}

export interface Cell {
  i: number
  polygon: [number, number][] // 500m 격자 사각형 (경위도)
  lon: number
  lat: number
  village: number // 배정된 마을 대표점
  myeon: string
  pop: number
  p65: number
  p80: number
  aiFilled: boolean // 숫자가 가려져 AI가 채운 칸
}

export interface Facility { village: number; name: string }

export interface Diagnosis {
  service: ServiceId
  mode: ModeId
  age: AgeId
  threshold: number
  times: Float32Array // 칸별 가장 가까운 시설까지 분
  nearest: Int32Array // 칸별 가장 가까운 시설의 마을 id
  total: number
  gap: number // 기준 시간을 넘는 (가중) 인구
  rate: number
  avgMinutes: number // 인구 가중 평균 이동시간 = 군 평균
  topVillages: { village: number; gap: number; minutes: number }[]
}

export interface Route {
  path: [number, number][] // 경위도
  timestamps: number[] // 출발부터 누적 분 (경로 그리기 애니메이션에 씀)
  steps: { label: string; minutes: number }[]
  total: number
  facility: string
}
