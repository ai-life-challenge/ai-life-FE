// 브라우저 판정. 기준을 바꿀 때마다 서버를 부르지 않고 바로 지도를 다시 칠하려고 쓴다.
// 기준은 서버 판정(POST /api/judge)이다: 서버 결과가 오면 compare()로 대조해서 다르면 화면에 알린다.
// 규칙은 문서에 없어서 서버 결과에 맞춰 알아낸 것이다(5개 시군구 · 여러 기준 조합에서 마을 판정과 합계가 모두 일치).
import type { JudgedVillage, Judge, JudgeSummary, RegionData, State, VillageState } from './types'

// 읍내행 첫차는 낮 12시(720분) 전이어야 한다. 서버 결과에서 688분은 통과, 732분은 탈락이라 그 사이를 12시로 잡았다
export const FIRST_BUS_LIMIT = 720

type Rule = Pick<State, 'service' | 'age' | 'criteria'>
export interface LocalJudge { villages: JudgedVillage[]; summary: JudgeSummary }

export function judgeLocal(data: RegionData, rule: Rule): LocalJudge {
  const { carMinutes, stopWalkMinutes, dailyRuns } = rule.criteria
  const withFacility = new Set(data.facilities.map((f) => f.village).filter(Boolean))
  const villages = data.villages.map((v): JudgedVillage => {
    const b = v.bus
    let busOk = !b.noStop && b.stopWalkMin <= stopWalkMinutes
    // 정밀 지역은 하루 운행 횟수와 읍내행 첫차도 본다. 나머지(자동 추정)는 정류장까지 걷는 거리만 본다
    if (data.tier === 'precise') busOk &&= b.dailyRuns >= dailyRuns && b.firstToTownMin != null && b.firstToTownMin <= FIRST_BUS_LIMIT
    let state: VillageState
    if (rule.service === 'bus') state = busOk ? 0 : 1
    else if (withFacility.has(v.id)) state = 0 // 마을 안에 병의원이 있으면 갈 수 있음으로 본다
    else if (!v.nearest.med || v.nearest.med.minutes > carMinutes) state = 2
    else state = busOk ? 0 : 1
    return { id: v.id, name: v.name, myeon: v.myeon, lon: v.lon, lat: v.lat, people: v.pop[rule.age], state }
  })
  return { villages, summary: summarize(villages) }
}

function summarize(villages: JudgedVillage[]): JudgeSummary {
  const sum = (state: VillageState) => villages.filter((v) => v.state === state)
  const total = villages.reduce((a, v) => a + v.people, 0)
  const noBus = sum(1), noFac = sum(2)
  const people = (xs: JudgedVillage[]) => xs.reduce((a, v) => a + v.people, 0)
  const gap = people(noBus) + people(noFac)
  return {
    total, gap, rate: total ? Math.round((gap / total) * 1e4) / 1e4 : 0,
    noBus: people(noBus), noFacility: people(noFac),
    villagesNoBus: noBus.length, villagesNoFacility: noFac.length, gapVillages: noBus.length + noFac.length,
  }
}

// 서버 판정과 대조: 마을 판정이 다른 곳과 합계가 같은지
export function compare(server: Judge, local: LocalJudge) {
  const mine = new Map(local.villages.map((v) => [v.id, v.state]))
  const diff = server.villages.filter((v) => mine.get(v.id) !== v.state).map((v) => v.id)
  const same = diff.length === 0 && server.summary.gap === local.summary.gap && server.summary.total === local.summary.total
  return { same, diff }
}
