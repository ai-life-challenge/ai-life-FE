// @vitest-environment jsdom
// DRT 범례 · 대안 전환의 지도 이동. pick.myeon은 읍면 이름, 마을 원자료의 myeon은 읍면 id라 data.myeons로 이어야 한다(예전에는 직접 비교해 늘 0곳이었다)
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Judge, Pick, Plan, Plans, RawVillage, RegionData, RegionItem, State } from '../api/types'
import { boxOf, cameraFor, panelPadding, villagesOfMyeon } from '../map/geo'
import { useStore } from '../store'
import { Results } from './Results'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const initial = useStore.getState()
const W = 1440, H = 900, LEGEND_W = 370

const village = (id: string, myeon: string, lon: number, lat: number): RawVillage => ({
  id, name: id, myeon, lon, lat, pop: { all: 40, a65: 20, a80: 10 }, a80In10y: 1, seniorCenter: true,
  bus: { stopWalkMin: 30, noStop: false, dailyRuns: 5, firstToTownMin: 500, firstEstimated: false },
  nearest: { med: null, school: 5, library: 5, er: null },
})
// 동쪽 끝의 가면(읍면 id m1), 서쪽 끝의 나면(m2). 읍면이 어디든 이름과 id가 다르다
const villages = [village('d0', 'm3', 128.0, 35.0), village('a1', 'm1', 128.4, 35.4), village('a2', 'm1', 128.5, 35.5), village('b1', 'm2', 127.6, 34.6), village('b2', 'm2', 127.5, 34.5), village('t1', 'm3', 128.05, 35.05)]
const data = {
  code: '99999', name: '예시군', sido: '예시도', tier: 'auto', town: 'd0', depot: 'd0', shrinkingArea: false, erVulnerable: false, sources: [],
  myeons: [{ id: 'm1', name: '가면', pharmacy: false }, { id: 'm2', name: '나면', pharmacy: false }, { id: 'm3', name: '다면', pharmacy: false }],
  villages, facilities: [], indicators: { pop: 240, elderly: 0.5, e30: 0, e60: 0 } as RegionData['indicators'],
} as RegionData
const item: RegionItem = { code: '99999', name: '예시군', sido: '예시도', tier: 'auto', villages: 6, center: [128, 35], shrinkingArea: false, erVulnerable: false }
const pick = (type: Pick['type'], label: string, ids: string[], myeon: string | null): Pick => ({ type, typeName: type, label, year: 1, install: 1, villages: ids, myeon })
const plan = (k: number, name: string, picks: Pick[]): Plan => ({
  k, name, summary: picks.map((p) => p.label).join(', ') || '없음', picks, year: picks.length, install: picks.length, baseRate: 0.5, rate: 0.9, future: null, gapBefore: 30, gapAfter: 5,
  meetsTarget: true, withinBudget: true, timedOut: false, sameAs: null, recommended: k === 1, coverage: villages.map(() => 1),
})
const drtA = pick('drt', 'DRT 가면', [], '가면'), drtB = pick('drt', 'DRT 나면', [], '나면'), tour = pick('tour', '순회', ['t1'], null), tele = pick('tele', '원격', ['a2'], null), fix = pick('fix', '거점', ['b1'], null)
const plansOf = (ps: Plan[]): Plans => ({ service: 'med', age: 'a80', target: 0.9, budget: 6, recommended: 1, plans: ps })
const state: State = {
  service: 'med', age: 'a80', criteria: { carMinutes: 30, stopWalkMinutes: 15, dailyRuns: 3 },
  assumptions: { version: 1, teleEffect: 0.5, tourWeekly: 2, costs: { fix: { install: 1, yearly: 1, years: 1 }, tour: { install: 1, yearly: 1, years: 1 }, drt: { install: 1, yearly: 1, years: 1 }, tele: { install: 1, yearly: 1, years: 1 } } },
  allowedSupply: { fix: true, tour: true, drt: true, tele: true }, budget: 6, target: 0.9, planShow: 0, selectedVillage: null, report: { form: 'official', sections: {} },
}
const judge = { service: 'med', age: 'a80', tier: 'auto', town: 'd0', summary: { total: 60, gap: 30, rate: 0.5, noBus: 30, noFacility: 0, villagesNoBus: 3, villagesNoFacility: 0, gapVillages: 3 }, busReasons: null, top: [], facilities: [],
  villages: villages.map((v, i) => ({ id: v.id, name: v.name, myeon: v.myeon, lon: v.lon, lat: v.lat, people: 10, state: i === 0 ? 0 : 1 })) } as unknown as Judge

let root: Root | null = null, box: HTMLElement
const flyTo = vi.fn()
const mapRef = { current: { flyTo, getContainer: () => ({ clientWidth: W, clientHeight: H }) } }
const ids = (want: string[]) => villages.filter((v) => want.includes(v.id))
const padded = (want: string[], pad: number) => { const b = boxOf(ids(want)); return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] as [number, number, number, number] }
const expected = (want: string[], pad: number) => cameraFor(padded(want, pad), W, H, { ...panelPadding(W, H), right: LEGEND_W })
const last = () => flyTo.mock.calls.at(-1)![0] as { center: [number, number]; zoom: number; duration: number }

async function show(ps: Plan[], source?: 'server' | 'estimated') {
  const body = plansOf(ps)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(String(url).includes('/api/judge') ? judge : String(url).includes('/api/plans') ? body : { base: { k: 1, name: 'x', rate: 1, year: 1, summary: '' }, lo: { k: 1, name: 'x', rate: 1, year: 1, summary: '' }, hi: { k: 1, name: 'x', rate: 1, year: 1, summary: '' }, same: true }))))
  useStore.setState({ code: '99999', data, state, regions: [item], map: { type: 'FeatureCollection', features: [] }, mapReady: true, plans: { status: 'ok', data: body, error: null, source }, judge: { status: 'ok', data: judge, error: null } })
  box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box)
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: ['/r/99999/result'] }, createElement(Routes, null, createElement(Route, { path: '/r/:code/result', element: createElement(Results, { mapRef: mapRef as never }) }))))
  })
}
const row = (name: string) => [...box.querySelectorAll('.pl-row')].find((b) => b.textContent!.includes(name)) as HTMLButtonElement
const clickRow = async (name: string) => { flyTo.mockClear(); await act(async () => { row(name).click() }) }
const pickPlan = async (k: number) => { flyTo.mockClear(); await act(async () => { (box.querySelectorAll('.plan-hit')[k] as HTMLButtonElement).click() }) }

beforeEach(() => {
  useStore.setState(initial, true); flyTo.mockClear()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.matchMedia = globalThis.matchMedia
})
afterEach(async () => { await act(async () => { root?.unmount() }); root = null; box?.remove(); vi.unstubAllGlobals() })

describe('읍면 이름 → 마을', () => {
  test('이름을 id로 바꿔 그 읍면 마을을 찾는다', () => {
    expect(villagesOfMyeon(data, '가면')).toEqual(['a1', 'a2'])
    expect(villagesOfMyeon(data, '나면')).toEqual(['b1', 'b2'])
  })
  test('id나 모르는 이름, 빈 값이면 찾지 않는다', () => {
    expect(villagesOfMyeon(data, 'm1')).toEqual([])
    expect(villagesOfMyeon(data, '없는면')).toEqual([])
    expect(villagesOfMyeon(data, null)).toEqual([])
  })
})

describe('범례 클릭', () => {
  test('DRT 구역을 누르면 그 운행 구역으로 간다', async () => {
    await show([plan(0, '안0', [drtA]), plan(1, '안1', []), plan(2, '안2', [])])
    await clickRow('구역')
    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject(expected(['a1', 'a2'], 0.02))
  })
  test('DRT 구역이 여러 개면 모두 담는다', async () => {
    await show([plan(0, '안0', [drtA, drtB]), plan(1, '안1', []), plan(2, '안2', [])])
    await clickRow('구역')
    expect(last()).toMatchObject(expected(['a1', 'a2', 'b1', 'b2'], 0.02))
  })
  test('순회 · 원격 · 거점 범례는 예전과 같은 범위로 간다', async () => {
    await show([plan(0, '안0', [tour, tele, fix]), plan(1, '안1', []), plan(2, '안2', [])])
    await clickRow('노선')
    expect(last()).toMatchObject(expected(['d0', 't1'], 0.02)) // 보건소 + 정차 마을
    await clickRow('경로당 원격진료')
    expect(last()).toMatchObject(expected(['a2'], 0.02))
    await clickRow('거점 의료기관')
    expect(last()).toMatchObject(expected(['b1'], 0.02))
  })
})

describe('대안 전환', () => {
  const ps = [plan(0, '안0', [tele]), plan(1, '안1', [drtB]), plan(2, '안2', [tour, drtA])]
  test('DRT만 있는 안은 군 전체가 아니라 운행 구역으로 간다', async () => {
    await show(ps)
    await pickPlan(1)
    expect(last()).toMatchObject({ ...expected(['b1', 'b2'], 0.06), duration: 1100 })
  })
  test('DRT와 다른 수단이 섞인 안은 운행 구역까지 범위에 넣는다', async () => {
    await show(ps)
    await pickPlan(2)
    expect(last()).toMatchObject({ ...expected(['t1', 'd0', 'a1', 'a2'], 0.06), duration: 1100 })
  })
  test('DRT가 없는 안의 범위는 예전과 같다', async () => {
    await show(ps)
    await pickPlan(1)
    await pickPlan(0)
    expect(last()).toMatchObject({ ...expected(['a2'], 0.06), duration: 1100 })
  })
  test('놓는 것이 없는 안은 예전처럼 군 전체로 간다', async () => {
    await show([plan(0, '안0', []), plan(1, '안1', [drtA]), plan(2, '안2', [])])
    await pickPlan(1)
    await pickPlan(0)
    const whole = boxOf(villages)
    expect(last()).toMatchObject({ ...cameraFor(whole, W, H, panelPadding(W, H)), duration: 900 })
  })
})

describe('추정 ↔ 서버 전환', () => {
  const three = (picks: Pick[]) => [plan(0, '안0', picks), plan(1, '안1', [fix]), plan(2, '안2', [tour])]
  // 같은 안 번호(k 0) 그대로 결과만 바꾼다. 응답은 매번 새 객체다
  const swap = async (picks: Pick[], source: 'server' | 'estimated') => {
    flyTo.mockClear()
    await act(async () => { useStore.setState({ plans: { status: 'ok', data: plansOf(JSON.parse(JSON.stringify(three(picks)))), error: null, source } }) })
  }
  test('서버로 복구되어 배치가 달라지면 새 배치 범위로 한 번 옮긴다', async () => {
    await show(three([drtA]), 'estimated')
    await swap([drtB, tele], 'server')
    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject({ ...expected(['b1', 'b2', 'a2'], 0.06), duration: 1100 })
  })
  test('서버로 복구되어도 배치가 같으면 지도를 그대로 둔다', async () => {
    await show(three([drtA, tele]), 'estimated')
    await swap([drtA, tele], 'server')
    expect(flyTo).not.toHaveBeenCalled()
  })
  test('같은 마을을 다른 노선으로 돌면 배치가 다르다', async () => {
    await show(three([pick('tour', '순회', ['t1'], null)]), 'estimated')
    await swap([pick('tour', '순회', ['t1', 'a1'], null)], 'server')
    expect(flyTo).toHaveBeenCalledTimes(1)
  })
  test('서버에서 추정으로 바뀌어 배치가 달라져도 한 번 옮긴다', async () => {
    await show(three([drtA]), 'server')
    await swap([drtB], 'estimated')
    expect(flyTo).toHaveBeenCalledTimes(1)
    expect(last()).toMatchObject(expected(['b1', 'b2'], 0.06))
  })
  test('같은 출처 안에서 내용만 바뀌면 예전처럼 움직이지 않는다', async () => {
    await show(three([drtA]), 'server')
    await swap([drtB], 'server')
    expect(flyTo).not.toHaveBeenCalled()
  })
  test('화면이 다시 그려져도 다시 옮기지 않는다', async () => {
    await show(three([drtA]), 'estimated')
    await swap([drtB], 'server')
    flyTo.mockClear()
    for (const hoverSupply of ['drt', 'tour', null] as const) await act(async () => { useStore.setState({ hoverSupply }) })
    await act(async () => { useStore.setState({ hoverVillage: 'a1' }) })
    await swap([drtB], 'server') // 같은 서버 결과를 다시 받아도
    expect(flyTo).not.toHaveBeenCalled()
  })
  test('옮기지 않은 배치로 복구되면 지도가 맞춰 둔 배치와 비교한다', async () => {
    await show(three([drtA]), 'estimated')
    await swap([drtB], 'estimated') // 같은 출처: 지도는 가면에 그대로
    await swap([drtA], 'server')
    expect(flyTo).not.toHaveBeenCalled() // 지도는 이미 가면을 보고 있다
  })
  test('복구한 뒤에도 안을 바꾸면 늘 옮긴다(배치가 같은 안이어도)', async () => {
    await show([plan(0, '안0', [drtA]), plan(1, '안1', [drtA]), plan(2, '안2', [])], 'estimated')
    flyTo.mockClear()
    await act(async () => { useStore.setState({ plans: { status: 'ok', data: plansOf([plan(0, '안0', [drtA]), plan(1, '안1', [drtA]), plan(2, '안2', [])]), error: null, source: 'server' } }) })
    expect(flyTo).not.toHaveBeenCalled()
    await pickPlan(1)
    expect(flyTo).toHaveBeenCalledTimes(1)
  })
})
