// 서버 장애 판단: 어떤 실패를 추정 계산으로 넘길지(입력 오류는 넘기지 않는다), 응답이 쓸 수 있는 모양인지, 언제 서버를 다시 물어볼지.
import { ApiError } from './client'
import type { Judge, Plans, RegionData, RegionList, Sensitivity } from './types'

// 추정으로 넘겨도 되는 실패: 연결 실패 · 시간 초과 · 서버 오류(5xx) · 읽을 수 없는 응답. 400 같은 입력 오류와 429, 부른 쪽이 멈춘 요청은 넘기지 않는다
export function isRecoverable(e: unknown) {
  if (!(e instanceof ApiError)) return false
  return e.status >= 500 || e.code === 'network' || e.code === 'timeout' || e.code === 'bad_response'
}

export const badResponse = () => new ApiError(200, 'bad_response', '서버 응답 형식이 올바르지 않아요.')
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

// 응답 검사: 빠진 값을 화면에서 0으로 그리는 대신, 복구할 수 있는 장애로 다룬다. 마을 수(n)를 알면 마을별 배열 길이까지 본다
export function validJudge(j: Judge | null | undefined, n?: number) {
  return !!j && !!j.summary && isNum(j.summary.total) && isNum(j.summary.gap) && Array.isArray(j.villages) && (n == null || j.villages.length === n)
    && j.villages.every((v) => v && typeof v.id === 'string' && (v.state === 0 || v.state === 1 || v.state === 2))
}
export function validPlans(p: Plans | null | undefined, n?: number) {
  return !!p && Array.isArray(p.plans) && p.plans.length === 3 && p.plans.every((x) => x && isNum(x.rate) && x.rate >= 0 && x.rate <= 1 && isNum(x.baseRate) && isNum(x.year) && x.year >= 0
    && isNum(x.install) && isNum(x.gapAfter) && x.gapAfter >= 0 && Array.isArray(x.picks) && Array.isArray(x.coverage) && (n == null || x.coverage.length === n))
}
export function validSens(s: Sensitivity | null | undefined) {
  return !!s && [s.base, s.lo, s.hi].every((x) => x && isNum(x.year) && isNum(x.rate)) && typeof s.same === 'boolean'
}
export const validRegionList = (l: RegionList | null | undefined) => !!l && Array.isArray(l.regions) && l.regions.length > 0 && !!l.defaultState
export const validRegionData = (d: RegionData | null | undefined) => !!d && Array.isArray(d.villages) && d.villages.length > 0 && Array.isArray(d.facilities)

// 장애 기억: 실패한 뒤 잠깐은 다시 묻지 않는다(늦게 답하는 서버를 조건을 바꿀 때마다 30초씩 기다리지 않게, 실패한 요청을 되풀이하지 않게).
// 판정 · 대안 · 지역 자료를 따로 기억한다(대안 API만 고장 나도 판정은 서버 것을 쓴다)
export type DownSlot = 'data' | 'judge' | 'plans'
export const RETRY_AFTER_MS = 60_000
const down = new Map<DownSlot, number>()
export const isDown = (slot: DownSlot) => down.has(slot)
export const canProbe = (slot: DownSlot) => (down.get(slot) ?? Infinity) <= Date.now()
export const markDown = (slot: DownSlot) => { down.set(slot, Date.now() + RETRY_AFTER_MS) }
export const markUp = (slot: DownSlot) => { down.delete(slot) }
export const resetDown = () => { down.clear() }
