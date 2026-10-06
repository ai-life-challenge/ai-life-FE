// 정책 질의 에이전트 (시제품: 정해진 규칙으로 흉내).
// 실제 서비스는 Claude Agent SDK 에이전트가 같은 계산 함수를 도구로 불러 답하고, 아래와 같은 이벤트를 SSE로 흘려보낸다.
// 답의 숫자는 도구 결과에서만 가져온다.
import type { AgeId, ServiceId } from './types'
import { AGES, diagnose, service, type Model } from './mock'
import { planSet, recommendReason, summarize, type Assumptions, type Goal, type Plan, type PlanId } from './plans'

export type Screen = 'diag' | 'plan' | 'memo'
export interface AgentCtx { screen: Screen; model: Model; goal: Goal; assume: Assumptions; plans: Plan[]; pending: Partial<Parsed> | null }
// 화면에 반영할 변경. 대화창이 받아서 store에 넣는다
export interface Patch {
  target?: number
  budget?: number
  age?: AgeId
  service?: ServiceId
  threshold?: number
  tele?: number
  planShow?: PlanId | null
  memo?: { recPlan?: PlanId | null; summaryLine?: boolean; shortRec?: boolean; addLimit?: string }
  pending?: Partial<Parsed> | null
}
export type AgentEvent =
  | { type: 'tool_call'; id: string; label: string }
  | { type: 'tool_result'; id: string; result: string }
  | { type: 'text'; delta: string }
  | { type: 'clarify'; options: string[] }
  | { type: 'apply'; patch: Patch }
  | { type: 'basis'; text: string }
  | { type: 'done'; intent: Intent | null }

type Intent = 'mincost' | 'maxcov' | 'future' | 'why' | 'diag' | 'tele' | 'compare' | 'memoShort' | 'memoSummary' | 'memoLimit' | 'memoSwitch'
interface Parsed { intent: Intent | null; service?: ServiceId; age?: AgeId; target?: number; T?: number; budget?: number; tele?: number; plan?: PlanId }

const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
const pct = (x: number) => `${(Math.round(x * 1000) / 10).toFixed(1)}%`
const eok = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)}억`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ageName = (a: AgeId) => AGES.find((x) => x.id === a)!.name

function parse(q: string, screen: Screen): Parsed {
  const r: Parsed = { intent: null }
  const svc: [ServiceId, RegExp][] = [['med', /병원|의료|진료|보건/], ['pha', /약국|약\b/], ['gro', /식료품|가게|마트|장보/], ['edu', /학교|교육|어린이집/], ['cul', /도서관|문화/], ['adm', /면사무소|읍사무소|행정|민원/], ['fin', /우체국|은행|금융/]]
  r.service = svc.find(([, re]) => re.test(q))?.[0]
  if (/80\s*세/.test(q)) r.age = 'a80'
  else if (/65\s*세|어르신|노인|고령/.test(q)) r.age = 'a65'
  else if (/전체|모든 주민|주민 모두/.test(q)) r.age = 'all'
  const p = q.match(/(\d{2,3})\s*%/); if (p) r.target = +p[1] / 100
  const t = q.match(/(\d{1,3})\s*분/); if (t) r.T = +t[1]
  const b = q.match(/(\d+(?:\.\d+)?)\s*억/); if (b) r.budget = +b[1]
  const f = q.match(/0\.\d+/); if (f && /원격|효과/.test(q)) r.tele = +f[0]
  const plan = /이동형/.test(q) ? 'B' : /시설/.test(q) ? 'A' : /최소\s*비용/.test(q) ? 'C' : /([ABC])\s*안/.exec(q)?.[1] as PlanId | undefined
  if (plan) r.plan = plan
  if (screen === 'memo') {
    if (/짧게|줄여|간단/.test(q)) r.intent = 'memoShort'
    else if (/요약/.test(q)) r.intent = 'memoSummary'
    else if (/가정|한계|시점/.test(q)) r.intent = 'memoLimit'
    else if (r.plan && /바꿔|으로/.test(q)) r.intent = 'memoSwitch'
    if (r.intent) return r
  }
  if (r.tele != null) r.intent = 'tele'
  else if (/최소|얼마/.test(q) && /예산|비용|돈|얼마/.test(q) && r.budget == null) r.intent = 'mincost'
  else if (r.budget != null) r.intent = 'maxcov'
  else if (/10년|미래|나중/.test(q)) r.intent = 'future'
  else if (/왜|이유|추천/.test(q)) r.intent = 'why'
  else if (/비교|차이/.test(q)) r.intent = 'compare'
  else if (/어디|마을|몇 명|누가|공백|멀리/.test(q)) r.intent = 'diag'
  return r
}

let seq = 0
async function* tool(label: string, run: () => string): AsyncGenerator<AgentEvent> {
  const id = `t${++seq}`
  yield { type: 'tool_call', id, label }
  await sleep(450 + Math.random() * 350)
  yield { type: 'tool_result', id, result: run() }
}
async function* say(text: string): AsyncGenerator<AgentEvent> {
  for (let i = 0; i < text.length; i += 3) {
    yield { type: 'text', delta: text.slice(i, i + 3) }
    await sleep(16)
  }
}

export async function* ask(q: string, ctx: AgentCtx): AsyncGenerator<AgentEvent> {
  let r = parse(q, ctx.screen)
  if (ctx.pending) r = { ...ctx.pending, ...Object.fromEntries(Object.entries(r).filter(([, v]) => v != null)), intent: r.intent ?? ctx.pending.intent ?? null }
  const { model: m, assume } = ctx
  const g: Goal = {
    ...ctx.goal,
    service: r.service === 'pha' || r.service === 'gro' || r.service === 'med' ? r.service : ctx.goal.service,
    age: r.age ?? ctx.goal.age,
    T: r.T ?? ctx.goal.T,
    target: r.target ?? ctx.goal.target,
  }
  const sName = service(g.service).name
  const mode = g.mode === 'bus' ? '버스' : '자가용'

  switch (r.intent) {
    case 'mincost': {
      if (r.target == null && ctx.pending == null) {
        yield { type: 'apply', patch: { pending: { ...r } } }
        yield* say(`목표를 먼저 정해 주세요. ${ageName(g.age)}의 몇 %가 ${g.T}분 안에 ${sName}에 닿으면 될까요?`)
        yield { type: 'clarify', options: ['85%', '90%', '95%'] }
        break
      }
      let plans: Plan[] = []
      yield* tool(`diagnose(${sName}, ${mode}, ${ageName(g.age)}, ${g.T}분)`, () => {
        const d = diagnose(m, g.service, g.mode, g.age, g.T)
        return `공백 ${fmt(d.gap)}명 (${pct(d.rate)})`
      })
      yield* tool(`optimize(min_cost, 목표 ${Math.round(g.target * 100)}%)`, () => {
        plans = planSet(m, { ...g, budget: 30 }, assume)
        const c = plans.find((p) => p.id === 'C')!
        return c.meets ? `최소 연 ${eok(c.year)} · ${summarize(c, g.service)}` : '연 30억 안에서 목표를 못 맞춤'
      })
      const c = plans.find((p) => p.id === 'C')!
      if (!c.meets) {
        yield* say(`연 30억까지 써도 ${Math.round(g.target * 100)}%를 넘기는 조합을 찾지 못했어요. 목표를 낮추거나 쓸 수 있는 수단을 늘려 보세요.`)
        break
      }
      const budget = Math.max(0.5, Math.ceil(c.year * 10) / 10)
      yield { type: 'apply', patch: { target: g.target, age: g.age, service: g.service, threshold: g.T, budget, planShow: null, pending: null } }
      yield* say(`최소 예산은 연 ${eok(c.year)}이에요. ${c.name}(${summarize(c, g.service)})으로 ${pct(c.base)}에서 ${pct(c.rate)}까지 올라가요.`)
      yield* say(c.cap > 0 ? ` 설치비는 ${eok(c.cap)}이 따로 들어요.` : ' 설치비는 거의 들지 않아요.')
      yield* say(` 예산을 연 ${eok(budget)}으로 맞춰 세 안을 다시 계산했어요.`)
      break
    }
    case 'maxcov': {
      let plans: Plan[] = []
      yield* tool(`optimize(max_coverage, 예산 연 ${r.budget}억)`, () => {
        plans = planSet(m, { ...g, budget: r.budget! }, assume)
        const top = plans.filter((p) => p.withinBudget).sort((a, b) => b.rate - a.rate)[0]
        return top ? `${top.name} ${pct(top.rate)}` : '예산 안 조합 없음'
      })
      const ok = plans.filter((p) => p.withinBudget).sort((a, b) => b.rate - a.rate)
      yield { type: 'apply', patch: { budget: r.budget, target: g.target, planShow: ok[0]?.id ?? null } }
      if (!ok.length) { yield* say(`연 ${r.budget}억으로는 쓸 수 있는 조합이 없어요.`); break }
      const top = ok[0]
      yield* say(`연 ${r.budget}억이면 ${top.name}으로 ${pct(top.rate)}까지 돼요(${summarize(top, g.service)}). 지금은 ${pct(top.base)}예요.`)
      yield* say(top.rate >= g.target ? ` 목표 ${Math.round(g.target * 100)}%를 넘겨요.` : ` 목표 ${Math.round(g.target * 100)}%에는 ${pct(g.target - top.rate)}가 모자라요.`)
      break
    }
    case 'future':
    case 'why':
    case 'compare': {
      const plans = ctx.plans
      const rec = plans.find((p) => p.recommended)!
      yield* tool(`compare(A, B, C${r.intent === 'future' ? ', horizon_years=10' : ''})`, () => plans.map((p) => `${p.id} ${pct(p.rate)}·${eok(p.year)}`).join(' / '))
      if (r.intent === 'future') {
        yield* say(`추천안인 ${rec.name}은 지금 ${pct(rec.rate)}, 10년 뒤 ${pct(rec.future)}로 예상해요. `)
        yield* say(plans.filter((p) => !p.recommended).map((p) => `${p.name}은 10년 뒤 ${pct(p.future)}`).join(', ') + '예요.')
        yield* say(rec.future >= g.target ? ' 10년 뒤에도 목표를 지켜요.' : ` 10년 뒤에는 목표 ${Math.round(g.target * 100)}% 아래로 내려가니, 5년 뒤 다시 검토하는 게 좋아요.`)
      } else if (r.intent === 'why') {
        yield* say(`${rec.name}을 추천했어요. ${recommendReason(plans, g)}`)
      } else {
        yield* say(plans.map((p) => `${p.name}: ${pct(p.rate)}, 연 ${eok(p.year)}${p.meets ? '' : ' (목표 미달)'}`).join(' · '))
      }
      yield { type: 'apply', patch: { planShow: null } }
      break
    }
    case 'tele': {
      const before = ctx.plans.find((p) => p.recommended)!
      let plans: Plan[] = []
      yield* tool('get_assumptions()', () => `원격 효과계수 ${assume.tele} → ${r.tele}`)
      yield* tool(`compare(A, B, C, tele=${r.tele})`, () => {
        plans = planSet(m, g, { ...assume, tele: r.tele! })
        return plans.map((p) => `${p.id} ${pct(p.rate)}`).join(' / ')
      })
      const after = plans.find((p) => p.recommended)!
      yield { type: 'apply', patch: { tele: r.tele, planShow: null } }
      yield* say(`원격진료 효과를 ${r.tele}로 낮추면 `)
      yield* say(after.id === before.id ? `추천은 그대로 ${after.name}이에요(${pct(after.rate)}).` : `추천이 ${before.name}에서 ${after.name}으로 바뀌어요(${pct(after.rate)}, 연 ${eok(after.year)}).`)
      break
    }
    case 'diag': {
      const sid = r.service ?? ctx.goal.service
      const d = diagnose(m, sid, g.mode, g.age, ctx.goal.service === sid ? g.T : service(sid).T)
      const T = d.threshold
      yield* tool(`diagnose(${service(sid).name}, ${mode}, ${ageName(g.age)}, ${T}분)`, () => `공백 ${fmt(d.gap)}명 · 마을 ${d.topVillages.length}곳`)
      yield* say(`${service(sid).name}까지 ${T}분 넘게 걸리는 ${ageName(g.age)}은 ${fmt(d.gap)}명(${pct(d.rate)})이에요. `)
      yield* say(d.topVillages.length ? `공백이 큰 마을은 ${d.topVillages.slice(0, 3).map((v) => `${m.villages[v.village].name} ${fmt(v.gap)}명`).join(', ')}이에요.` : '공백 마을은 없어요.')
      if (!service(sid).optimizable) yield* say(` ${service(sid).name}은 진단만 하는 서비스라 대안 계산은 하지 않아요.`)
      break
    }
    case 'memoShort':
      yield* tool('write_memo(권고, 세 줄 이내)', () => '권고 문단 다시 씀')
      yield { type: 'apply', patch: { memo: { shortRec: true } } }
      yield* say('권고 문단을 세 줄로 줄였어요. 숫자는 그대로 계산 결과에서 가져왔어요.')
      break
    case 'memoSummary':
      yield* tool('write_memo(결재 요약)', () => '맨 위에 한 줄 요약 추가')
      yield { type: 'apply', patch: { memo: { summaryLine: true } } }
      yield* say('결재용 한 줄 요약을 맨 위에 넣었어요.')
      break
    case 'memoLimit':
      yield* tool('get_assumptions()', () => '원격진료 시점, 기준 시간 출처')
      yield { type: 'apply', patch: { memo: { addLimit: '경로당 원격진료는 비대면진료 의료법 시행(2026.12.24) 전이라 시범사업 기반 시나리오다.' } } }
      yield* say('가정과 한계에 원격진료 시행 시점을 넣었어요.')
      break
    case 'memoSwitch': {
      const p = ctx.plans.find((x) => x.id === r.plan)!
      yield* tool(`write_memo(권고=${p.name})`, () => `${p.name} ${pct(p.rate)}·연 ${eok(p.year)}`)
      yield { type: 'apply', patch: { memo: { recPlan: p.id }, planShow: p.id } }
      yield* say(`권고안을 ${p.name}으로 바꿨어요. ${p.meets ? '' : `다만 이 안은 목표 ${Math.round(g.target * 100)}%에 못 미쳐요(${pct(p.rate)}).`}`)
      break
    }
    default:
      yield* say('이 시제품은 최소 예산, 예산별 달성률, 공백 마을, 10년 뒤 변화, 추천 이유, 원격진료 효과 바꾸기를 답할 수 있어요. 아래 추천 질문을 눌러 보세요.')
  }
  if (r.intent && !r.intent.startsWith('memo')) yield { type: 'basis', text: `쓴 가정: 원격 효과 ${r.tele ?? assume.tele}, 공공형 택시 효과 ${assume.taxi}, 기준 ${g.T}분, 단가표 가정값` }
  yield { type: 'done', intent: r.intent }
}

// 화면과 방금 한 질문에 맞춰 다음에 물어볼 만한 질문을 바꿔 준다
export function suggest(ctx: AgentCtx, last: Intent | null, asked: Set<string>): string[] {
  const g = ctx.goal, rec = ctx.plans.find((p) => p.recommended)!
  const pctT = Math.round(g.target * 100), sName = service(g.service).name
  const half = Math.max(1, Math.round(g.budget / 2))
  const other = ctx.plans.find((p) => !p.recommended && p.meets) ?? ctx.plans.find((p) => !p.recommended)!
  const pool: string[] =
    ctx.screen === 'memo'
      ? ['권고 문단을 세 줄로 줄여 줘', '결재용 한 줄 요약을 맨 위에 넣어 줘', '가정과 한계에 원격진료 시행 시점을 넣어 줘', `권고안을 ${other.name}으로 바꿔 줘`, '10년 뒤에도 추천안이 괜찮나요?']
      : last === 'mincost'
        ? [`예산을 연 ${Math.max(1, Math.floor(g.budget) - 1)}억으로 줄이면 몇 %까지 되나요?`, '원격진료 효과가 0.3으로 낮아지면요?', `목표를 ${pctT - 5}%로 낮추면 최소 예산은 얼마예요?`, '왜 이 안을 추천했어요?']
        : last === 'maxcov'
          ? ['10년 뒤에도 추천안이 괜찮나요?', `${ageName(g.age)} ${pctT}%가 ${g.T}분 안에 ${sName}에 가려면 최소 예산은 얼마예요?`, '세 안을 비교해 줘']
          : last === 'tele'
            ? ['원격진료 효과가 0.7이면요?', '왜 이 안을 추천했어요?', '10년 뒤에도 추천안이 괜찮나요?']
            : last === 'diag'
              ? ['약국 공백이 큰 마을은 어디예요?', '도서관까지 멀리 사는 사람은 몇 명이에요?', `80세 이상 어르신 ${pctT}%가 ${g.T}분 안에 병원에 가려면 예산이 최소 얼마예요?`]
              : [
                  `80세 이상 어르신 ${pctT}%가 ${g.T}분 안에 병원에 가려면 예산이 최소 얼마예요?`,
                  `예산이 연 ${half}억이면 몇 %까지 되나요?`,
                  '약국 공백이 큰 마을은 어디예요?',
                  '10년 뒤에도 추천안이 괜찮나요?',
                  '도서관까지 멀리 사는 사람은 몇 명이에요?',
                  `왜 ${rec.name}을 추천했어요?`,
                ]
  const fresh = pool.filter((q) => !asked.has(q))
  return (fresh.length >= 3 ? fresh : pool).slice(0, 4)
}
