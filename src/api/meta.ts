// 화면에서 쓰는 이름·색. 값은 서버가 주고, 여기는 보여 주는 방법만 정한다.
import type { AgeId, Cost, Service, SupplyId, VillageState } from './types'
import type { CarTarget } from './judge'

export const AGES: { id: AgeId; name: string }[] = [{ id: 'a80', name: '80세 이상' }, { id: 'a65', name: '65세 이상' }, { id: 'all', name: '전체 주민' }]
// 진단 화면 '어디까지 가나요' 필터. name은 칩 이름, short는 문장 속 이름(지도 툴팁 · 범례도 같이 쓴다)
export const CAR_TARGETS: { id: CarTarget; name: string; short: string }[] = [
  { id: 'med', name: '모든 병의원', short: '병의원' }, { id: 'hospital', name: '병원·종합병원', short: '병원·종합병원' }, { id: 'clinic', name: '동네 의원', short: '동네 의원' },
  { id: 'public', name: '보건소·진료소', short: '보건소·진료소' }, { id: 'er', name: '응급의료센터', short: '응급의료센터' },
]
// 진단 화면에서 보는 시설 필터 · 이동 수단 이름. 서버 계산 기준(모든 병의원 · 대중교통)과 같으면 null
export const viewName = (travel: 'transit' | 'car', target: CarTarget, carMinutes: number) => {
  const name = CAR_TARGETS.find((x) => x.id === target)!.name
  return travel === 'car' ? `${name} · 자가용 ${carMinutes}분` : target !== 'med' ? `${name} · 대중교통` : null
}
export const SERVICES: { id: Service; name: string; desc: string }[] = [
  { id: 'med', name: '병원 가는 길', desc: '차가 없는 주민이 마을 안 병의원이나 버스로 병원에 갈 수 있는지 봐요' },
  { id: 'bus', name: '버스 이용', desc: '정류장까지 걷는 거리와 버스 운행만 봐요' },
]
export const SUPPLY: Record<SupplyId, { name: string; color: string }> = {
  fix: { name: '거점 의료기관', color: '#2f5bd3' },
  tour: { name: '순회 진료 버스', color: '#e3a21a' },
  drt: { name: '수요응답형 버스', color: '#1f9d6b' },
  tele: { name: '경로당 원격진료', color: '#9b3fe8' },
}
export const SUPPLY_IDS = Object.keys(SUPPLY) as SupplyId[]
// 공급수단 단가 입력칸(가정과 출처)과 공유 링크가 같이 쓰는 범위. 범위를 벗어나면 서버가 400을 준다
export const COST_FIELDS: { key: keyof Cost; label: string; min: number; max: number; step: number }[] = [
  { key: 'install', label: '설치(억)', min: 0, max: 100, step: 0.1 },
  { key: 'yearly', label: '연 운영(억)', min: 0, max: 50, step: 0.1 },
  { key: 'years', label: '수명(년)', min: 1, max: 50, step: 1 },
]
// 서버는 원격진료 효과를 0.1 단위로만 받는다(0.55 같은 값은 400). 보내기 전에 0.1 단위로 반올림한다
export const roundTele = (v: number) => Math.round(v * 10) / 10

// 받침에 맞는 조사(이/가 · 을/를): 필터 이름이 바뀌어도 문장이 어색하지 않게
export const josa = (w: string, a: string, b: string) => ((w.charCodeAt(w.length - 1) - 0xac00) % 28 === 0 ? b : a)
// 마을 판정 이름(왼쪽 목록 · 범례 · 지도 툴팁 · 마을 카드가 같이 쓴다). '너무 멂'(2)은 고른 시설 이름으로 적는다.
// 서버의 짧은 이름(버스 없음 · 없음)은 화면에 그대로 쓰지 않는다
export const stateName = (state: VillageState, target: CarTarget) => {
  if (state === 0) return '갈 수 있음'
  if (state === 1) return '버스가 없어 못 감'
  const name = CAR_TARGETS.find((x) => x.id === target)!.short
  return `${name}${josa(name, '이', '가')} 너무 멀어 못 감`
}
// 마을 판정 색 (지도 · 범례 · 목록이 같이 쓴다)
export const STATE_RGB: Record<VillageState, [number, number, number]> = { 0: [47, 163, 107], 1: [214, 69, 93], 2: [155, 63, 232] }
export const STATE_CSS: Record<VillageState, string> = { 0: '#2fa36b', 1: '#d6455d', 2: '#9b3fe8' }

export const eok = (x: number) => `${Math.round(x * 100) / 100}억`
export const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
// 달성률처럼 소수 한 자리까지 늘 맞춰 보여 줄 비율 (0.81 → 81.0%). 숫자가 아니면 —
export const pct1 = (x: number) => (Number.isFinite(x) ? `${(Math.round(x * 1000) / 10).toFixed(1)}%` : '—')
export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
