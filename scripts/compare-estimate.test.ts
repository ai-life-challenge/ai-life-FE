// 서버 대안과 추정 대안 비교(수동 실행 · 네트워크 필요). npm test에서는 건너뛴다.
//   COMPARE_SERVER=1 npx vitest run scripts/compare-estimate.test.ts --disableConsoleIntercept
//   COMPARE_COND=기본(조건 하나만) · COMPARE_LIMIT=12(앞 지역만) · COMPARE_VERBOSE=1(지역별 줄)
//   COMPARE_SET=wide(예산 · 목표 · 수단 · 가정 · 기준을 넓게 바꾼 조건을 층화 표본 지역에서) · COMPARE_EVERY=3(N번째 지역마다) · COMPARE_OUT=파일(조건 · 지역 · 안별 원자료 JSON Lines)
// 서버에 요청을 하나씩만 보낸다. 표는 콘솔에 찍고, 합계 판단은 사람이 한다(추정 값을 서버에 맞추려고 보정하지 않는다).
import fs from 'node:fs'
import { test } from 'vitest'
import { coverageById, estimatePlans } from '../src/api/estimatePlans'
import { compare, judgeLocal } from '../src/api/judge'
import type { Judge, Plans, RegionData, RegionList, State } from '../src/api/types'

const A = process.env.COMPARE_API ?? 'https://api.village-coverage.kro.kr'
const LIMIT = Number(process.env.COMPARE_LIMIT ?? 72)
const post = async <T,>(path: string, body: unknown) => {
  const r = await fetch(A + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`${path} ${r.status}`)
  return (await r.json()) as T
}

test.skipIf(!process.env.COMPARE_SERVER)('서버 대 추정 비교', async () => {
  const list = (await (await fetch(`${A}/api/regions`)).json()) as RegionList
  const S = list.defaultState
  const only = (...ks: string[]) => ({ fix: ks.includes('fix'), tour: ks.includes('tour'), drt: ks.includes('drt'), tele: ks.includes('tele') })
  const conds: [string, Partial<State>][] = [
    ['기본', {}],
    ['예산1억', { budget: 1 }],
    ['전체주민', { age: 'all' }],
    ['자가용10분', { criteria: { ...S.criteria, carMinutes: 10 } }],
    ['순회만', { allowedSupply: only('tour'), budget: 30, target: 1 }],
    ['원격만', { allowedSupply: only('tele'), budget: 30, target: 1 }],
    ['DRT만', { allowedSupply: only('drt'), budget: 30, target: 1 }],
    ['거점만', { allowedSupply: only('fix'), budget: 30, target: 1 }],
  ]
  if (process.env.COMPARE_SET === 'wide') {
    const c = S.assumptions.costs
    const scale = (f: number) => ({ ...S.assumptions, costs: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, install: Math.round(v.install * f * 1000) / 1000, yearly: Math.round(v.yearly * f * 1000) / 1000 }])) as State['assumptions']['costs'] })
    conds.length = 0
    conds.push(
      ['예산0.5', { budget: 0.5 }], ['예산2', { budget: 2 }], ['예산3', { budget: 3 }], ['예산12', { budget: 12 }], ['예산30', { budget: 30 }],
      ['목표80', { target: 0.8 }], ['목표90', { target: 0.9 }], ['목표99', { target: 0.99 }], ['목표100', { target: 1 }],
      ['원격제외', { allowedSupply: only('fix', 'tour', 'drt') }], ['DRT+원격', { allowedSupply: only('drt', 'tele') }], ['순회+원격', { allowedSupply: only('tour', 'tele') }], ['순회+DRT', { allowedSupply: only('tour', 'drt') }], ['거점+원격', { allowedSupply: only('fix', 'tele') }],
      ['단가x0.5', { assumptions: scale(0.5) }], ['단가x2', { assumptions: scale(2) }], ['DRT단가x3', { assumptions: { ...S.assumptions, costs: { ...c, drt: { ...c.drt, yearly: c.drt.yearly * 3 } } } }],
      ['원격효과0.2', { assumptions: { ...S.assumptions, teleEffect: 0.2 } }], ['원격효과0.8', { assumptions: { ...S.assumptions, teleEffect: 0.8 } }], ['순회주1회', { assumptions: { ...S.assumptions, tourWeekly: 1 } }], ['순회주5회', { assumptions: { ...S.assumptions, tourWeekly: 5 } }],
      ['걷기5분', { criteria: { ...S.criteria, stopWalkMinutes: 5 } }], ['걷기30분', { criteria: { ...S.criteria, stopWalkMinutes: 30 } }], ['운행8회', { criteria: { ...S.criteria, dailyRuns: 8 } }], ['자가용60분', { criteria: { ...S.criteria, carMinutes: 60 } }],
      ['65세', { age: 'a65' }], ['복합', { budget: 3, target: 0.9, age: 'a65', criteria: { ...S.criteria, carMinutes: 20 } }],
    )
  }
  const every = Number(process.env.COMPARE_EVERY ?? 1)
  const pick = process.env.COMPARE_COND // 조건 하나만 돌릴 때
  const stat: Record<string, { n: number; judgeSame: number; rate: number[]; year: number[]; rec: number; future: number[]; timeMax: number; over: number; cov: number[]; maxStops: number; sameBase: number; meetSame: number; order: number; picks: number[]; sameCombo: number[]; absRate: number[]; maxRate: number[]; absYear: number[]; maxYear: number[] }> = {}
  for (const r of list.regions.filter((_, i) => i % every === 0).slice(0, LIMIT)) {
    const data = (await (await fetch(`${A}/api/regions/${r.code}`)).json()) as RegionData
    const judge = await post<Judge>('/api/judge', { region: r.code, state: S })
    const local = judgeLocal(data, S)
    const j = compare(judge, local)
    const orderSame = data.villages.every((v, i) => v.id === judge.villages[i].id)
    for (const [name, patch] of conds) {
      if (pick && pick !== name) continue
      const st = { ...S, ...patch } as State
      const server = await post<Plans>('/api/plans', { region: r.code, state: st })
      const t0 = performance.now()
      const est = estimatePlans(data, st)
      const ms = performance.now() - t0
      if (process.env.COMPARE_OUT) {
        fs.appendFileSync(process.env.COMPARE_OUT, JSON.stringify({ cond: name, code: r.code, name: r.name, tier: r.tier, target: st.target, budget: st.budget, rec: [est.recommended, server.recommended], base: [est.plans[0].baseRate, server.plans[0].baseRate], plans: est.plans.map((e, k) => { const v = server.plans[k]; return { k, est: { rate: e.rate, year: e.year, meets: e.meetsTarget, within: e.withinBudget, summary: e.summary, future: e.future }, srv: { rate: v.rate, year: v.year, meets: v.meetsTarget, within: v.withinBudget, summary: v.summary, future: v.future, timedOut: v.timedOut } } }), ms }) + '\n')
      }
      const s = (stat[name] ??= { n: 0, judgeSame: 0, rate: [0, 0, 0], year: [0, 0, 0], rec: 0, future: [0, 0, 0], timeMax: 0, over: 0, cov: [0, 0, 0], maxStops: 0, sameBase: 0, meetSame: 0, order: 0, picks: [0, 0, 0], sameCombo: [0, 0, 0], absRate: [0, 0, 0], maxRate: [0, 0, 0], absYear: [0, 0, 0], maxYear: [0, 0, 0] })
      s.n++
      if (j.same) s.judgeSame++
      if (orderSame) s.order++
      s.timeMax = Math.max(s.timeMax, ms)
      if (est.recommended === server.recommended) s.rec++
      if (est.plans[0].baseRate === server.plans[0].baseRate) s.sameBase++
      est.plans.forEach((e, k) => {
        const v = server.plans[k]
        s.rate[k] += e.rate - v.rate
        s.year[k] += e.year - v.year
        if (e.future != null && v.future != null) s.future[k] += Math.abs(e.future - v.future)
        if (e.meetsTarget === v.meetsTarget) s.meetSame++
        s.picks[k] += Math.abs(e.picks.length - v.picks.length)
        s.absRate[k] += Math.abs(e.rate - v.rate); s.maxRate[k] = Math.max(s.maxRate[k], Math.abs(e.rate - v.rate))
        s.absYear[k] += Math.abs(e.year - v.year); s.maxYear[k] = Math.max(s.maxYear[k], Math.abs(e.year - v.year))
        if (e.summary === v.summary) s.sameCombo[k]++
        const cov = coverageById(est, e, null)!
        let diff = 0
        data.villages.forEach((x, i) => { diff += Math.abs((cov.get(x.id) ?? 0) - v.coverage[i]) * x.pop[st.age] })
        s.cov[k] += diff
        for (const q of v.picks) if (q.type === 'tour') s.maxStops = Math.max(s.maxStops, q.villages.length)
        if (e.year > st.budget + 1e-9) s.over++
      })
      if ((name === '기본' || name === pick) && process.env.COMPARE_VERBOSE) {
        console.log(r.code, r.name, r.tier, est.plans.map((e, k) => `${e.summary} ${e.rate}/${server.plans[k].rate} ${e.year}/${server.plans[k].year} [${server.plans[k].summary}]`).join(' | '), `rec ${est.recommended}/${server.recommended} ${ms.toFixed(0)}ms`)
      }
    }
  }
  for (const [name, s] of Object.entries(stat)) {
    const f = (a: number[]) => a.map((x) => (x / s.n).toFixed(4)).join(' / ')
    console.log(`${name}: 지역 ${s.n} · 판정 일치 ${s.judgeSame} · 마을 순서 일치 ${s.order} · 기본 달성률 일치 ${s.sameBase} · 추천 일치 ${s.rec} · 목표여부 일치 ${s.meetSame}/${s.n * 3} · 평균 달성률 차(추정−서버) ${f(s.rate)} · 평균 |달성률 차| ${f(s.absRate)} · 최대 |달성률 차| ${s.maxRate.map((x) => x.toFixed(4)).join(' / ')} · 평균 연비용 차 ${f(s.year)} · 평균 |연비용 차| ${f(s.absYear)} · 최대 |연비용 차| ${s.maxYear.map((x) => x.toFixed(2)).join(' / ')} · 10년뒤 평균 |차| ${f(s.future)} · 평균 coverage 인원 차 ${f(s.cov)} · 평균 |배치 수 차| ${f(s.picks)} · 수단 구성 일치 ${s.sameCombo.join(' / ')} · 예산초과 ${s.over} · 서버 최대 정차 ${s.maxStops} · 최장 ${s.timeMax.toFixed(0)}ms`)
  }
}, 7_200_000)
