// 테스트 전용 예시 지역과 상태. 실제 지역이 아니고 숫자는 모두 테스트를 위해 만든 값이다(앱 코드는 가져다 쓰지 않는다)
import type { RawVillage, RegionData, State } from './types'

type Opt = { m?: string; people?: number; senior?: boolean; walk?: number; medMin?: number | null; anchor?: boolean; a80In10y?: number }
// walk 15분 이하면 버스 OK. medMin이 기준(30분)을 넘으면 '너무 멂'. anchor=false면 다른 마을과 공유하는 시설이 없어 도로 시간을 알 수 없다
export function village(id: string, o: Opt = {}): RawVillage {
  const people = o.people ?? 10, medMin = o.medMin === undefined ? 5 : o.medMin, shared = o.anchor !== false
  return {
    id, name: `면 ${id}`, myeon: o.m ?? 'm1', lon: 128 + Number(id.slice(1)) / 100, lat: 35,
    pop: { all: people * 4, a65: people * 2, a80: people }, a80In10y: o.a80In10y ?? 1.5, seniorCenter: o.senior ?? true,
    bus: { stopWalkMin: o.walk ?? 30, noStop: false, dailyRuns: 5, firstToTownMin: 500, firstEstimated: false },
    nearest: {
      med: medMin == null ? null : { minutes: medMin, name: shared ? '공유의원' : `섬의원${id}`, kind: '의원', outside: false },
      school: 5, library: 5,
      er: shared ? { regional: null, center: { minutes: 20, name: '공유응급', kind: '지역응급의료센터' }, facility: null } : null,
    },
  }
}
const gap = (id: string, o: Opt = {}) => village(id, { walk: 30, ...o })
const ok = (id: string, o: Opt = {}) => village(id, { walk: 5, ...o })

export function region(villages?: RawVillage[]): RegionData {
  return {
    code: '99999', name: '예시군', sido: '예시도', tier: 'auto', town: 'v0', depot: 'v0', shrinkingArea: false, erVulnerable: false,
    sources: ['예시 자료'], myeons: [{ id: 'm1', name: '가면', pharmacy: false }, { id: 'm2', name: '나면', pharmacy: false }],
    villages: villages ?? [
      ok('v0', { people: 100 }), // 보건소가 있는 마을
      gap('v1', { people: 50, m: 'm1' }),
      gap('v2', { people: 30, m: 'm1', senior: false }),
      gap('v3', { people: 20, m: 'm2' }),
      gap('v4', { people: 40, m: 'm2', medMin: 50 }), // 자가용으로도 먼 마을
      ok('v5', { people: 60, m: 'm2' }),
    ],
    facilities: [{ id: 'f0', name: '예시보건소', kind: '보건소', village: 'v0', lon: 128, lat: 35, doctors: 1 }],
    indicators: {} as RegionData['indicators'],
  }
}

export const state = (o: Partial<State> = {}): State => ({
  service: 'med', age: 'a80', criteria: { carMinutes: 30, stopWalkMinutes: 15, dailyRuns: 3 },
  assumptions: {
    version: 1, teleEffect: 0.5, tourWeekly: 2,
    costs: { fix: { install: 12, yearly: 2.4, years: 20 }, tour: { install: 2.5, yearly: 1.1, years: 8 }, drt: { install: 0.9, yearly: 0.8, years: 8 }, tele: { install: 0.03, yearly: 0.05, years: 5 } },
  },
  allowedSupply: { fix: true, tour: true, drt: true, tele: true }, budget: 6, target: 0.95, planShow: 1, selectedVillage: null, report: { form: 'official', sections: {} },
  ...o,
})
export const only = (...ks: string[]) => ({ fix: ks.includes('fix'), tour: ks.includes('tour'), drt: ks.includes('drt'), tele: ks.includes('tele') })
