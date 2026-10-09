// AI 레포트 초안 (구현안 4-5 목차). 시제품은 계산 결과를 틀에 채워 문장을 만든다.
// 문장 속 숫자는 모두 { n, tip } 토큰이라 화면에서 "이 숫자를 낸 도구 결과"를 보여 주고, 숫자 대조 검사에 쓴다.
import { REGIONS, type Region } from '../data/regions'
import { LEVERS, STD, planSet, preset, score, type Costs, type CostLevel, type Plan, type PresetId } from '../sim/model'

export type Seg = string | { n: string; tip: string }
export interface Section { id: string; title: string; segs: Seg[] }
export interface Report {
  title: string
  sections: Section[]
  plans: Plan[]
  rec: Plan
  compare: { r: Region; p: Plan }[] // 3군 비교 (같은 예산·프리셋)
  allowed: Set<string> // 숫자 대조 기준
  costs: Costs
}

const pc = (x: number) => `${Math.round(x * 100)}%`
const f0 = (x: number) => Math.round(x).toLocaleString('ko-KR')
const f1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1)
export const numsOf = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((x) => x.replace(/,/g, ''))

export function buildReport(r: Region, budget: number, main: PresetId, costs: Costs, level: CostLevel, minMed: number): Report {
  const plans = planSet(r, budget, costs, level, minMed)
  const rec = plans.find((p) => p.recommended)!
  const pr = preset(rec.preset)
  const b = rec.opt.before, a = rec.opt.after
  const bal = score(b, preset('bal'))
  const D = `diagnose(${r.name})`
  const O = (p: Plan) => `optimize(${preset(p.preset).name}, ${budget}억)`
  const N = (n: string, tip: string): Seg => ({ n, tip })
  const total = r.budget.health + r.budget.transport

  const status: Seg[] = [
    `${r.name}은 주민 `, N(`${f0(r.pop)}명`, `${D} → 인구 (KOSIS)`), ' 가운데 65세 이상이 ', N(pc(r.elderly), `${D} → 고령비율`), '다. 응급실 30분 밖 주민이 ',
    N(pc(b.e30), `${D} → E30 (NMC)`), b.e30 >= STD.theta ? '로 응급의료 취약지 기준(27%)을 넘고, ' : '로 응급의료 취약지 기준(27%) 아래이고, ',
    '대중교통 최소서비스 달성률은 ', N(pc(b.ms), `${D} → MS = (공간+시간)/2`), b.ms >= STD.msTarget ? '로 확보 기준(80%)을 충족한다. ' : '로 확보 기준(80%)에 못 미친다. ',
    '교통사고 사망자는 인구 10만명당 ', N(`${f1(b.ar)}명`, `${D} → AR (TAAS)`), '으로 전국 평균의 ', N(`${f1(b.ar / STD.natAR)}배`, `${D} → AR ÷ 전국 ${STD.natAR}`), '이고, 병원까지 대중교통으로 ',
    N(`${f0(b.ht)}분`, `${D} → HT = 도보+배차/2+승차`), '이 걸린다. 균형 가중치로 잰 의료 취약도는 ', N(`${f0(bal.mvi)}점`, `${D} → MVI(균형)`), ', 교통 취약도는 ', N(`${f0(bal.tvi)}점`, `${D} → TVI(균형)`),
    '이다. 현재 보건·수송및교통 세출은 ', N(`${f0(total)}억`, `${D} → 지방재정365`), ', 주민 1인당 ', N(`${f0((total * 1e8) / r.pop / 1e4)}만 원`, `${D} → 세출 ÷ 인구`), '이다.',
  ]

  const used = LEVERS.filter((l) => rec.opt.alloc[l.id] > 0).sort((x, y) => rec.opt.alloc[y.id] - rec.opt.alloc[x.id])
  const others = plans.filter((p) => p !== rec)
  const recText: Seg[] = [
    `총 ${budget}억을 세 가지 정책 목표로 각각 배분해 비교했고, `, N(`${pr.icon} ${pr.name}안`, 'compare(3안) → 추천'), '을 추천한다. 이 안은 ',
    ...used.flatMap((l, i): Seg[] => [i ? ', ' : '', `${l.short} `, N(`${rec.opt.alloc[l.id]}억`, `${O(rec)} → ${l.short}`)]),
    '으로 구성된다. 세 안을 같은 잣대(균형 가중치)로 쟀을 때 종합 취약도가 ', N(`${f0(rec.neutral.before)}점`, `${O(rec)} → 균형 잣대 전`), '에서 ', N(`${f0(rec.neutral.after)}점`, `${O(rec)} → 균형 잣대 후`),
    '으로 내려가고 ', N(`${f0(rec.benefit)}명`, `${O(rec)} → 수혜 인구`), '이 혜택을 받아, ‘취약도 감소 × 수혜 인구’가 가장 크다. ',
    ...others.flatMap((p): Seg[] => [`${preset(p.preset).name}안은 `, N(`${f0(p.neutral.after)}점`, `${O(p)} → 균형 잣대 후`), '·', N(`${f0(p.benefit)}명`, `${O(p)} → 수혜 인구`), '이다. ']),
  ]

  // 배분 순서: 각 정책이 몇 억째부터 배정되기 시작했는지
  const first = LEVERS.map((l) => ({ l, at: rec.opt.steps.findIndex((s) => s.lever === l.id) })).filter((x) => x.at >= 0).sort((x, y) => x.at - y.at)
  const zero = LEVERS.filter((l) => rec.opt.alloc[l.id] === 0)
  const basis: Seg[] = [
    '공공데이터 지표 6개를 점수로 바꿨다. 비율 지표(E30·E60·최소서비스)는 값 그대로, 수량 지표(의사 수)는 전국 평균 대비 부족률, 사망률과 병원 대중교통시간은 설정 기준 대비 비율로 0–100점을 만들고, ',
    `${pr.name} 가중치(의료 비중 γ = `, N(`${pr.gamma}`, `get_assumptions() → ${pr.name} γ`), ')로 종합 취약도를 냈다. 정책마다 단가와 효과함수(한계효용 체감)를 두고, 1억씩 ‘그 순간 종합 취약도를 가장 많이 낮추는 정책’에 배정하기를 반복했다. 배정 순서는 ',
    ...first.flatMap(({ l, at }, i): Seg[] => [i ? ' → ' : '', `${l.short}(`, N(`${at + 1}억째`, `${O(rec)} → 배정 순서`), ')']),
    zero.length ? ` 순이며, ${zero.map((l) => l.short).join('·')}는 다른 정책보다 1억당 효과가 작아 배정되지 않았다.` : ' 순이다.',
    ' 버스 증차·DRT는 배차간격과 도보시간을 줄여 병원까지 대중교통시간을 낮추고, 이것이 실효 E30을 낮춰 의료 점수도 개선하는 교차효과로 반영했다.',
  ]

  const deaths = rec.deathsAvoided
  const effect: Seg[] = [
    `${pr.name} 가중치로 의료 취약도는 `, N(`${f0(rec.before.mvi)}→${f0(rec.after.mvi)}점`, `${O(rec)} → MVI 전/후`), ', 교통 취약도는 ', N(`${f0(rec.before.tvi)}→${f0(rec.after.tvi)}점`, `${O(rec)} → TVI 전/후`), '으로 개선된다. ',
    '응급실 30분 밖 주민은 ', N(`${pc(b.e30)}→${pc(a.e30)}`, `${O(rec)} → E30 전/후`), rec.vulnerableBefore ? (rec.vulnerableAfter ? '로 줄지만 응급의료 취약지 기준은 아직 넘는다. ' : '로 줄어 응급의료 취약지 기준(27%) 아래로 내려간다. ') : '로 줄어든다. ',
    '실효 기준으로 ', N(`${f0(rec.benefitParts.er)}명`, `${O(rec)} → 응급 수혜`), '이 새로 30분 안에 응급실에 닿고, 대중교통 최소서비스는 ', N(`${pc(b.ms)}→${pc(a.ms)}`, `${O(rec)} → MS 전/후`), '로 올라 ',
    N(`${f0(rec.benefitParts.transit)}명`, `${O(rec)} → 대중교통 수혜`), '이 혜택을 받는다. 병원까지 대중교통시간은 ', N(`${f0(b.ht)}→${f0(a.ht)}분`, `${O(rec)} → HT 전/후`), '이다. ',
    deaths > 0.005 ? ['교통사고 사망자는 연 ', N(`${f1(deaths)}명`, `${O(rec)} → 사망 감소`), ' 줄어 사회적 비용 연 ', N(`${f1(rec.safetyBenefit)}억`, `사망 감소 × ${STD.deathCost}억 (도로교통공단 2022)`), '의 편익이 기대된다.'] : '교통사고 대책에는 배정되지 않아 사망률 변화는 없다.',
  ].flat()

  const lo = Math.min(rec.range.low.after.v, rec.range.high.after.v), hi = Math.max(rec.range.low.after.v, rec.range.high.after.v)
  const assume: Seg[] = [
    `단가는 ${level === 'mid' ? '중간값' : level === 'low' ? '낮은 값' : '높은 값'} 기준이며 사례별로 2–3배 차이가 있어, 저·고 단가로 다시 계산하면 이 안의 종합 취약도는 `, N(`${f0(lo)}–${f0(hi)}점`, `${O(rec)} × 단가 저/고 → 결과 범위`),
    ' 범위다. 응급의료 취약지 기준은 출처마다 27%/30%로 달라 27%를 썼고, 결과를 ‘공식 지정 예측’으로 해석하면 안 된다. 프리셋 가중치는 팀 AHP 확정 전 예시값이고, 구조개선 단가는 출처를 확인 중이다. 지금 지역 지표는 수집 전 예시값이다.',
  ]

  const compare = REGIONS.map((x) => ({ r: x, p: planSet(x, budget, costs, level, minMed).find((p) => p.preset === main)! }))
  const mp = preset(main)
  const best = compare.reduce((x, y) => ((y.p.before.v - y.p.after.v) > (x.p.before.v - x.p.after.v) ? y : x))
  const cmp: Seg[] = [
    `같은 ${budget}억을 ${mp.icon} ${mp.name} 목표로 세 군에 각각 넣으면, 종합 취약도가 가장 많이 내려가는 곳은 ${best.r.name}(`,
    N(`${f0(best.p.before.v)}→${f0(best.p.after.v)}점`, `optimize(${best.r.name}, ${mp.name}, ${budget}억)`), ')이다. 고령 인구가 많을수록 같은 개선의 가치가 커서 수혜 인구에 (1 + 고령비율)을 곱한 고령 가중 수혜도 함께 표시했다.',
  ]

  const sections: Section[] = [
    { id: 's1', title: '1. 지역 현황 요약', segs: status },
    { id: 's2', title: `2. 추천 예산안 (${pr.name}안)`, segs: recText },
    { id: 's3', title: '3. 산출 근거', segs: basis },
    { id: 's4', title: '4. 기대 효과', segs: effect },
    { id: 's5', title: '5. 가정과 출처', segs: assume },
    { id: 's6', title: '6. 3군 비교', segs: cmp },
  ]
  // 숫자 대조 기준: 토큰 숫자 + 표에 들어가는 숫자 + 공식 기준값
  const tokenNums = sections.flatMap((s) => s.segs.flatMap((g) => (typeof g === 'string' ? [] : numsOf(g.n))))
  const tableNums = [
    ...plans.flatMap((p) => [...LEVERS.map((l) => String(p.opt.alloc[l.id])), f0(p.before.v), f0(p.after.v), f0(p.benefit)]),
    ...compare.flatMap(({ r: x, p }) => [f0(p.before.v), f0(p.after.v), f0(p.before.mvi), f0(p.after.mvi), f0(p.before.tvi), f0(p.after.tvi), f0(p.benefit), f0(p.benefit * (1 + x.elderly))]),
    ...LEVERS.flatMap((l) => [costs[l.id].low, costs[l.id].mid, costs[l.id].high].map(String)),
  ]
  const fixed = ['27', '30', '80', '60', '100', '2027', '65', '10', '1', '2', '3', '6', String(budget), String(STD.natAR), String(STD.deathCost), '2022']
  const allowed = new Set([...tokenNums, ...tableNums.map((x) => x.replace(/,/g, '')), ...fixed, ...numsOf(sections.map((s) => s.segs.filter((g) => typeof g === 'string').join('')).join(' '))])
  return { title: `${r.name} 2027 의료·교통 예산 편성안`, sections, plans, rec, compare, allowed, costs }
}

export const segText = (segs: Seg[]) => segs.map((g) => (typeof g === 'string' ? g : g.n)).join('')
