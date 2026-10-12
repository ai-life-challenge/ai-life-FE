import { create } from 'zustand'
import { api, ApiError, regionData, regionMap } from './api/client'
import type { Judge, Plans, RegionData, RegionItem, Report, Sensitivity, State, Turn } from './api/types'

export type ToolCallMsg = { id: string; label: string; result?: string }
export type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'ai'; text: string; tools: ToolCallMsg[]; error?: boolean }

// 서버 호출 상태. 오류는 화면에 그대로 보여 줘도 되는 message만 둔다
// key: 이 결과를 받을 때의 조건. 지금 조건과 다르면 오래된 결과다
export type Load<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; data: T | null; error: string | null; key?: string }
const idle = <T,>(): Load<T> => ({ status: 'idle', data: null, error: null })
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : '문제가 생겼어요. 다시 시도해 주세요.')

interface Store {
  regions: RegionItem[]
  state: State | null // 화면 상태: 처음엔 서버가 준 defaultState, 화면에서 바꾼 값만 바뀐다
  defaults: State | null
  listError: string | null
  code: string | null
  data: RegionData | null
  map: GeoJSON.FeatureCollection | null
  regionError: string | null
  judge: Load<Judge>
  plans: Load<Plans>
  sens: Load<Sensitivity>
  report: Load<Report>
  mapReady: boolean
  hoverRegion: string | null
  hoverVillage: string | null
  reached: { code: string | null; max: number } // 단계 메뉴: 이 지역에서 가 본 가장 먼 단계
  sources: { open: boolean; focus: string | null; at: number }
  chat: ChatMsg[]
  chatOpen: boolean
  remainingToday: number | null
  set: (p: Partial<Store>) => void
  patch: (fn: (s: State) => State) => void
  loadList: () => Promise<void>
  loadRegion: (code: string) => Promise<void>
  fetchJudge: () => Promise<void>
  fetchPlans: () => Promise<void>
  fetchSens: () => Promise<void>
  fetchReport: () => Promise<void>
  openSources: (focus?: string) => void
}

// 이 값들이 같으면 서버 계산 결과도 같다 (planShow · selectedVillage · report 는 계산에 쓰지 않는다)
export const calcKey = (code: string | null, s: State | null) => s && JSON.stringify([code, s.service, s.age, s.criteria, s.assumptions, s.allowedSupply, s.budget, s.target])
// 판정은 기준(서비스 · 나이대 · 걷는 시간 · 운행 횟수 · 자가용 시간)만 본다. 예산을 바꿔도 다시 부르지 않는다
export const judgeKey = (code: string | null, s: State | null) => s && JSON.stringify([code, s.service, s.age, s.criteria])
// 레포트는 고른 안과 고쳐 쓴 문단까지 반영한다
export const reportKey = (code: string | null, s: State | null) => s && JSON.stringify([calcKey(code, s), s.planShow, s.report])

// 같은 종류 요청이 겹치면 앞 요청은 버린다 (슬라이더를 빠르게 움직일 때)
const inflight: Record<string, AbortController | undefined> = {}
function run<T>(slot: 'judge' | 'plans' | 'sens' | 'report', stamp: string | null, call: (signal: AbortSignal) => Promise<T>, set: (p: Partial<Store>) => void, get: () => Store) {
  inflight[slot]?.abort()
  const ac = (inflight[slot] = new AbortController())
  const key = stamp ?? undefined
  set({ [slot]: { ...(get()[slot] as Load<T>), status: 'loading', error: null } } as Partial<Store>)
  return call(ac.signal).then(
    (data) => { if (!ac.signal.aborted) set({ [slot]: { status: 'ok', data, error: null, key } } as Partial<Store>) },
    (e) => { if (!ac.signal.aborted) set({ [slot]: { status: 'error', data: null, error: errText(e), key } } as Partial<Store>) },
  )
}

export const useStore = create<Store>((set, get) => ({
  regions: [], state: null, defaults: null, listError: null,
  code: null, data: null, map: null, regionError: null,
  judge: idle(), plans: idle(), sens: idle(), report: idle(),
  mapReady: false, hoverRegion: null, hoverVillage: null,
  reached: { code: null, max: 0 },
  sources: { open: false, focus: null, at: 0 },
  chat: [], chatOpen: false, remainingToday: null,
  set: (p) => set(p),
  patch: (fn) => set((s) => (s.state ? { state: fn(s.state) } : {})),
  loadList: async () => {
    if (get().regions.length) return
    try {
      const l = await api.regions()
      set({ regions: l.regions, defaults: l.defaultState, state: get().state ?? l.defaultState, listError: null })
    } catch (e) { set({ listError: errText(e) }) }
  },
  loadRegion: async (code) => {
    if (get().code === code && get().data) return
    set({ code, data: null, map: null, regionError: null, judge: idle(), plans: idle(), sens: idle(), report: idle(), chat: [], hoverVillage: null })
    try {
      const [data, map] = await Promise.all([regionData(code), regionMap(code)])
      if (get().code === code) set({ data, map })
    } catch (e) { if (get().code === code) set({ regionError: errText(e) }) }
  },
  fetchJudge: () => { const { code, state } = get(); return code && state ? run('judge', judgeKey(code, state), (sg) => api.judge({ region: code, state }, sg), set, get) : Promise.resolve() },
  fetchPlans: () => { const { code, state } = get(); return code && state ? run('plans', calcKey(code, state), (sg) => api.plans({ region: code, state }, sg), set, get) : Promise.resolve() },
  fetchSens: () => { const { code, state } = get(); return code && state ? run('sens', calcKey(code, state), (sg) => api.sensitivity({ region: code, state }, sg), set, get) : Promise.resolve() },
  fetchReport: () => { const { code, state } = get(); return code && state ? run('report', reportKey(code, state), (sg) => api.report({ region: code, state }, sg), set, get) : Promise.resolve() },
  openSources: (focus) => set({ sources: { open: true, focus: focus ?? null, at: Date.now() } }),
}))

export const historyOf = (chat: ChatMsg[]): Turn[] =>
  chat.filter((m) => !(m.role === 'ai' && m.error)).slice(-6).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, 600) }))

if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore
