// 대상 3군의 현황 지표. 화면 속 숫자는 모두 예시값이고, 데이터 수집 후 이 파일만 바꾸면 된다.
// 지표 정의는 구현안 4-2, 출처는 구현안 2-5를 따른다.

export type DataLevel = 'precise' | 'estimated' // 정밀 / 추정 포함

export interface Region {
  code: string
  name: string
  level: DataLevel
  pop: number
  elderly: number // 65세 이상 비율
  // 의료
  e30: number // 지역응급의료센터 30분 내 도달 불가 인구비율 (자가용 기준, NMC)
  e60: number // 권역응급의료센터 60분 내 도달 불가 인구비율
  doctors: number // 군 안 의료기관 의사 수 (심평원)
  // 교통
  sp: number // 대중교통 최소서비스 공간적 접근성 (정류장 400/800m 커버리지)
  tp: number // 시간적 접근성 (기준 운행횟수 충족 비율)
  ar: number // 인구 10만명당 교통사고 사망자 (TAAS)
  hotspots: number // 교통사고 다발지점 개소 수 (TAAS) → 구조개선 레버 실행 상한
  buses: number // 군내 농어촌버스 대수
  headway: number // 병원 가는 노선 평균 배차간격(분)
  walk: number // 집 → 정류장 평균 도보(분)
  ride: number // 정류장 → 병원 평균 승차(분)
  // 재정 (지방재정365 구조별 기능별 세출, 억 원)
  budget: { health: number; transport: number }
  // 인트로 문구용
  erMinutes: number // 응급실까지 평균 이동시간(분)
  minBusRuns: number // 버스가 가장 드문 마을의 하루 운행 횟수
}

export const REGIONS: Region[] = [
  {
    code: '48740', name: '창녕군', level: 'precise', pop: 58_900, elderly: 0.37,
    e30: 0.62, e60: 0.18, doctors: 75,
    sp: 0.74, tp: 0.52, ar: 8.3, hotspots: 6,
    buses: 22, headway: 50, walk: 14, ride: 35,
    budget: { health: 162, transport: 314 },
    erMinutes: 38, minBusRuns: 4,
  },
  {
    code: '48720', name: '의령군', level: 'estimated', pop: 25_600, elderly: 0.44,
    e30: 0.71, e60: 0.34, doctors: 22,
    sp: 0.66, tp: 0.4, ar: 9.8, hotspots: 3,
    buses: 12, headway: 70, walk: 16, ride: 40,
    budget: { health: 96, transport: 181 },
    erMinutes: 41, minBusRuns: 3,
  },
  {
    code: '48730', name: '함안군', level: 'estimated', pop: 61_500, elderly: 0.31,
    e30: 0.24, e60: 0.12, doctors: 98,
    sp: 0.82, tp: 0.63, ar: 7.4, hotspots: 9,
    buses: 30, headway: 40, walk: 12, ride: 28,
    budget: { health: 151, transport: 288 },
    erMinutes: 27, minBusRuns: 6,
  },
]

export const regionOf = (code?: string) => REGIONS.find((r) => r.code === code)

// 공공데이터 출처 (S7). id는 화면의 출처 배지가 이 행을 가리킬 때 쓴다
export interface DataSource { id: string; label: string; source: string; date: string }
export const DATA_SOURCES: DataSource[] = [
  { id: 'pop', label: '인구 · 65세 이상 비율', source: 'KOSIS 주민등록인구', date: '2026.06' },
  { id: 'e30', label: '응급 30분 / 60분 밖 인구비율', source: 'NMC 2025 응급의료 취약지 모니터링 보고서', date: '2025' },
  { id: 'doctors', label: '의사 수', source: '심평원 병원정보서비스 API', date: '2026.09' },
  { id: 'ms', label: '대중교통 최소서비스(공간·시간)', source: '대중교통현황조사 / TAGO 정류소·노선 API', date: '2026.09' },
  { id: 'ar', label: '교통사고 사망자 · 다발지점', source: 'TAAS 지역별 통계 · 사고다발지역 API', date: '2025' },
  { id: 'ht', label: '병원까지 대중교통시간(도보·배차·승차)', source: 'TAGO 버스노선 API + 심평원 좌표로 계산', date: '2026.09' },
  { id: 'budget', label: '보건 · 수송및교통 세출예산', source: '지방재정365 구조별 기능별 세출예산 API', date: '2026' },
]
