import { create } from 'zustand'
import { api, ApiError, regionData, regionMap } from './api/client'
import { EstimateError, estimateJudge, estimatePlans, estimateSensitivity } from './api/estimatePlans'
import { badResponse, canProbe, isDown, isRecoverable, markDown, markUp, resetDown, validJudge, validPlans, validRegionData, validRegionList, validSens, type DownSlot } from './api/fallback'
import type { CarTarget } from './api/judge'
import { loadSnapshotManifest, snapshotRegion, type SnapshotManifest } from './api/snapshot'
import type { Judge, Plans, RegionData, RegionItem, Report, SectionKey, Sensitivity, State, SupplyId, Turn } from './api/types'

export type ToolCallMsg = { id: string; label: string; result?: string }
export type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'ai'; text: string; tools: ToolCallMsg[]; error?: boolean; options?: string[]; cached?: boolean } // options: 되묻기 버튼, cached: 앞서 만든 답을 다시 보낸 것

// 서버 호출 상태. 오류는 화면에 그대로 보여 줘도 되는 message만 둔다
// key: 이 결과를 받을 때의 조건. 지금 조건과 다르면 오래된 결과다
// source: 값을 누가 계산했는지. server 서버 확정 · estimated 서버 장애로 브라우저가 실제 지역 자료와 가정값으로 추정. reason은 추정으로 넘어온 이유
export type Source = 'server' | 'estimated'
export type Load<T> = { status: 'idle' | 'loading' | 'ok' | 'error'; data: T | null; error: string | null; key?: string; source?: Source; reason?: string }
const idle = <T,>(): Load<T> => ({ status: 'idle', data: null, error: null })
export const errText = (e: unknown) => (e instanceof ApiError || e instanceof EstimateError ? e.message : '문제가 생겼어요. 다시 시도해 주세요.')

interface Store {
  regions: RegionItem[]
  state: State | null // 화면 상태: 처음엔 서버가 준 defaultState, 화면에서 바꾼 값만 바뀐다
  defaults: State | null
  listError: string | null
  code: string | null
  data: RegionData | null
  map: GeoJSON.FeatureCollection | null
  regionError: string | null
  listSource: 'server' | 'snapshot' // 지역 목록 · 기본 상태를 어디서 받았는지
  dataSource: 'server' | 'snapshot' // 지금 지역의 마을 자료를 어디서 받았는지. snapshot이면 서버 장애로 미리 저장한 실제 자료를 쓰는 중이다
  snapshot: SnapshotManifest | null // 스냅샷을 쓰는 동안 그 수집 정보
  judge: Load<Judge>
  plans: Load<Plans>
  sens: Load<Sensitivity>
  report: Load<Report>
  mapReady: boolean
  hoverRegion: string | null
  hoverVillage: string | null
  hoverSupply: SupplyId | null // 결과 범례에서 손을 올린 공급수단: 지도에서 그것만 또렷하게
  showDots: boolean // 진단 지도에 못 가는 마을(빨간 X)을 그릴지 — 대중교통/자가용 중 지금 보는 판정 기준
  showFacilities: boolean // 진단 지도에 병원·의원·보건소 아이콘을 그릴지
  gridTarget: CarTarget // 진단에서 마지막으로 고른 시설 필터: 결과 지도 바탕 격자가 같은 기준으로 칠한다
  carTarget: CarTarget // 자가용 이용에서 어디까지 가는지: 가까운 병의원 · 병원급 · 의원 · 보건기관 · 응급실(지역응급의료센터 이상)
  travel: 'transit' | 'car' // 진단 화면에서 보는 이동 수단: 대중교통(차 없는 주민, 서버 판정) · 자가용(차 있는 주민, 화면 판정)
  diagPick: string | null // 진단에서 마지막으로 본 시설 필터 · 이동 수단이 기본(모든 병의원 · 대중교통)과 다르면 그 이름. 다른 화면에서 계산에 안 쓴다고 알린다
  carView: number | null // 자가용 탭 슬라이더(분). 화면 전용이라 서버 기준(criteria.carMinutes)을 바꾸지 않는다. null이면 서버 기준을 따른다
  thinking: boolean // 예산안 만들기 화면에서 서버가 계산하는 동안: 지도에서 못 가는 마을을 훑는 파동을 그린다
  sweep: number | null // 시간 스윕 중이면 지금 분: 바탕 격자에서 이 시간 안에 닿는 칸만 칠한다
  reached: { code: string | null; max: number } // 단계 메뉴: 이 지역에서 가 본 가장 먼 단계
  sources: { open: boolean; focus: string | null; at: number }
  chat: ChatMsg[]
  chatOpen: boolean
  remainingToday: number | null
  set: (p: Partial<Store>) => void
  patch: (fn: (s: State) => State) => void
  loadList: (force?: boolean) => Promise<void>
  loadRegion: (code: string, force?: boolean) => Promise<void>
  fetchJudge: (o?: FetchOpt) => Promise<void>
  fetchPlans: (o?: FetchOpt) => Promise<void>
  fetchSens: (o?: FetchOpt) => Promise<void>
  fetchReport: () => Promise<void>
  retryServer: () => Promise<void> // 추정 · 스냅샷을 쓰는 중에 서버를 지금 다시 물어본다. 되면 정식 결과로 바꾸고, 안 되면 지금 값을 그대로 둔다
  saveSections: (code: string, changes: Partial<Record<SectionKey, string | null>>) => Promise<void>
  openSources: (focus?: string) => void
}

// 이 값들이 같으면 서버 계산 결과도 같다 (planShow · selectedVillage · report 는 계산에 쓰지 않는다)
export const calcKey = (code: string | null, s: State | null) => s && JSON.stringify([code, s.service, s.age, s.criteria, s.assumptions, s.allowedSupply, s.budget, s.target])
// 판정은 기준(서비스 · 나이대 · 걷는 시간 · 운행 횟수 · 자가용 시간)만 본다. 예산을 바꿔도 다시 부르지 않는다
export const judgeKey = (code: string | null, s: State | null) => s && JSON.stringify([code, s.service, s.age, s.criteria])
// 레포트는 고른 안과 고쳐 쓴 문단까지 반영한다
export const reportKey = (code: string | null, s: State | null) => s && JSON.stringify([calcKey(code, s), s.planShow, s.report])

type Slot = 'judge' | 'plans' | 'sens' | 'report'
export type FetchOpt = { force?: boolean } // force: 받아 둔 결과가 있어도, 장애를 기억하는 중이어도 서버에 다시 묻는다
interface RunOpt<T> extends FetchOpt {
  valid?: (d: T) => boolean // 응답 검사. 통과 못 하면 복구할 수 있는 장애로 다룬다
  estimate?: () => T // 서버 장애일 때 대신 계산. 없으면 오류를 그대로 보여 준다(입력 오류는 estimate가 있어도 그대로 보여 준다)
  down?: DownSlot // 장애를 기억할 칸
  onServer?: (wasEstimated: boolean) => void
}
// 같은 종류 요청이 겹치면 앞 요청은 버린다 (슬라이더를 빠르게 움직일 때). 같은 조건 요청이 이미 가는 중이면 함께 기다린다
const inflight: Partial<Record<Slot, { ac: AbortController; key: string | undefined; promise: Promise<void> }>> = {}
function run<T>(slot: Slot, stamp: string | null, call: (signal: AbortSignal) => Promise<T>, set: (p: Partial<Store>) => void, get: () => Store, opt: RunOpt<T> = {}): Promise<void> {
  const key = stamp ?? undefined
  const cur = get()[slot] as Load<T>
  const fresh = cur.status === 'ok' && cur.key === key
  // 같은 조건의 서버 결과가 있으면 다시 부르지 않는다(화면을 오가도 같은 계산을 되풀이하지 않게)
  if (!opt.force && fresh && cur.source !== 'estimated') return Promise.resolve()
  const running = inflight[slot]
  if (!opt.force && running && !running.ac.signal.aborted && running.key === key) return running.promise

  const applyEstimate = (reason: string) => {
    try { set({ [slot]: { status: 'ok', data: opt.estimate!(), error: null, key, source: 'estimated', reason } } as Partial<Store>); return true }
    catch (x) { set({ [slot]: { status: 'error', data: null, error: x instanceof EstimateError ? `${reason} ${x.message}` : reason, key } } as Partial<Store>); return false }
  }
  // 장애를 기억하는 동안에는 서버를 기다리지 않고 바로 추정한다. 잠시 뒤(canProbe)에는 뒤에서 서버를 한 번 물어 되면 바꾼다
  let hasEstimate = fresh && cur.source === 'estimated'
  if (!opt.force && opt.estimate && opt.down && isDown(opt.down)) {
    if (!hasEstimate) {
      running?.ac.abort()
      hasEstimate = applyEstimate('서버 계산을 쓸 수 없는 상태예요.')
    }
    if (!canProbe(opt.down)) return Promise.resolve()
  }
  // 추정 값이 있으면 뒤에서 물어본다: 화면은 그대로 두고 서버 값이 오면 바꾼다
  const background = hasEstimate
  running?.ac.abort()
  const ac = new AbortController()
  if (!background) set({ [slot]: { ...cur, status: 'loading', error: null } } as Partial<Store>)
  const fail = (e: unknown) => {
    if (ac.signal.aborted) return
    if (isRecoverable(e) && opt.estimate) {
      if (opt.down) markDown(opt.down)
      if (background) set({ [slot]: { ...(get()[slot] as Load<T>), reason: errText(e) } } as Partial<Store>) // 아직 안 된다: 추정 값을 그대로 둔다
      else applyEstimate(errText(e))
      return
    }
    set({ [slot]: { status: 'error', data: null, error: errText(e), key } } as Partial<Store>)
  }
  const promise = (async () => {
    try {
      const data = await call(ac.signal)
      if (ac.signal.aborted) return
      if (opt.valid && !opt.valid(data)) { fail(badResponse()); return }
      if (opt.down) markUp(opt.down)
      const was = (get()[slot] as Load<T>).source === 'estimated'
      set({ [slot]: { status: 'ok', data, error: null, key, source: 'server' } } as Partial<Store>)
      opt.onServer?.(was)
    } catch (e) { fail(e) }
    finally { if (inflight[slot]?.ac === ac) delete inflight[slot] }
  })()
  inflight[slot] = { ac, key, promise }
  return promise
}

let listRequest: Promise<void> | null = null

export const useStore = create<Store>((set, get) => ({
  regions: [], state: null, defaults: null, listError: null,
  code: null, data: null, map: null, regionError: null, listSource: 'server', dataSource: 'server', snapshot: null,
  judge: idle(), plans: idle(), sens: idle(), report: idle(),
  mapReady: false, hoverRegion: null, hoverVillage: null, hoverSupply: null, showDots: true, showFacilities: true, travel: 'transit', carView: null, diagPick: null, carTarget: 'med', gridTarget: 'med', thinking: false, sweep: null,
  reached: { code: null, max: 0 },
  sources: { open: false, focus: null, at: 0 },
  chat: [], chatOpen: false, remainingToday: null,
  set: (p) => set(p),
  patch: (fn) => set((s) => (s.state ? { state: fn(s.state) } : {})),
  loadList: (force = false) => {
    const now = get()
    if (now.regions.length && now.listSource === 'server') return Promise.resolve()
    if (now.regions.length && !force && !canProbe('data')) return Promise.resolve() // 스냅샷을 쓰는 중: 잠시 뒤에 다시 묻는다
    if (listRequest) return listRequest
    if (!now.regions.length) set({ listError: null }) // 다시 시도하는 동안은 불러오는 중으로 보여 준다
    listRequest = (async () => {
      try {
        const l = await api.regions()
        if (!validRegionList(l)) throw badResponse()
        markUp('data')
        const wasSnapshot = get().listSource === 'snapshot'
        set({ regions: l.regions, defaults: l.defaultState, state: get().state ?? l.defaultState, listError: null, listSource: 'server', snapshot: null })
        // 서버가 돌아왔다: 스냅샷으로 보던 지역을 서버 자료로 다시 받는다(계산도 조건이 같으면 서버로 다시 묻는다)
        const { code, dataSource } = get()
        if (wasSnapshot && code && dataSource === 'snapshot') await get().loadRegion(code, true)
      } catch (e) {
        if (isRecoverable(e)) {
          markDown('data')
          if (!get().regions.length) {
            const m = await loadSnapshotManifest()
            if (m) { set({ regions: m.regions, defaults: m.defaultState, state: get().state ?? m.defaultState, listError: null, listSource: 'snapshot', snapshot: m }); return }
          }
        }
        if (!get().regions.length) set({ listError: isRecoverable(e) ? `${errText(e)} 지역 자료를 받지 못해 지금은 진단과 계산을 할 수 없어요. 서버가 돌아오면 다시 시도해 주세요.` : errText(e) })
      } finally { listRequest = null }
    })()
    return listRequest
  },
  loadRegion: async (code, force = false) => {
    if (!force && get().code === code && get().data) return
    set({ code, data: null, map: null, regionError: null, dataSource: 'server', judge: idle(), plans: idle(), sens: idle(), report: idle(), chat: [], hoverVillage: null, diagPick: null })
    const applySnapshot = async () => {
      const s = await snapshotRegion(code)
      if (!s || get().code !== code) return !!s
      const m = await loadSnapshotManifest()
      set({ data: s.data, map: s.map, dataSource: 'snapshot', snapshot: m })
      return true
    }
    // 스냅샷으로 도는 중이면 늦게 답하는 서버를 기다리지 않는다
    if (get().listSource === 'snapshot' && !force && !canProbe('data') && await applySnapshot()) return
    const [d, m] = await Promise.allSettled([regionData(code), regionMap(code)])
    if (get().code !== code) return
    if (d.status === 'fulfilled' && validRegionData(d.value)) {
      markUp('data')
      if (m.status === 'fulfilled') { set({ data: d.value, map: m.value }); return }
      if (!isRecoverable(m.reason)) { set({ regionError: errText(m.reason) }); return }
      // 경계만 못 받았다: 마을 자료로 계산은 할 수 있다. 저장해 둔 경계가 있으면 쓰고, 없으면 경계 없이 그린다
      const s = await snapshotRegion(code)
      if (get().code === code) set({ data: d.value, map: s?.map ?? null })
      return
    }
    const e = d.status === 'fulfilled' ? badResponse() : d.reason
    if (isRecoverable(e)) {
      markDown('data')
      if (await applySnapshot()) return
      if (get().code === code) set({ regionError: `${errText(e)} 이 지역 자료를 받지 못해 서버가 돌아오기 전에는 진단과 계산을 할 수 없어요.` })
      return
    }
    set({ regionError: errText(e) })
  },
  fetchJudge: (o) => {
    const { code, state } = get()
    if (!code || !state) return Promise.resolve()
    return run('judge', judgeKey(code, state), (sg) => api.judge({ region: code, state }, sg), set, get, {
      ...o, down: 'judge',
      valid: (j) => validJudge(j, get().data?.villages.length),
      estimate: () => { const d = get().data; if (!d || d.code !== code) throw new EstimateError('no-data', '이 지역의 마을 자료가 없어 판정할 수 없어요.'); return estimateJudge(d, state) },
    })
  },
  fetchPlans: (o) => {
    const { code, state } = get()
    if (!code || !state) return Promise.resolve()
    return run('plans', calcKey(code, state), (sg) => api.plans({ region: code, state }, sg), set, get, {
      ...o, down: 'plans',
      valid: (p) => validPlans(p, get().data?.villages.length),
      estimate: () => { const d = get().data; if (!d || d.code !== code) throw new EstimateError('no-data', '이 지역의 마을 자료가 없어 추정할 수 없어요.'); return estimatePlans(d, state) },
      // 서버가 돌아와 정식 대안을 받으면, 추정 대안에 맞춰 둔 민감도 · 레포트는 버리고 서버 값으로 다시 받는다
      onServer: (was) => { if (was) { set({ sens: idle(), report: idle() }); void get().fetchSens() } },
    })
  },
  // 민감도는 대안과 출처를 맞춘다. 대안이 추정이면 서버를 부르지 않고 같은 알고리즘으로 단가를 바꿔 다시 계산하고, 대안이 서버 값이면 서버 값만 쓴다(서버 실패를 추정으로 메우지 않는다)
  fetchSens: (o) => {
    const { code, state, plans, sens, data } = get()
    if (!code || !state) return Promise.resolve()
    const key = calcKey(code, state)
    if (plans.source === 'estimated' && plans.key === key && data?.code === code) {
      if (sens.status === 'ok' && sens.key === key && sens.source === 'estimated') return Promise.resolve()
      inflight.sens?.ac.abort()
      try { set({ sens: { status: 'ok', data: estimateSensitivity(data, state), error: null, key: key ?? undefined, source: 'estimated' } }) }
      catch (e) { set({ sens: { status: 'error', data: null, error: e instanceof EstimateError ? e.message : errText(e), key: key ?? undefined } }) }
      return Promise.resolve()
    }
    return run('sens', key, (sg) => api.sensitivity({ region: code, state }, sg), set, get, { ...o, valid: validSens })
  },
  fetchReport: () => {
    const { code, state, report, plans } = get()
    if (!code || !state) return Promise.resolve()
    if (plans.source === 'estimated' && plans.key === calcKey(code, state)) return Promise.resolve() // 추정 대안으로는 서버 레포트를 만들지 않는다. 화면이 추정 요약을 보여 준다
    const key = reportKey(code, state)
    if (report.status === 'ok' && report.key === key) return Promise.resolve() // 문단 저장이 방금 같은 조건의 레포트를 받아 왔다
    return run('report', key, (sg) => api.report({ region: code, state }, sg), set, get)
  },
  retryServer: async () => {
    resetDown()
    await get().loadList(true)
    const { code, state, data, dataSource, listSource } = get()
    if (!code || !state || !data) return
    if (dataSource === 'snapshot' && listSource === 'server') await get().loadRegion(code, true) // 지역 목록은 받았는데 마을 자료만 스냅샷인 경우. 여전히 안 되면 스냅샷으로 돌아온다
    await Promise.all([get().fetchJudge({ force: true }), get().fetchPlans({ force: true })])
  },
  // 고친 문단 저장: 고친 글을 넣은 state로 레포트를 다시 받아, 서버가 받아 준 뒤에만 state에 넣는다(실패하면 state와 레포트는 그대로).
  // 실패하면 오류를 던지고, 부른 쪽(자동 저장)이 고친 글을 들고 다시 보낸다
  saveSections: async (code, changes) => {
    const withChanges = (st: State): State => ({ ...st, report: { ...st.report, sections: { ...st.report.sections, ...changes } } })
    const before = get().state
    if (get().code !== code || !before) throw new ApiError(0, 'stale', '지역이 바뀌어 저장하지 않았어요.')
    const sent = withChanges(before)
    const data = await api.report({ region: code, state: sent })
    const now = get()
    if (now.code !== code || !now.state) return
    const next = withChanges(now.state)
    const key = reportKey(code, next)
    if (key === reportKey(code, sent)) {
      inflight.report?.ac.abort() // 앞서 보낸(고치기 전 글의) 레포트 요청이 이 결과를 덮지 않게
      set({ state: next, report: { status: 'ok', data, error: null, key: key ?? undefined } })
    } else set({ state: next }) // 저장하는 동안 기준 안 등이 바뀌었다: 글만 넣고, 레포트는 새 조건으로 다시 받는다
  },
  openSources: (focus) => set({ sources: { open: true, focus: focus ?? null, at: Date.now() } }),
}))

export const historyOf = (chat: ChatMsg[]): Turn[] =>
  chat.filter((m) => !(m.role === 'ai' && m.error) && m.text).slice(-20).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: m.text.slice(0, 600) }))

if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore
