// AI 에이전트 (시제품: 정해진 규칙으로 흉내).
// 실서비스는 LLM 에이전트가 같은 계산 함수(diagnose / optimize / compare)를 도구로 불러 답하고, 아래 이벤트를 SSE로 흘려보낸다.
// 답에 나오는 숫자는 도구 결과에서만 가져온다. 백엔드가 준비되면 같은 이벤트를 내는 http 구현으로 바꾼다.
import type { Region } from '../data/regions'
import { LEVERS, crossChain, costAt, lever, leverCurve, planSet, preset, type Alloc, type CostLevel, type Costs, type LeverId, type Plan, type PresetId } from '../sim/model'

export type AgentEvent =
  | { type: 'tool_call'; id: string; label: string }
  | { type: 'tool_result'; id: string; result: string }
  | { type: 'text'; delta: string }
  | { type: 'clarify'; question: string; options: { label: string; preset: PresetId }[] }
  | { type: 'apply'; preset: PresetId; reason: string }
  | { type: 'done' }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let seq = 0
async function* say(text: string): AsyncGenerator<AgentEvent> {
  for (let i = 0; i < text.length; i += 2) {
    yield { type: 'text', delta: text.slice(i, i + 2) }
    await sleep(18)
  }
}

// ---------- S3: 자연어 목표 → 프리셋 ----------
const RULES: { preset: PresetId | 'transit'; re: RegExp }[] = [
  { preset: 'med', re: /응급|병원|의사|진료|구급|의료|아플|아프|분만|소아/g },
  { preset: 'safe', re: /사고|안전|과속|횡단|보행|사망|위험|도로|교차로/g },
  { preset: 'bal', re: /균형|골고루|둘\s*다|모두|전반|고르게|같이/g },
  { preset: 'transit', re: /버스|대중교통|교통편|배차|DRT|정류장|이동/g },
]
const CLARIFY = {
  question: '응급실 접근성과 교통사고 중 무엇이 더 급하세요?',
  options: [
    { label: '응급실 가는 시간', preset: 'med' as const },
    { label: '교통사고 줄이기', preset: 'safe' as const },
    { label: '둘 다 비슷해요', preset: 'bal' as const },
  ],
}

export function parseGoal(text: string) {
  const hits = Object.fromEntries(RULES.map((r) => [r.preset, [...new Set(text.match(r.re) ?? [])]])) as Record<PresetId | 'transit', string[]>
  const med = hits.med.length, safe = hits.safe.length, bal = hits.bal.length, transit = hits.transit.length
  const said = (ws: string[]) => `‘${ws.join('’, ‘')}’를 말씀하셨어요`
  // 의료와 사고를 같이 말하면 애매하다 → 균형을 직접 말했으면 균형, 아니면 되묻는다
  const [pick, reason]: [PresetId | null, string] =
    med && safe ? (bal ? ['bal', '의료와 교통안전을 함께 말씀하셨어요'] : [null, ''])
    : med ? ['med', said(hits.med)]
    : safe ? ['safe', said(hits.safe)]
    : bal ? ['bal', said(hits.bal)]
    : transit ? ['bal', `‘${hits.transit.join('’, ‘')}’는 교통이지만 병원 가는 시간도 줄여서(교차효과) 의료와 교통을 함께 보는 균형이 맞아요`]
    : [null, '']
  return { pick, reason, hits }
}

export async function* mapGoal(text: string): AsyncGenerator<AgentEvent> {
  const id = `t${++seq}`
  const short = text.length > 18 ? text.slice(0, 18) + '…' : text
  yield { type: 'tool_call', id, label: `map_goal("${short}")` }
  await sleep(650)
  const { pick, reason } = parseGoal(text)
  yield { type: 'tool_result', id, result: pick ? `${preset(pick).icon} ${preset(pick).name}` : '애매함 → 되묻기' }
  if (!pick) {
    yield* say('목표를 조금 더 알려 주세요. ')
    yield* say(CLARIFY.question)
    yield { type: 'clarify', ...CLARIFY }
  } else {
    const p = preset(pick)
    yield* say(`${reason}. 가장 가까운 목표는 ‘${p.icon} ${p.name}’이에요(의료 비중 ${Math.round(p.gamma * 100)}%). 그래도 세 가지를 모두 계산해서 비교해 드릴게요.`)
    yield { type: 'apply', preset: pick, reason }
  }
  yield { type: 'done' }
}

// ---------- S6: What-if 한 줄 해설 (계산 결과 숫자만 쓴다) ----------
export interface WhatIfFacts {
  base: number; next: number
  baseAlloc: Alloc; nextAlloc: Alloc
  v: { now: number; base: number; next: number }
  slopeRatio: number // 지금 구간의 1억당 효과 ÷ 처음 50억의 1억당 효과
  left: number
}
export function explainWhatIf(f: WhatIfFacts) {
  const d = f.next - f.base
  if (Math.abs(d) < 1) return '슬라이더를 움직여 예산을 늘리거나 줄여 보세요. 늘어난 돈이 어느 정책으로 가는지 바로 보여 드려요.'
  const deltas = LEVERS.map((l) => ({ id: l.id as LeverId, d: f.nextAlloc[l.id] - f.baseAlloc[l.id] })).filter((x) => Math.abs(x.d) >= 1)
  const parts: string[] = []
  if (d > 0) {
    const top = [...deltas].sort((a, b) => b.d - a.d)[0]
    if (top) parts.push(`${Math.round(d)}억 추가 시 ${lever(top.id).short}에 가장 많이(+${Math.round(top.d)}억) 가요.`)
    const fresh = deltas.filter((x) => f.baseAlloc[x.id] < 1 && x.d > 0)
    if (fresh.length) parts.push(`${fresh.map((x) => lever(x.id).short).join(', ')}${fresh.some((x) => x.id === 'struct') ? '는 단가가 비싸서, 다른 정책이 포화된' : '는'} 이 구간부터 우선순위에 들어옵니다.`)
    parts.push(`종합 취약도는 ${Math.round(f.v.base)}점에서 ${Math.round(f.v.next)}점으로 내려가요.`)
    if (f.slopeRatio < 0.5) parts.push(`다만 1억당 효과가 처음의 ${Math.round(f.slopeRatio * 100)}% 수준인 효과 체감 구간이에요.`)
    if (f.left >= 1) parts.push(`모든 정책이 실행 상한에 닿아 ${Math.round(f.left)}억은 쓸 곳이 없어요.`)
  } else {
    const top = [...deltas].sort((a, b) => a.d - b.d)[0]
    if (top) parts.push(`${Math.round(-d)}억 줄이면 ${lever(top.id).short}부터 줄어요(${Math.round(top.d)}억).`)
    const gone = deltas.filter((x) => f.nextAlloc[x.id] < 1)
    if (gone.length) parts.push(`${gone.map((x) => lever(x.id).short).join(', ')}는 빠져요.`)
    parts.push(`종합 취약도는 ${Math.round(f.v.base)}점이 아니라 ${Math.round(f.v.next)}점까지만 내려가요.`)
  }
  return parts.join(' ')
}

// ---------- 'AI에게 물어보기' 창 (VillageCoverage 정책 질의 에이전트와 같은 이벤트) ----------

export type Screen = 'diag' | 'goal' | 'sim' | 'result' | 'whatif' | 'report'
type Intent = 'budget' | 'release' | 'ms80' | 'mincost' | 'struct' | 'cross' | 'why' | 'compare' | 'preset' | 'level' | 'lever' | 'diag'
export interface AgentCtx { region: Region; screen: Screen; budget: number; main: PresetId; level: CostLevel; costs: Costs; minMed: number; plans: Plan[]; pending: { intent: Intent } | null }
export interface Patch { budget?: number; main?: PresetId; level?: CostLevel; detail?: PresetId | null; pending?: { intent: Intent } | null }
export type AskEvent =
  | { type: 'tool_call'; id: string; label: string }
  | { type: 'tool_result'; id: string; result: string }
  | { type: 'text'; delta: string }
  | { type: 'clarify'; options: string[] }
  | { type: 'apply'; patch: Patch }
  | { type: 'basis'; text: string }
  | { type: 'done'; intent: Intent | null }

const eok = (x: number) => `${Math.round(x)}억`
const sc = (x: number) => `${Math.round(x)}점`
const pctS = (x: number) => `${Math.round(x * 100)}%`
const LEVEL_NAME: Record<CostLevel, string> = { low: '저', mid: '중', high: '고' }

function parseAsk(q: string, pending: AgentCtx['pending']) {
  const b = q.match(/(\d{2,3})\s*억/)
  const presetPick: PresetId | undefined = /(응급|의료).*(우선|중심)/.test(q) ? 'med' : /(교통\s*안전|사고).*(우선|중심)/.test(q) ? 'safe' : /균형/.test(q) ? 'bal' : undefined
  const lv = LEVERS.find((l) => q.includes(l.short) || (l.id === 'drt' && /DRT|수요응답/.test(q)) || (l.id === 'struct' && /회전교차로/.test(q)))
  let intent: Intent | null = null
  if (pending?.intent === 'mincost') intent = /해제|응급/.test(q) ? 'release' : /최소서비스|80|대중교통/.test(q) ? 'ms80' : null
  if (!intent) {
    if (presetPick && /바꿔|으로|로 해|기준/.test(q)) intent = 'preset'
    else if (/해제|취약지\s*(벗|빠)/.test(q)) intent = 'release'
    else if (/최소\s*서비스|80\s*%/.test(q)) intent = 'ms80'
    else if (/최소|얼마면|얼마가/.test(q) && !b) intent = 'mincost'
    else if (b) intent = 'budget'
    else if (/구조\s*개선|다발\s*지점|회전교차로/.test(q) && /언제|부터|몇|얼마/.test(q)) intent = 'struct'
    else if (/교차|병원\s*가는|의료에/.test(q) || (/버스/.test(q) && /의료|병원/.test(q))) intent = 'cross'
    else if (/단가|비싸|오르면|내리면|싸지면/.test(q)) intent = 'level'
    else if (lv && /왜|얼마|이유/.test(q)) intent = 'lever'
    else if (/왜|이유|추천/.test(q)) intent = 'why'
    else if (/비교|차이|세\s*안|3\s*안/.test(q)) intent = 'compare'
    else if (/문제|취약한|약점|어디/.test(q)) intent = 'diag'
  }
  return { intent, budget: b ? Math.min(300, Math.max(10, +b[1])) : undefined, presetPick, lever: lv?.id, up: /오르|비싸|고/.test(q) }
}

let askSeq = 0
async function* toolA(label: string, run: () => string): AsyncGenerator<AskEvent> {
  const id = `q${++askSeq}`
  yield { type: 'tool_call', id, label }
  await sleep(450 + Math.random() * 350)
  yield { type: 'tool_result', id, result: run() }
}
async function* sayA(text: string): AsyncGenerator<AskEvent> {
  for (let i = 0; i < text.length; i += 3) {
    yield { type: 'text', delta: text.slice(i, i + 3) }
    await sleep(16)
  }
}

export async function* ask(q: string, ctx: AgentCtx): AsyncGenerator<AskEvent> {
  const r = parseAsk(q, ctx.pending)
  const { region: rg, main } = ctx
  const mp = preset(r.presetPick ?? main)
  const run = (B: number, lv: CostLevel = ctx.level) => planSet(rg, B, ctx.costs, lv, ctx.minMed)
  const mine = (ps: Plan[], id: PresetId = mp.id) => ps.find((p) => p.preset === id)!
  // 조건을 만족하는 가장 작은 예산 (5억 단위)
  const minB = (ok: (p: Plan) => boolean) => { for (let B = 10; B <= 300; B += 5) if (ok(mine(run(B)))) return B; return null }
  if (ctx.pending && r.intent) yield { type: 'apply', patch: { pending: null } }

  switch (r.intent) {
    case 'budget': {
      const B = r.budget!
      let ps: Plan[] = []
      yield* toolA(`optimize × 3 (${rg.name}, ${B}억)`, () => { ps = run(B); const rc = ps.find((p) => p.recommended)!; return `추천 ${preset(rc.preset).name} · 종합 ${sc(rc.neutral.before)}→${sc(rc.neutral.after)}` })
      const rc = ps.find((p) => p.recommended)!, now = mine(ctx.plans, main), next = mine(ps, main)
      yield { type: 'apply', patch: { budget: B, detail: null } }
      yield* sayA(`${B}억이면 ${preset(rc.preset).icon} ${preset(rc.preset).name}안을 추천해요. 종합 취약도가 ${sc(rc.neutral.before)}에서 ${sc(rc.neutral.after)}으로, 수혜 인구는 ${fmtN(rc.benefit)}명이에요. `)
      const fresh = LEVERS.filter((l) => now.opt.alloc[l.id] === 0 && next.opt.alloc[l.id] > 0)
      const gone = LEVERS.filter((l) => now.opt.alloc[l.id] > 0 && next.opt.alloc[l.id] === 0)
      if (fresh.length) yield* sayA(`지금 ${ctx.budget}억과 비교하면 ${mp.name}안에 ${fresh.map((l) => l.short).join(', ')}이(가) 새로 들어와요. `)
      if (gone.length) yield* sayA(`${gone.map((l) => l.short).join(', ')}은(는) 빠져요. `)
      if (next.vulnerableBefore) yield* sayA(next.vulnerableAfter ? '응급의료 취약지 기준은 아직 못 벗어나요.' : '응급의료 취약지 기준(27%) 아래로 내려가요.')
      yield* sayA(' 예산을 바꿔 세 안을 다시 계산했어요.')
      break
    }
    case 'release':
    case 'ms80': {
      const release = r.intent === 'release'
      if (release && !mine(ctx.plans).vulnerableBefore) { yield* sayA(`${rg.name}은 지금도 응급의료 취약지 기준(27%) 아래예요. 응급실 30분 밖 주민은 ${pctS(rg.e30)}예요.`); break }
      let B: number | null = null
      yield* toolA(`optimize(min_budget, ${mp.name}, ${release ? '응급취약 해제' : '최소서비스 80%'})`, () => { B = minB((p) => (release ? !p.vulnerableAfter : p.opt.after.ms >= 0.8)); return B ? `최소 ${B}억` : '300억 안에서 못 맞춤' })
      if (!B) { yield* sayA(`300억까지 써도 ${mp.name} 목표로는 ${release ? '응급의료 취약지 기준을 벗어나지' : '최소서비스 80%를 넘기지'} 못해요. 목표를 바꾸거나 분야 최소 보장을 켜 보세요.`); break }
      const p = mine(run(B))
      yield { type: 'apply', patch: { budget: B, main: mp.id, detail: mp.id } }
      yield* sayA(`${mp.name} 목표로 최소 ${B}억이면 돼요. `)
      yield* sayA(release ? `응급실 30분 밖 주민이 ${pctS(p.opt.before.e30)}에서 ${pctS(p.opt.after.e30)}로 내려가요. 응급 거점에 ${eok(p.opt.alloc.er)}이 들어가요.` : `최소서비스가 ${pctS(p.opt.before.ms)}에서 ${pctS(p.opt.after.ms)}로 올라가요. 버스 증차 ${eok(p.opt.alloc.bus)}, DRT ${eok(p.opt.alloc.drt)}이에요.`)
      yield* sayA(` 예산을 ${B}억으로 맞춰 다시 계산했어요.`)
      break
    }
    case 'mincost':
      yield { type: 'apply', patch: { pending: { intent: 'mincost' } } }
      yield* sayA('어떤 목표를 맞추는 최소 예산을 찾을까요?')
      yield { type: 'clarify', options: ['응급취약 해제까지', '대중교통 최소서비스 80%까지'] }
      break
    case 'struct': {
      let B: number | null = null
      yield* toolA(`optimize(${mp.name}, 10~300억 탐색)`, () => { B = minB((p) => p.opt.alloc.struct > 0); return B ? `${B}억부터 구조개선 배정` : '300억까지 배정 없음' })
      if (!B) { yield* sayA(`${mp.name} 목표로는 300억까지 넣어도 구조개선에 배정되지 않아요. 단가가 비싸서 다른 정책의 1억당 효과가 더 커요.`); break }
      yield* sayA(`${mp.name} 목표에서는 ${B}억부터 위험도로·다발지점 구조개선이 처음 배정돼요. 버스 증차·DRT·응급 거점이 먼저 포화되고 나서, 1억당 효과가 상대적으로 커지는 지점이에요. 다발지점이 ${rg.hotspots}곳이라 상한은 ${rg.hotspots}곳이에요.`)
      break
    }
    case 'cross': {
      const p = mine(ctx.plans)
      const cc = crossChain(rg, mp, p.opt.alloc, costAt(ctx.costs, ctx.level))
      yield* toolA(`cross_effect(${mp.name}, 버스·DRT)`, () => `배차 ${Math.round(cc.h[0])}→${Math.round(cc.h[1])}분 · 의료 ${cc.mvi.toFixed(1)}점`)
      if (p.opt.alloc.bus + p.opt.alloc.drt === 0) { yield* sayA(`${mp.name}안은 버스 증차·DRT에 배정하지 않아 교차효과가 없어요.`); break }
      yield* sayA(`버스 증차·DRT에 ${eok(p.opt.alloc.bus + p.opt.alloc.drt)}을 넣으면 배차간격이 ${Math.round(cc.h[0])}분에서 ${Math.round(cc.h[1])}분으로 줄고, 병원까지 대중교통이 ${Math.round(cc.ht[0])}분에서 ${Math.round(cc.ht[1])}분이 돼요. 그래서 교통 예산인데도 의료 점수가 ${Math.abs(cc.mvi).toFixed(1)}점 내려가요.`)
      yield { type: 'apply', patch: { detail: mp.id } }
      break
    }
    case 'why':
    case 'compare': {
      const ps = ctx.plans, rc = ps.find((p) => p.recommended)!
      yield* toolA('compare(3안)', () => ps.map((p) => `${preset(p.preset).name} ${sc(p.neutral.after)}·${fmtN(p.benefit)}명`).join(' / '))
      if (r.intent === 'why') yield* sayA(`${preset(rc.preset).name}안을 추천했어요. 세 안을 같은 잣대(균형 가중치)로 재면 종합 취약도가 ${sc(rc.neutral.before)}에서 ${sc(rc.neutral.after)}으로 내려가고 ${fmtN(rc.benefit)}명이 혜택을 받아, ‘취약도 감소 × 수혜 인구’가 가장 커요.`)
      else yield* sayA(ps.map((p) => `${preset(p.preset).icon} ${preset(p.preset).name}: 종합 ${sc(p.neutral.after)}, 수혜 ${fmtN(p.benefit)}명${p.vulnerableBefore ? (p.vulnerableAfter ? ', 응급취약 유지' : ', 응급취약 해제') : ''}`).join(' · '))
      yield { type: 'apply', patch: { detail: rc.preset } }
      break
    }
    case 'preset': {
      const p = mine(ctx.plans)
      yield* toolA(`get_assumptions(${mp.name})`, () => `의료 비중 γ ${mp.gamma}`)
      yield { type: 'apply', patch: { main: mp.id, detail: mp.id } }
      yield* sayA(`주 목표를 ${mp.icon} ${mp.name}으로 바꿨어요(의료 비중 ${Math.round(mp.gamma * 100)}%). 이 안은 ${LEVERS.filter((l) => p.opt.alloc[l.id] > 0).map((l) => `${l.short} ${eok(p.opt.alloc[l.id])}`).join(', ')}이에요.`)
      break
    }
    case 'level': {
      const lv: CostLevel = r.up ? 'high' : 'low'
      let ps: Plan[] = []
      yield* toolA(`compare(3안, 단가=${LEVEL_NAME[lv]})`, () => { ps = run(ctx.budget, lv); return ps.map((p) => `${preset(p.preset).name} ${sc(p.after.v)}`).join(' / ') })
      const before = ctx.plans.find((p) => p.recommended)!, after = ps.find((p) => p.recommended)!
      yield { type: 'apply', patch: { level: lv } }
      yield* sayA(`단가를 ${LEVEL_NAME[lv]}로 바꾸면 `)
      yield* sayA(after.preset === before.preset ? `추천은 그대로 ${preset(after.preset).name}안이고, ${mp.name}안 종합 취약도는 ${sc(mine(ps).after.v)}이에요.` : `추천이 ${preset(before.preset).name}안에서 ${preset(after.preset).name}안으로 바뀌어요.`)
      break
    }
    case 'lever': {
      const p = mine(ctx.plans), c = costAt(ctx.costs, ctx.level)
      const lc = leverCurve(rg, mp, r.lever!, p.opt.alloc, c)
      const l = LEVERS.find((x) => x.id === r.lever)!
      yield* toolA(`explain_lever(${l.short}, ${mp.name})`, () => `${eok(p.opt.alloc[l.id])} · 다음 1억 ${lc.mine?.toFixed(3) ?? '상한'}`)
      yield { type: 'apply', patch: { detail: mp.id } }
      yield* sayA(`${mp.name}안은 ${l.short}에 ${eok(p.opt.alloc[l.id])}을 넣어요. `)
      yield* sayA(lc.capped ? `실행 상한(${Math.round(lc.max)}억)에 닿아서 더 넣을 수 없어요.` : `여기서 1억을 더 넣으면 종합 취약도가 ${lc.mine!.toFixed(3)}점 줄지만, ${lc.rival ? `${LEVERS.find((x) => x.id === lc.rival!.l)!.short}에 넣으면 ${lc.rival.g.toFixed(3)}점이라` : '다른 정책이 더 커서'} 멈췄어요.`)
      break
    }
    case 'diag': {
      const p = ctx.plans[0], b = p.opt.before
      yield* toolA(`diagnose(${rg.name})`, () => '지표 6개')
      const bad = [
        b.e30 >= 0.27 && `응급실 30분 밖 ${pctS(b.e30)}(기준 27%)`,
        b.e60 >= 0.27 && `권역센터 60분 밖 ${pctS(b.e60)}`,
        b.ms < 0.8 && `대중교통 최소서비스 ${pctS(b.ms)}(기준 80%)`,
        b.ar > 4.9 && `교통사고 사망률 전국 평균의 ${(b.ar / 4.9).toFixed(1)}배`,
        b.ht > 60 && `병원까지 대중교통 ${Math.round(b.ht)}분`,
      ].filter(Boolean)
      yield* sayA(bad.length ? `${rg.name}에서 기준을 못 맞추는 건 ${bad.join(', ')}이에요.` : `${rg.name}은 공식 기준을 모두 맞춰요.`)
      break
    }
    default:
      yield* sayA('이 시제품은 예산 바꿔 보기, 응급취약 해제·최소서비스 80%에 필요한 최소 예산, 추천 이유, 구조개선이 들어오는 시점, 버스 증차의 교차효과, 단가가 바뀔 때를 답할 수 있어요. 아래 추천 질문을 눌러 보세요.')
  }
  if (r.intent && r.intent !== 'mincost') yield { type: 'basis', text: `쓴 가정: 단가 ${LEVEL_NAME[ctx.level]}, 프리셋 가중치 예시값, 지표 예시값` }
  yield { type: 'done', intent: r.intent }
}
const fmtN = (n: number) => Math.round(n).toLocaleString('ko-KR')

// 화면과 방금 한 질문에 맞춰 다음에 물어볼 만한 질문을 바꿔 준다
export function suggestAsk(ctx: AgentCtx, last: Intent | null, asked: Set<string>): string[] {
  const up = Math.min(300, ctx.budget + 50), down = Math.max(10, ctx.budget - 50)
  const pool =
    last === 'budget' ? ['구조개선은 언제부터 들어와요?', '왜 이 안을 추천했어요?', `예산을 ${down}억으로 줄이면요?`, '단가가 오르면요?']
    : last === 'release' || last === 'ms80' ? ['버스 증차가 의료에 주는 효과는?', '세 안을 비교해 줘', '대중교통 최소서비스 80%까지 최소 얼마예요?']
    : last === 'cross' ? ['DRT에 왜 이만큼 넣었어요?', '응급취약 해제하려면 최소 얼마예요?', `예산이 ${up}억이면요?`]
    : ctx.screen === 'diag' ? ['어디가 가장 문제예요?', '응급취약 해제하려면 최소 얼마예요?', '버스 증차가 의료에 주는 효과는?']
    : ctx.screen === 'report' ? ['교통안전 우선으로 바꿔 줘', '왜 이 안을 추천했어요?', `예산이 ${up}억이면요?`]
    : [`예산이 ${up}억이면요?`, '응급취약 해제하려면 최소 얼마예요?', '왜 이 안을 추천했어요?', '구조개선은 언제부터 들어와요?', '버스 증차가 의료에 주는 효과는?', '단가가 오르면요?']
  const fresh = pool.filter((q) => !asked.has(q))
  return (fresh.length >= 3 ? fresh : pool).slice(0, 4)
}
