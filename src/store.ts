import { useMemo } from 'react'
import { create } from 'zustand'
import { regionOf, type Region } from './data/regions'
import { loadGrid, type AgeId, type Grid, type ModeId } from './map/grid'
import { DEFAULT_COSTS, costAt, planSet, type CostLevel, type Costs, type PresetId } from './sim/model'

interface State {
  budget: number // 총예산(억)
  main: PresetId // 사용자가 고른 주 시나리오 (3개 모두 계산한다)
  level: CostLevel // 단가 저/중/고
  costs: Costs // S7에서 고칠 수 있는 단가표
  minMedOn: boolean // 고급 설정: 분야 최소 보장 (D6-C 옵션, 기본 끔)
  minMed: number
  goalText: string
  aiPick: { preset: PresetId; reason: string } | null // S3 자연어 → 프리셋 추천
  detail: PresetId | null // S5에서 펼친 카드
  sources: { open: boolean; focus: string | null; at: number }
  report: { key: string; overrides: Record<string, string> } // 레포트에서 직접 고친 문단 (조건 key가 바뀌면 버린다)
  // 지도 (S1 지역 선택 · S2 진단 · S5 결과)
  mapReady: boolean
  grid: Grid | null // 지금 군의 500m 격자
  hoverRegion: string | null // S1에서 마우스를 올린 군 (지도·카드 공통)
  mode: ModeId // S2 격자: 자가용(E30) / 버스(병원 대중교통)
  age: AgeId
  T: number // 기준 시간(분)
  unfolded: boolean // false = 군 평균 한 색, true = 격자마다 제 색 (펼침 연출)
  extruded: boolean
  sweep: number | null // 시간 스윕 재생 중이면 현재 분
  selectedCell: number | null
  hoverVillage: number | null
  planMode: ModeId // S5 지도: 응급 거점 효과(자가용) / 버스·DRT 효과(버스)
  reveal: number // S5 지도에 놓인 정책 개수 (애니메이션 진행)
  replay: number // 올리면 S5 지도 그리기를 처음부터 다시 한다
  reached: { code: string | null; max: number } // 단계 메뉴: 이 군에서 가 본 가장 먼 단계
  // AI에게 물어보기
  chat: ChatMsg[]
  chatOpen: boolean
  set: (p: Partial<State>) => void
  openSources: (focus?: string) => void
  loadRegion: (code: string) => Promise<Grid | null>
}

export type ToolCallMsg = { id: string; label: string; result?: string }
export type ChatMsg =
  | { role: 'user'; text: string }
  | { role: 'ai'; text: string; tools: ToolCallMsg[]; basis?: string; clarify?: string[]; streaming?: boolean }

export const useStore = create<State>((set, get) => ({
  budget: 100,
  main: 'bal',
  level: 'mid',
  costs: DEFAULT_COSTS,
  minMedOn: false,
  minMed: 0.3,
  goalText: '',
  aiPick: null,
  detail: null,
  sources: { open: false, focus: null, at: 0 },
  report: { key: '', overrides: {} },
  mapReady: false,
  grid: null,
  hoverRegion: null,
  mode: 'car',
  age: 'a80',
  T: 30,
  unfolded: false,
  extruded: false,
  sweep: null,
  selectedCell: null,
  hoverVillage: null,
  planMode: 'car',
  reveal: 0,
  replay: 0,
  reached: { code: null, max: 0 },
  chat: [],
  chatOpen: false,
  set: (p) => set(p),
  loadRegion: async (code): Promise<Grid | null> => {
    const r = regionOf(code)
    if (!r) return null
    const grid = await loadGrid(r)
    if (get().grid !== grid) set({ grid, selectedCell: null, hoverVillage: null, unfolded: false, sweep: null })
    return grid
  },
  openSources: (focus) => set({ sources: { open: true, focus: focus ?? null, at: Date.now() } }),
}))

// 세 안(+단가 저/고 범위)은 여러 화면이 같이 쓴다. 계산은 수 ms라 조건이 바뀔 때마다 다시 한다
export function usePlans(r: Region | undefined) {
  const { budget, costs, level, minMedOn, minMed } = useStore()
  return useMemo(() => (r ? planSet(r, budget, costs, level, minMedOn ? minMed : 0) : null), [r, budget, costs, level, minMedOn, minMed])
}
export const useUnitCost = () => {
  const { costs, level } = useStore()
  return useMemo(() => costAt(costs, level), [costs, level])
}

if (import.meta.env.DEV) (window as any).__store = useStore
