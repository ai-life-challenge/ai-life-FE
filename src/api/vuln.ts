// 진단 화면의 의료·교통 취약도(0점이 가장 좋고 100점이 가장 취약). 서버에 점수가 없어서 서버 지표로 화면에서 계산한다.
// 지표마다 정부 기준선(또는 군 평균)을 50점, 가장 나쁜 값(100%)을 100점으로 둔다 → 50점을 넘으면 기준 미달이라고 바로 읽힌다
// - 의료: E30(지역응급의료센터 이상 30분 밖)·E60(권역응급의료센터 60분 밖)은 서버 지표(응급실 도로 시간 기준, 공식 정의), 의사 수는 서버 doctorsPer1k
// - 교통: 대중교통 최소서비스(정류장 공간 + 운행 횟수 시간)와 정류장까지 걷는 시간은 서버 지표
// - 교통사고 사망률은 자료가 없어 빼고, 남은 지표에 원래 비율대로 가중치를 나눴다
import type { AgeId, RegionData } from './types'

export const STD = {
  theta: 0.3, // 응급의료 취약지 기준: E30 또는 E60이 30% 이상 (보건복지부 고시 정의)
  msTarget: 0.8, // 대중교통 최소서비스 확보 기준
  avgD: 0.9, // 인구 1천명당 의사 수 72개 군 단순 평균 (2026-10-24 서버 indicators.doctorsPer1k로 계산, 중앙값 0.83)
  walkStd: 15, // 정류장까지 걷는 시간 참고 기준 (설정값)
}
// 균형 가중치. 교통은 원래 MS 0.4 · 사고 0.3 · 시간 0.3에서 사고를 빼고 남은 비율대로 나눴다
export const W = { med: { e30: 0.4, e60: 0.3, d: 0.3 }, tra: { ms: 0.57, walk: 0.43 } }

export interface VillageTime { id: string; name: string; minutes: number | null; people: number } // minutes: 응급실(지역센터 이상)까지 자가용 분, 길이 없으면 null
export interface Vuln {
  e30: number | null; e60: number | null // 응급실 30분·권역센터 60분 밖 주민 비율 (서버 지표, 응급 자료가 없으면 null)
  doctors: number // 인구 1천명당 의사 수
  ms: number; sp: number; tp: number | null // 대중교통 최소서비스. 정밀 지역은 (공간 + 시간) / 2, 간이 판정 지역은 시간(tp)이 없어 공간만
  walk: number // 정류장까지 평균 걷는 시간(분)
  parts: { e30: number | null; e60: number | null; d: number; ms: number; walk: number } // 지표별 0~1 점수 (0.5 = 기준선)
  mvi: number; tvi: number
  vulnerable: boolean // 응급의료 취약지 기준(E30 또는 E60 ≥ 30%)을 넘는지
}

const clamp = (x: number) => Math.min(1, Math.max(0, x))
// 비율 지표 점수: 0 → 0, 기준(std) → 0.5, 100% → 1 (두 구간 선형이라 기준을 크게 넘는 군도 100점에 몰리지 않는다)
export const ratioScore = (v: number, std: number) => clamp(v <= std ? (0.5 * v) / std : 0.5 + (0.5 * (v - std)) / (1 - std))
// 자료가 없는 지표(null)는 빼고 남은 가중치로 다시 나눈 평균 × 100
const weighted = (items: [number | null, number][]) => {
  const ok = items.filter((x): x is [number, number] => x[0] != null)
  const w = ok.reduce((a, [, wt]) => a + wt, 0)
  return w ? (100 * ok.reduce((a, [s, wt]) => a + s * wt, 0)) / w : 0
}

// 마을마다 응급실(지역응급의료센터 이상)까지 자가용 분(서버, 도로 기준)과 고른 나이대의 인구
export function villageTimes(data: RegionData, age: AgeId): VillageTime[] {
  return data.villages.map((v) => ({ id: v.id, name: v.name, minutes: v.nearest.er?.center?.minutes ?? null, people: v.pop[age] }))
}

// T분 넘게 걸리는(길이 없는 마을 포함) 사람 수 · 비율 · 사람 수로 가중한 평균 시간(길 없는 마을은 평균에서 뺀다)
export function overLimit(times: VillageTime[], T: number) {
  const total = times.reduce((a, v) => a + v.people, 0)
  const gap = times.reduce((a, v) => a + (v.minutes == null || v.minutes > T ? v.people : 0), 0)
  const known = times.filter((v) => v.minutes != null)
  const kp = known.reduce((a, v) => a + v.people, 0)
  const avg = kp ? known.reduce((a, v) => a + v.minutes! * v.people, 0) / kp : 0
  return { total, gap, rate: total ? gap / total : 0, avg }
}

export function vulnOf(data: RegionData): Vuln {
  const ind = data.indicators
  const e30 = ind.e30 ?? null, e60 = ind.e60 ?? null
  const doctors = ind.doctorsPer1k ?? (ind.pop ? (ind.doctors / ind.pop) * 1000 : 0)
  const sp = ind.stopShare ?? 0, tp = ind.runsShare ?? null
  const ms = tp == null ? sp : (sp + tp) / 2 // 간이 판정 지역은 하루 운행 횟수 자료가 없어 공간 지표만 쓴다
  const walk = ind.walkMin ?? 0
  const parts = {
    e30: e30 == null ? null : ratioScore(e30, STD.theta), // 30% → 50점, 100% → 100점
    e60: e60 == null ? null : ratioScore(e60, STD.theta),
    d: clamp(1 - doctors / (2 * STD.avgD)), // 군 평균 → 50점, 0명 → 100점, 평균의 2배 → 0점
    ms: ratioScore(1 - ms, 1 - STD.msTarget), // 미확보 20% → 50점, 100% → 100점
    walk: clamp(walk / (2 * STD.walkStd)), // 15분 → 50점, 30분 → 100점
  }
  return {
    e30, e60, doctors, ms, sp, tp, walk, parts,
    mvi: weighted([[parts.e30, W.med.e30], [parts.e60, W.med.e60], [parts.d, W.med.d]]),
    tvi: weighted([[parts.ms, W.tra.ms], [parts.walk, W.tra.walk]]),
    vulnerable: (e30 ?? 0) >= STD.theta || (e60 ?? 0) >= STD.theta,
  }
}
