import { create } from 'zustand'
import type { AgeId, ModeId, ServiceId } from './api/types'
import { SERVICES, buildModel, COUNTIES, type Model } from './api/mock'
import { defaultAssumptions, planSet, type Assumptions, type Goal, type OptService, type Plan, type PlanId, type SupplyId } from './api/plans'

export type ToolCall = { id: string; label: string; result?: string }
export type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'ai'; text: string; tools: ToolCall[]; basis?: string; clarify?: string[]; streaming?: boolean }

// 검토 메모에서 AI에게 고쳐 달라고 한 것들. 문단을 직접 고친 내용은 overrides에 들어간다
export interface MemoState {
  overrides: Record<string, string>
  recPlan: PlanId | null // 권고안을 바꿔 달라고 했을 때
  summaryLine: boolean
  shortRec: boolean
  extraLimits: string[]
  version: number // AI가 고칠 때마다 올려서 바뀐 문단을 다시 타이핑한다
}

interface State {
  sgg: string | null
  model: Model | null
  service: ServiceId
  mode: ModeId
  age: AgeId
  thresholds: Record<ServiceId, number> // 가정값. 가정과 단가 화면에서 고친다
  hoverVillage: number | null
  selectedCell: number | null
  extruded: boolean
  unfolded: boolean // false = 군 평균 한 색, true = 격자마다 제 색 (펼침 연출)
  sweep: number | null // 시간 스윕 재생 중이면 현재 분
  mapReady: boolean
  // 목표와 대안
  target: number
  budget: number
  allowed: Record<SupplyId, boolean>
  assume: Assumptions
  planShow: PlanId | null // 지도에 그릴 안. null이면 추천안
  reveal: number // 지도에 그려진 공급 개수 (애니메이션 진행)
  replay: number // 올리면 지도 그리기를 처음부터 다시 한다
  // AI 질문
  chat: ChatMsg[]
  chatOpen: boolean
  memo: MemoState
  set: (p: Partial<State>) => void
  loadCounty: (sgg: string) => Promise<void>
}

let myeonCache: Promise<any> | null = null
export const loadMyeon = () => (myeonCache ??= fetch('/data/myeon.geojson').then((r) => r.json()))
const models = new Map<string, Model>()

export const useStore = create<State>((set) => ({
  sgg: null,
  model: null,
  service: 'med',
  mode: 'bus',
  age: 'a80',
  thresholds: Object.fromEntries(SERVICES.map((s) => [s.id, s.T])) as Record<ServiceId, number>,
  hoverVillage: null,
  selectedCell: null,
  extruded: false,
  unfolded: false,
  sweep: null,
  mapReady: false,
  target: 0.9,
  budget: 6,
  allowed: { fix: true, tour: true, drt: true, taxi: true, tele: true },
  assume: defaultAssumptions(),
  planShow: null,
  reveal: 0,
  replay: 0,
  chat: [],
  chatOpen: false,
  memo: { overrides: {}, recPlan: null, summaryLine: false, shortRec: false, extraLimits: [], version: 0 },
  set: (p) => set(p),
  loadCounty: async (sgg) => {
    let model = models.get(sgg)
    if (!model) {
      const geo = await loadMyeon()
      model = buildModel(COUNTIES.find((c) => c.sgg === sgg)!, geo.features)
      models.set(sgg, model)
    }
    if (useStore.getState().sgg !== sgg) set({ chat: [], memo: { overrides: {}, recPlan: null, summaryLine: false, shortRec: false, extraLimits: [], version: 0 } })
    set({ sgg, model, selectedCell: null, hoverVillage: null, unfolded: false, sweep: null })
  },
}))

// 진단 화면에서 진단만 하는 서비스(교육 등)를 보고 왔으면 대안은 의료로 계산한다
export const optService = (s: ServiceId): OptService => (s === 'pha' || s === 'gro' ? s : 'med')

type GoalInputs = Pick<State, 'service' | 'mode' | 'age' | 'thresholds' | 'target' | 'budget' | 'allowed'>
export const goalOf = (s: GoalInputs): Goal => {
  const service = optService(s.service)
  return { service, mode: s.mode === 'walk' ? 'bus' : s.mode, age: s.age, T: s.thresholds[service], target: s.target, budget: s.budget, allowed: s.allowed }
}

// 세 안은 지도·패널·AI가 같이 쓰므로 마지막 결과를 기억해 둔다
let last: { key: string; m: Model; a: Assumptions; plans: Plan[] } | null = null
export function plansFor(m: Model, g: Goal, a: Assumptions) {
  const key = JSON.stringify(g)
  if (!last || last.key !== key || last.m !== m || last.a !== a) last = { key, m, a, plans: planSet(m, g, a) }
  return last.plans
}
export function usePlans() {
  const s = useStore()
  if (!s.model) return null
  const g = goalOf(s)
  const plans = plansFor(s.model, g, s.assume)
  const shown = plans.find((p) => p.id === s.planShow) ?? plans.find((p) => p.recommended)!
  return { goal: g, plans, shown, model: s.model }
}

if (import.meta.env.DEV) (window as any).__store = useStore
