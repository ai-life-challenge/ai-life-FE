// 화면에서 쓰는 이름·색. 값은 서버가 주고, 여기는 보여 주는 방법만 정한다.
import type { AgeId, Service, SupplyId, VillageState } from './types'

export const AGES: { id: AgeId; name: string }[] = [{ id: 'a80', name: '80세 이상' }, { id: 'a65', name: '65세 이상' }, { id: 'all', name: '전체 주민' }]
export const SERVICES: { id: Service; name: string; desc: string }[] = [
  { id: 'med', name: '병원 가는 길', desc: '자가용으로 갈 수 있는 병원이 있는지, 차가 없으면 버스로 갈 수 있는지 봐요' },
  { id: 'bus', name: '버스 이용', desc: '정류장까지 걷는 거리와 버스 운행만 봐요' },
]
export const SUPPLY: Record<SupplyId, { name: string; color: string }> = {
  fix: { name: '거점 의료기관', color: '#2f5bd3' },
  tour: { name: '순회 진료 버스', color: '#e3a21a' },
  drt: { name: '수요응답형 버스', color: '#1f9d6b' },
  tele: { name: '경로당 원격진료', color: '#9b3fe8' },
}
export const SUPPLY_IDS = Object.keys(SUPPLY) as SupplyId[]

// 마을 판정 색 (지도 · 범례 · 목록이 같이 쓴다)
export const STATE_NAME: Record<VillageState, string> = { 0: '갈 수 있음', 1: '버스가 없어 못 감', 2: '병원이 너무 멀어 못 감' }
export const STATE_RGB: Record<VillageState, [number, number, number]> = { 0: [47, 163, 107], 1: [214, 69, 93], 2: [155, 63, 232] }
export const STATE_CSS: Record<VillageState, string> = { 0: '#2fa36b', 1: '#d6455d', 2: '#9b3fe8' }

export const eok = (x: number) => `${Math.round(x * 100) / 100}억`
export const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
