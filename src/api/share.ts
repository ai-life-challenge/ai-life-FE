// 레포트 공유 링크: 계산에 쓰는 화면 상태(State)를 주소 쿼리로 옮기고, 링크를 열면 되살린다.
// 예전 링크(?s=&a=&b=&t=&p=)도 그대로 읽는다. 없는 값 · 범위를 벗어난 값은 지금 값(처음 열면 서버 기본값)을 둔다.
// 직접 고친 문단(report.sections)은 사용자가 쓴 글이라 담지 않는다. 서버 자료가 바뀌면 같은 링크라도 결과가 달라질 수 있다
import { AGES, COST_FIELDS, SUPPLY_IDS, roundTele } from './meta'
import type { Cost, State, SupplyId } from './types'

// 쿼리 이름: s 서비스 · a 나이대 · b 예산 · t 목표 · p 보여 줄 안(예전 링크) / cm 자가용 분 · sw 정류장 걷는 분 · dr 하루 운행 /
// sup 쓸 수 있는 공급수단 · c_<수단> 설치,연 운영,수명 · te 원격진료 효과 · tw 순회 진료 주당 횟수
const KEYS = ['s', 'a', 'b', 't', 'p', 'cm', 'sw', 'dr', 'sup', ...SUPPLY_IDS.map((id) => `c_${id}`), 'te', 'tw']

export function shareQuery(st: State, base?: URLSearchParams): URLSearchParams {
  const q = new URLSearchParams(base) // 다른 쿼리는 그대로 둔다
  KEYS.forEach((k) => q.delete(k))
  const { criteria: c, assumptions: x } = st
  const put: [string, string | number][] = [
    ['s', st.service], ['a', st.age], ['b', st.budget], ['t', st.target], ['p', st.planShow],
    ['cm', c.carMinutes], ['sw', c.stopWalkMinutes], ['dr', c.dailyRuns],
    ['sup', SUPPLY_IDS.filter((id) => st.allowedSupply[id]).join(',')],
    ...SUPPLY_IDS.map((id): [string, string] => [`c_${id}`, COST_FIELDS.map((f) => x.costs[id][f.key]).join(',')]),
    ['te', x.teleEffect], ['tw', x.tourWeekly],
  ]
  put.forEach(([k, v]) => q.set(k, String(v)))
  return q
}

const num = (v: string | null) => (v == null || v.trim() === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const within = (v: number | null, min: number, max: number, int = false): v is number => v != null && v >= min && v <= max && (!int || Number.isInteger(v))

export function readShare(q: URLSearchParams, x: State): State {
  const n = (k: string) => num(q.get(k))
  const pick = (k: string, min: number, max: number, cur: number, int = false) => { const v = n(k); return within(v, min, max, int) ? v : cur }
  const s = q.get('s'), a = q.get('a')
  // 공급수단은 하나 이상 남아야 한다(목표 화면과 같은 규칙). 모르는 이름이 섞이면 통째로 버린다
  const sup = q.get('sup')?.split(',').filter(Boolean) ?? []
  const allowedSupply = sup.length && sup.every((id) => (SUPPLY_IDS as string[]).includes(id))
    ? Object.fromEntries(SUPPLY_IDS.map((id) => [id, sup.includes(id)])) as Record<SupplyId, boolean>
    : x.allowedSupply
  const costs = Object.fromEntries(SUPPLY_IDS.map((id) => {
    const parts = q.get(`c_${id}`)?.split(',').map(num)
    const ok = parts?.length === COST_FIELDS.length && COST_FIELDS.every((f, i) => within(parts[i], f.min, f.max, f.key === 'years'))
    return [id, ok ? Object.fromEntries(COST_FIELDS.map((f, i) => [f.key, parts[i]])) as unknown as Cost : x.assumptions.costs[id]]
  })) as Record<SupplyId, Cost>
  const te = n('te')
  return {
    ...x,
    service: s === 'med' || s === 'bus' ? s : x.service,
    age: AGES.find((g) => g.id === a)?.id ?? x.age,
    budget: pick('b', 0, 30, x.budget),
    target: pick('t', 0.5, 1, x.target),
    planShow: pick('p', 0, 2, x.planShow, true),
    criteria: {
      carMinutes: pick('cm', 10, 60, x.criteria.carMinutes, true),
      stopWalkMinutes: pick('sw', 5, 30, x.criteria.stopWalkMinutes, true),
      dailyRuns: pick('dr', 1, 10, x.criteria.dailyRuns, true),
    },
    allowedSupply,
    assumptions: {
      ...x.assumptions,
      costs,
      teleEffect: te != null && te === roundTele(te) && within(te, 0, 1) ? te : x.assumptions.teleEffect,
      tourWeekly: pick('tw', 1, 7, x.assumptions.tourWeekly, true),
    },
  }
}
