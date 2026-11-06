// 서버 장애 판단: 어떤 실패를 추정 계산으로 넘길지(입력 오류는 넘기지 않는다), 응답이 쓸 수 있는 모양인지, 언제 서버를 다시 물어볼지.
import { ApiError } from './client'
import { SUPPLY_IDS } from './meta'
import type { Judge, Pick, Plans, RawVillage, RegionData, RegionList, Sensitivity } from './types'

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
// 배치 한 건: 결과 카드 · 범례 · 지도가 읽는 칸만 본다. 수요응답형은 읍면 이름이 있어야 지도에 구역을 그린다
const validPick = (x: Pick | null | undefined) => !!x && SUPPLY_IDS.includes(x.type) && typeof x.label === 'string' && isNum(x.year) && x.year >= 0 && isNum(x.install) && x.install >= 0
  && Array.isArray(x.villages) && x.villages.every((id) => typeof id === 'string') && (x.type === 'drt' ? !!x.myeon && typeof x.myeon === 'string' : x.myeon == null || typeof x.myeon === 'string')
export function validPlans(p: Plans | null | undefined, n?: number) {
  return !!p && Array.isArray(p.plans) && p.plans.length === 3 && [0, 1, 2].every((k) => p.plans.some((x) => x?.k === k))
    && p.plans.every((x) => x && isNum(x.rate) && x.rate >= 0 && x.rate <= 1 && isNum(x.baseRate) && isNum(x.year) && x.year >= 0
    && isNum(x.install) && isNum(x.gapBefore) && isNum(x.gapAfter) && x.gapAfter >= 0 && Array.isArray(x.picks) && x.picks.every(validPick)
    && Array.isArray(x.coverage) && (n == null || x.coverage.length === n) && x.coverage.every((c) => isNum(c) && c >= 0 && c <= 1))
}
export function validSens(s: Sensitivity | null | undefined) {
  return !!s && [s.base, s.lo, s.hi].every((x) => x && isNum(x.year) && isNum(x.rate)) && typeof s.same === 'boolean'
}
export const validRegionList = (l: RegionList | null | undefined) => !!l && Array.isArray(l.regions) && l.regions.length > 0 && l.regions.every((r) => r && typeof r.code === 'string' && typeof r.name === 'string' && isNum(r.villages))
  && !!l.defaultState && !!l.defaultState.criteria && !!l.defaultState.assumptions
// 마을 한 곳: 판정 · 추정이 읽는 칸. 빠진 값을 계산에서 0으로 치지 않도록 여기서 막는다. 간이 지역은 버스 운행 칸이 원래 없다
const validVillage = (v: RawVillage) => !!v && typeof v.id === 'string' && !!v.id && typeof v.myeon === 'string' && isNum(v.lon) && isNum(v.lat)
  && !!v.pop && isNum(v.pop.all) && isNum(v.pop.a65) && isNum(v.pop.a80) && !!v.bus && isNum(v.bus.stopWalkMin) && typeof v.bus.noStop === 'boolean' && !!v.nearest
export const validRegionData = (d: RegionData | null | undefined) => !!d && Array.isArray(d.villages) && d.villages.length > 0 && Array.isArray(d.facilities)
  && d.villages.every(validVillage) && new Set(d.villages.map((v) => v.id)).size === d.villages.length
export const validMap = (m: GeoJSON.FeatureCollection | null | undefined) => !!m && m.type === 'FeatureCollection' && Array.isArray(m.features)

// 장애 기억: 실패한 뒤 잠깐은 다시 묻지 않는다(늦게 답하는 서버를 조건을 바꿀 때마다 30초씩 기다리지 않게, 실패한 요청을 되풀이하지 않게).
// 판정 · 대안 · 지역 자료를 따로 기억한다(대안 API만 고장 나도 판정은 서버 것을 쓴다)
export type DownSlot = 'data' | 'judge' | 'plans'
export const RETRY_AFTER_MS = 60_000
// 지역 목록 · 자료 요청이 이 시간 안에 답이 없으면 답을 기다리지 않고 저장한 자료를 먼저 보여 준다(1초 안에 답하는 API다). 답이 늦게라도 오면 서버 값으로 바꾼다
export const GRACE_MS = 4_000
const down = new Map<DownSlot, number>()
export const isDown = (slot: DownSlot) => down.has(slot)
export const canProbe = (slot: DownSlot) => (down.get(slot) ?? Infinity) <= Date.now()
export const markDown = (slot: DownSlot) => { down.set(slot, Date.now() + RETRY_AFTER_MS) }
export const markUp = (slot: DownSlot) => { down.delete(slot); if (slot === 'data') hungUntil = 0 }
export const resetDown = () => { down.clear(); hungUntil = 0 }
// 서버가 답 없이 멈춘 것으로 보인다: 계산도 같이 멈췄을 테니 화면마다 20~30초씩 기다리지 않게 전부 장애로 기억한다. 연결 실패 · 5xx는 요청마다 바로 실패하므로 칸별로 기억하면 된다
let hungUntil = 0
export const markHung = () => { markDown('data'); markDown('judge'); markDown('plans'); hungUntil = Date.now() + RETRY_AFTER_MS }
export const isHung = () => hungUntil > Date.now()
