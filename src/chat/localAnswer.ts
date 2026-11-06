// 서버가 없을 때 질문 창이 쓰는 제한된 자료 조회. 생성형 AI가 아니라 낱말로 질문 종류를 고르고, 화면이 이미 계산한 값을 그대로 옮겨 적는다.
// 값이 없거나 모르는 질문은 지어내지 않고 할 수 없다고 답한다. 화면 값(state)은 바꾸지 않는다.
import { judgeLocal } from '../api/judge'
import { localVillageDetail } from '../api/villageLocal'
import { AGES, SUPPLY, SUPPLY_IDS, eok, fmt, pct1 } from '../api/meta'
import type { Judge, Plan, Plans, RegionData, State } from '../api/types'
import type { SnapshotManifest } from '../api/snapshot'

export interface LocalContext { data: RegionData | null; state: State | null; judge: Judge | null; plans: Plans | null; snapshot: SnapshotManifest | null; dataSource: 'server' | 'snapshot' }

// 질문 창에 보여 줄 예시. 아래 규칙이 답할 수 있는 것만 적는다
export const LOCAL_EXAMPLES = ['공백 인구는 몇 명이에요?', '지금 안의 달성률은요?', '예산과 비용은요?', '공급수단은 어디에 놓여요?', '세 안은 어떻게 달라요?', '계산 기준과 자료 출처는요?']

const SUPPORT = '답할 수 있는 것은 공백 인구, 고른 안의 달성률, 예산과 비용, 공급수단 배치, 안별 차이, 마을별 판정 이유, 계산 기준과 자료 출처예요.'
const shownPlan = (c: LocalContext): Plan | null => (c.plans && c.state ? c.plans.plans[c.state.planShow] ?? c.plans.plans[c.plans.recommended] ?? null : null)
const label = (p: Plans | null) => (p?.estimate ? '브라우저 추정' : '서버 계산')
const needPlans = '아직 대안을 계산하지 않았어요. 예산안 만들기를 지나면 답할 수 있어요.'

function gap(c: LocalContext) {
  // 판정을 아직 부르지 않은 화면(레포트로 바로 들어온 경우 등)은 원자료로 같은 규칙의 판정을 계산한다
  const s = c.judge?.summary ?? (c.data && c.state ? judgeLocal(c.data, c.state).summary : null)
  if (!s || !c.state) return '자료를 아직 불러오지 못했어요.'
  const age = AGES.find((a) => a.id === c.state!.age)!.name
  return `${age} ${fmt(s.total)}명 중 **${fmt(s.gap)}명**(${pct1(s.rate)})이 지금 기준에서 병원에 가기 어려워요. 버스가 없어서 ${fmt(s.noBus)}명(${s.villagesNoBus}곳), 병의원이 너무 멀어서 ${fmt(s.noFacility)}명(${s.villagesNoFacility}곳)이에요.`
}
function rate(c: LocalContext) {
  const p = shownPlan(c)
  if (!p) return needPlans
  return `**${p.name}**의 달성률은 ${pct1(p.baseRate)}에서 ${pct1(p.rate)}로 올라요(${label(c.plans)}). 목표 ${pct1(c.state!.target)}를 ${p.meetsTarget ? '채워요' : '채우지 못해요'}. 공백은 ${fmt(p.gapBefore)}명에서 ${fmt(p.gapAfter)}명으로 줄어요.`
}
function cost(c: LocalContext) {
  const p = shownPlan(c)
  if (!p) return needPlans
  return `연 예산 ${eok(c.state!.budget)}에서 **${p.name}**의 연 비용은 **${eok(p.year)}**, 설치비는 ${eok(p.install)}예요(${label(c.plans)}). 예산을 ${p.withinBudget ? '넘지 않아요' : '넘어요'}. 단가는 가정값이고 '가정과 출처'에서 고칠 수 있어요.`
}
function supply(c: LocalContext) {
  const p = shownPlan(c)
  if (!p) return needPlans
  if (!p.picks.length) return `${p.name}은 새로 놓는 공급수단이 없어요.`
  const rows = SUPPLY_IDS.flatMap((t) => {
    const xs = p.picks.filter((x) => x.type === t)
    return xs.length ? [`- ${SUPPLY[t].name} ${xs.length}곳: 연 ${eok(xs.reduce((a, x) => a + x.year, 0))} · ${xs.slice(0, 5).map((x) => x.label).join(', ')}${xs.length > 5 ? ` 외 ${xs.length - 5}곳` : ''}`] : []
  })
  return `**${p.name}**의 배치예요(${label(c.plans)}).\n\n${rows.join('\n')}`
}
function compare(c: LocalContext) {
  if (!c.plans) return needPlans
  const rows = c.plans.plans.map((p) => `| ${p.name}${p.recommended ? ' ⭐' : ''} | ${pct1(p.rate)} | ${fmt(p.gapAfter)}명 | ${eok(p.year)} | ${eok(p.install)} |`)
  return `${label(c.plans)} 결과예요.\n\n| 안 | 달성률 | 남는 공백 | 연 비용 | 설치 |\n|---|---|---|---|---|\n${rows.join('\n')}`
}
function basis(c: LocalContext) {
  if (!c.state) return '기준을 아직 불러오지 못했어요.'
  const k = c.state.criteria
  return `판정 기준은 자가용 ${k.carMinutes}분, 정류장까지 걸어서 ${k.stopWalkMinutes}분${c.data?.tier === 'precise' ? `, 버스 하루 ${k.dailyRuns}번 이상과 낮 12시 전 읍내행 첫차` : '(간이 판정 지역이라 버스 운행은 보지 않아요)'}예요. 대안은 ${label(c.plans)} 값이고, 원격진료 효과 ${c.state.assumptions.teleEffect}와 단가는 가정값이에요.`
}
function sources(c: LocalContext) {
  if (!c.data) return '자료를 아직 불러오지 못했어요.'
  const when = c.dataSource === 'snapshot' && c.snapshot ? `서버에 연결되지 않아 ${c.snapshot.capturedAt}에 수집해 저장한 자료를 쓰고 있어요. 수집일은 원본 통계의 기준 시점이 아니에요. ` : ''
  return `${when}이 지역 자료의 출처예요.\n\n${c.data.sources.map((s) => `- ${s}`).join('\n')}`
}
function village(c: LocalContext, q: string) {
  if (!c.data || !c.state) return null
  // 질문에 든 마을 이름을 찾는다. '남지읍 학계리'처럼 읍면까지 쓰거나 '학계리'만 쓸 수 있다
  const hit = c.data.villages.find((v) => q.includes(v.name)) ?? c.data.villages.find((v) => { const short = v.name.split(' ').at(-1)!; return short.length >= 2 && q.includes(short) })
  if (!hit) return null
  const d = localVillageDetail(c.data, c.state, hit.id)!
  const near = d.med.nearest ? `가까운 병의원은 ${d.med.nearest.name}(${d.med.nearest.kind})이고 ${d.med.nearest.inVillage ? '마을 안에 있어요' : `자가용 ${d.med.nearest.minutes}분이에요`}.` : '가까운 병의원 자료가 없어요.'
  return `**${d.name}**: ${d.med.stateText}. ${d.med.reason ? `이유: ${d.med.reason}. ` : ''}${near} 사는 사람은 ${fmt(d.pop.all)}명(80세 이상 ${fmt(d.pop.a80)}명)이에요.`
}

// 위에서부터 먼저 맞는 규칙으로 답한다. 맞는 규칙이 없으면 할 수 있는 것을 알린다
export function localAnswer(q: string, c: LocalContext): { text: string; supported: boolean } {
  const v = village(c, q)
  if (v) return { text: v, supported: true }
  const rules: [RegExp, () => string][] = [
    [/출처|자료|데이터|수집|기준일/, () => sources(c)],
    [/세 안|안별|비교|차이|달라|대안/, () => compare(c)],
    [/공급|수단|배치|설치|놓|순회|진료소|수요응답|원격/, () => supply(c)],
    [/달성|목표/, () => rate(c)],
    [/예산|비용|얼마|돈|단가/, () => cost(c)],
    [/공백|못 가|못가|갈 수 없|인구|몇 명/, () => gap(c)],
    [/기준|계산|어떻게/, () => basis(c)],
  ]
  const hit = rules.find(([re]) => re.test(q))
  return hit ? { text: hit[1](), supported: true } : { text: `그 질문은 지금 답할 수 없어요. 서버에 연결되지 않아 AI 답변을 쓸 수 없고, 저장된 자료와 화면 계산 값만 찾아 드려요. ${SUPPORT}`, supported: false }
}
