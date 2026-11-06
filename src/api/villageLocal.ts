// 서버의 마을 카드(POST /api/village)를 받을 수 없을 때 같은 모양을 마을 원자료로 만든다. 규칙과 문구는 서버 응답 표본과 대조해 맞췄다(scripts/compare-village.test.ts).
// 판정 이유는 원자료의 숫자를 그대로 적은 것이고, 서버가 따로 만든 설명을 흉내 내지 않는다.
import { FIRST_BUS_LIMIT } from './judge'
import type { RegionData, State, VillageDetail, VillageState } from './types'

// 서버 반올림과 같게: 딱 절반이면 짝수로 간다(2.5 → 2, 4.5 → 4)
const roundEven = (x: number) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r }
// 서버는 첫차 시각을 10분 단위로 적는다(741분 → 12:20, 389분 → 6:30). 판정은 원래 값으로 한다
const clock = (min: number) => { const m = Math.round(min / 10) * 10; return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` }
const STATE_TEXT: Record<VillageState, string> = { 0: '갈 수 있음', 1: '버스 없음', 2: '없음' }

export function localVillageDetail(data: RegionData, st: Pick<State, 'criteria'>, id: string): VillageDetail | null {
  const v = data.villages.find((x) => x.id === id)
  if (!v) return null
  const { carMinutes, stopWalkMinutes, dailyRuns } = st.criteria
  const precise = data.tier === 'precise'
  const b = v.bus
  const reasons: string[] = []
  if (b.noStop) reasons.push('2km 안에 정류장 없음')
  else if (b.stopWalkMin > stopWalkMinutes) reasons.push(`정류장까지 걸어서 ${b.stopWalkMin}분`)
  if (precise) {
    if (b.dailyRuns < dailyRuns) reasons.push(`버스 하루 ${b.dailyRuns}번`)
    if (b.firstToTownMin == null) reasons.push('읍내 가는 버스 없음')
    else if (b.firstToTownMin >= FIRST_BUS_LIMIT) reasons.push(`첫차 ${clock(b.firstToTownMin)}${b.firstEstimated ? '(추정)' : ''}`)
  }
  const inVillage = data.facilities.find((f) => f.village === id)
  const near = v.nearest.med
  const far = !inVillage && (near?.minutes ?? Infinity) > carMinutes
  const state: VillageState = inVillage ? 0 : far ? 2 : reasons.length ? 1 : 0
  return {
    id, tier: data.tier, name: v.name, myeon: data.myeons.find((m) => m.id === v.myeon)?.name ?? '',
    pop: v.pop,
    bus: { stopWalkMin: b.stopWalkMin, noStop: b.noStop, dailyRuns: b.dailyRuns, firstToTown: b.firstToTownMin == null ? null : clock(b.firstToTownMin), ok: !reasons.length, reasons },
    med: {
      state, stateText: STATE_TEXT[state],
      reason: state === 2 ? `병원이 자가용 ${carMinutes}분 안에 없음` : state === 1 ? reasons.join(', ') : '',
      nearest: inVillage ? { name: inVillage.name, kind: inVillage.kind, minutes: 0, outside: false, inVillage: true }
        : near ? { name: near.name, kind: near.kind, minutes: roundEven(near.minutes), outside: near.outside, inVillage: false } : null,
    },
    noFacility: state === 2,
  }
}
