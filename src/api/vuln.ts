// 진단 화면의 의료·교통 취약도(0점이 가장 좋고 100점이 가장 취약). 서버에 점수가 없어서 서버 지표와 마을 자료로 화면에서 계산한다.
// 지표마다 정부 기준선(또는 군 평균)을 50점, 그 2배 나쁜 값을 100점으로 둔다 → 50점을 넘으면 기준 미달이라고 바로 읽힌다
// - 병원까지 시간(E30)은 마을에서 가장 가까운 병원급 시설까지 직선거리로 어림한 추정이다(cells.ts hospitalMinutes)
// - 의사 수 · 대중교통 최소서비스 · 정류장까지 걷는 시간은 서버 지표(indicators) 그대로다
// - 권역센터 60분(E60)·교통사고 사망률은 자료가 없어 빼고, 남은 지표에 가중치를 나눠 줬다
import { hospitalMinutes, hospitalsOf } from './cells'
import type { AgeId, RegionData } from './types'

export const STD = {
  theta: 0.27, // 응급의료 취약지 기준: 병원 30분 밖 주민 비율
  msTarget: 0.8, // 대중교통 최소서비스 확보 기준
  avgD: 0.91, // 인구 1천명당 의사 수 72개 군 단순 평균 (2026-10-19 서버 indicators.doctors / pop으로 계산, 중앙값 0.85)
  walkStd: 15, // 정류장까지 걷는 시간 참고 기준 (설정값)
}
// 균형 가중치(원래 의료 E30 0.4 · E60 0.3 · 의사 0.3, 교통 MS 0.4 · 사고 0.3 · 시간 0.3)에서 빠진 항목을 빼고 남은 비율대로 다시 나눴다
export const W = { med: { e30: 0.57, d: 0.43 }, tra: { ms: 0.57, walk: 0.43 } }

export interface VillageTime { id: string; name: string; minutes: number; people: number }
export interface Vuln {
  e30: number // 병원까지 30분 밖 주민 비율 (전체 주민, 추정)
  doctors: number // 인구 1천명당 의사 수
  ms: number; sp: number; tp: number // 대중교통 최소서비스 = (공간 + 시간) / 2
  walk: number // 정류장까지 평균 걷는 시간(분)
  parts: { e30: number; d: number; ms: number; walk: number } // 지표별 0~1 점수 (0.5 = 기준선)
  mvi: number; tvi: number
  vulnerable: boolean // 응급의료 취약지 기준(30분 밖 27%)을 넘는지
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))

// 마을마다 병원까지 추정 시간과 고른 나이대의 인구
export function villageTimes(data: RegionData, age: AgeId): VillageTime[] {
  const hs = hospitalsOf(data.facilities)
  if (!hs.length) return []
  return data.villages.map((v) => ({ id: v.id, name: v.name, minutes: hospitalMinutes(v.lon, v.lat, hs), people: v.pop[age] }))
}

// T분 넘게 걸리는 사람 수 · 비율 · 사람 수로 가중한 평균 시간
export function overLimit(times: VillageTime[], T: number) {
  const total = times.reduce((a, v) => a + v.people, 0)
  const gap = times.reduce((a, v) => a + (v.minutes > T ? v.people : 0), 0)
  const avg = total ? times.reduce((a, v) => a + v.minutes * v.people, 0) / total : 0
  return { total, gap, rate: total ? gap / total : 0, avg }
}

export function vulnOf(data: RegionData): Vuln {
  const ind = data.indicators
  const all = villageTimes(data, 'all')
  const e30 = overLimit(all, 30).rate
  const doctors = ind.pop ? (ind.doctors / ind.pop) * 1000 : 0
  const sp = ind.stopShare ?? 0, tp = ind.runsShare ?? 0, ms = (sp + tp) / 2
  const walk = ind.walkMin ?? 0
  const parts = {
    e30: clamp(e30 / (2 * STD.theta)), // 27% → 50점, 54% → 100점
    d: clamp(1 - doctors / (2 * STD.avgD)), // 군 평균 → 50점, 0명 → 100점, 평균의 2배 → 0점
    ms: clamp((1 - ms) / (2 * (1 - STD.msTarget))), // 미확보 20% → 50점, 40% → 100점
    walk: clamp(walk / (2 * STD.walkStd)), // 15분 → 50점, 30분 → 100점
  }
  return {
    e30, doctors, ms, sp, tp, walk, parts,
    mvi: 100 * (W.med.e30 * parts.e30 + W.med.d * parts.d),
    tvi: 100 * (W.tra.ms * parts.ms + W.tra.walk * parts.walk),
    vulnerable: e30 >= STD.theta,
  }
}
