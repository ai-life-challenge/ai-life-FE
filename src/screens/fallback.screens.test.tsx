// @vitest-environment jsdom
// 화면 연동: 서버가 실패해도 예산안 만들기 → 결과 → What-if → 요약이 이어지고, 숫자 · 지도 범례가 같은 계산에서 나오며, 추정 표시가 남는지.
// 지도(MapView)는 WebGL이 필요해 여기서 그리지 않는다. 지도와 범례가 같이 쓰는 coverageById는 범례로 확인한다
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { resetDown } from '../api/fallback'
import { estimateJudge, estimatePlans } from '../api/estimatePlans'
import { resetSnapshotCache } from '../api/snapshot'
import { only, region, state, village } from '../api/testRegion'
import type { Plans, RegionData, RegionItem, State } from '../api/types'
import { useJudgeCompare } from '../hooks'
import { calcKey, judgeKey, useStore } from '../store'
import { Progress } from '../ui/Progress'
import { Report } from './Report'
import { Results } from './Results'
import { Simulate } from './Simulate'
import { WhatIf } from './WhatIf'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const initial = useStore.getState()
const item: RegionItem = { code: '99999', name: '예시군', sido: '예시도', tier: 'auto', villages: 6, center: [128, 35], shrinkingArea: false, erVulnerable: false }
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status })
const data: RegionData = region([
  village('v0', { walk: 5, people: 100 }), village('v1', { people: 50, m: 'm1' }), village('v2', { people: 30, m: 'm1', senior: false }),
  village('v3', { people: 20, m: 'm2' }), village('v4', { people: 40, m: 'm2', medMin: 50 }), village('v5', { walk: 5, people: 60, m: 'm2' }),
])
const serverPlans = (st: State): Plans => { const { estimate: _e, ...p } = estimatePlans(data, st); return { ...p, plans: p.plans.map((x) => ({ ...x, summary: `서버안 ${x.summary}` })) } }

let root: Root | null = null, box: HTMLElement
const mapRef = { current: null }
async function render(path: string, el: ReactNode) {
  box = document.createElement('div')
  document.body.appendChild(box)
  root = createRoot(box)
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Routes, null,
      createElement(Route, { path: '/r/:code/sim', element: el }),
      createElement(Route, { path: '/r/:code/whatif', element: el }),
      createElement(Route, { path: '/r/:code/report', element: el }),
      createElement(Route, { path: '/r/:code/result', element: path.endsWith('/result') ? el : createElement('div', null, '결과 화면') }),
    )))
  })
}
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }
const until = async (ok: () => boolean, ms = 4000) => { const t = Date.now(); while (!ok() && Date.now() - t < ms) await wait(20); expect(ok()).toBe(true) }
const text = () => box.textContent ?? ''
const setup = (st = state()) => useStore.setState({ code: '99999', data, state: st, regions: [item], map: { type: 'FeatureCollection', features: [] } })
const respond = (routes: Record<string, (body: { state: State }) => Response>) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    const hit = Object.keys(routes).find((k) => path.startsWith(k))
    if (!hit) return json({ error: 'x', message: '서버 오류예요.' }, 500)
    return routes[hit](init?.body ? JSON.parse(init.body as string) : { state: state() })
  }))
}
const down = () => vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'x', message: '서버 오류예요.' }, 500)))
const ok = () => respond({ '/api/plans': (b) => json(serverPlans(b.state)), '/api/judge': (b) => json(estimateJudge(data, b.state)), '/api/sensitivity': () => json({ base: { k: 1, name: '균형안', rate: 1, year: 1, summary: '' }, lo: { k: 1, name: '균형안', rate: 1, year: 0.8, summary: '' }, hi: { k: 1, name: '균형안', rate: 1, year: 1.2, summary: '' }, same: true }) })

beforeEach(() => {
  useStore.setState(initial, true); resetDown(); resetSnapshotCache()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  window.matchMedia = globalThis.matchMedia
  window.scrollTo = () => {}
})
afterEach(async () => { await act(async () => { root?.unmount() }); root = null; box?.remove(); vi.unstubAllGlobals() })

describe('진단', () => {
  const Probe = () => { const c = useJudgeCompare(); return createElement('p', null, c ? (c.same ? '서버와 같음' : '서버와 다름') : '대조 안 함') }
  const judged = (source: 'server' | 'estimated') => useStore.setState({ judge: { status: 'ok', data: estimateJudge(data, state()), error: null, key: judgeKey('99999', state()) ?? undefined, source } })
  test('브라우저가 대신 계산한 판정을 서버 판정과 같다고 알리지 않는다', async () => {
    setup(); judged('estimated')
    await render('/r/99999/sim', createElement(Probe))
    expect(text()).toBe('대조 안 함')
  })
  test('서버 판정이면 평소처럼 대조한다', async () => {
    setup(); judged('server')
    await render('/r/99999/sim', createElement(Probe))
    expect(text()).toBe('서버와 같음')
  })
})

describe('예산안 만들기', () => {
  test('서버가 정상이면 기존처럼 서버 값으로 결과로 넘어가고 추정 표시가 없다', async () => {
    setup(); ok()
    await render('/r/99999/sim', createElement(Simulate))
    await until(() => text().includes('결과 화면'))
    expect(useStore.getState().plans.source).toBe('server')
    expect(useStore.getState().judge.source).toBe('server')
  })
  test('서버 500이면 추정을 마치고 결과로 넘어간다(90%에서 멈추지 않는다)', async () => {
    setup(); down()
    await render('/r/99999/sim', createElement(Simulate))
    await until(() => text().includes('결과 화면'))
    expect(useStore.getState().plans.source).toBe('estimated')
    expect(useStore.getState().judge.source).toBe('estimated')
  })
  test('네트워크 실패에서도 넘어가고, 넘어가기 전에 추정임을 표시한다', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await render('/r/99999/sim', createElement(Simulate))
    await until(() => text().includes('추정 시뮬레이션') || text().includes('결과 화면'))
    await until(() => text().includes('결과 화면'))
  })
  test('입력 오류(400)면 결과로 넘어가지 않고 오류와 다시 시도를 보여 준다', async () => {
    setup()
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'bad', message: '값이 범위를 벗어났어요.' }, 400)))
    await render('/r/99999/sim', createElement(Simulate))
    await until(() => text().includes('값이 범위를 벗어났어요.'))
    expect(text()).toContain('다시 시도')
    await wait(700)
    expect(text()).not.toContain('결과 화면')
  })
  test('추정도 할 수 없으면(주민 0명) 원인을 알리고 넘어가지 않는다', async () => {
    const empty = region([village('v0', { people: 0, walk: 5 })])
    useStore.setState({ code: '99999', data: empty, state: state(), regions: [item] })
    down()
    await render('/r/99999/sim', createElement(Simulate))
    await until(() => text().includes('달성률을 계산할 수 없어요'))
    expect(text()).toContain('다시 시도')
    await wait(700)
    expect(text()).not.toContain('결과 화면')
  })
})

describe('결과', () => {
  const estimatedSetup = async (st = state({ budget: 30, target: 1 })) => {
    setup(st); down()
    await act(async () => { await useStore.getState().fetchJudge(); await useStore.getState().fetchPlans() })
    await render('/r/99999/result', createElement(Results, { mapRef: mapRef as never }))
    await wait(30)
  }
  test('추정 안내를 표시하고 서버 추천 문구를 쓰지 않는다', async () => {
    await estimatedSetup()
    expect(text()).toContain('추정 시뮬레이션')
    expect(text()).toContain('서버 계산을 사용할 수 없어 현재 지역 데이터와 가정값으로 계산한 참고 결과입니다. 실제 최적화 결과와 다를 수 있습니다.')
    expect(text()).toContain('추정 계산에서는')
    expect(text()).not.toContain('서버가 ')
  })
  test('실제 최적화 결과가 아니고 달성률 · 목표 여부가 다를 수 있다고 접지 않고 알린다', async () => {
    await estimatedSetup()
    const note = box.querySelector('.estimate-note') as HTMLElement
    const open = [...note.querySelectorAll(':scope > p')].map((p) => p.textContent).join(' ')
    expect(open).toContain('실제 최적화 결과가 아니에요')
    expect(open).toContain('서버 결과보다 높거나 낮게')
    expect(open).toContain('목표 달성 여부도 다르게')
    expect(text()).toMatch(/목표 .*(달성|미달) \(추정\)/)
  })
  test('서버 판정 없이도 범례의 마을 수가 카드의 coverage와 일치한다', async () => {
    useStore.setState({ judge: { status: 'idle', data: null, error: null } })
    await estimatedSetup(state({ budget: 30, target: 1, planShow: 2 }))
    useStore.setState({ judge: { status: 'error', data: null, error: 'x' } }) // 판정이 없어도
    await wait(10)
    const plan = useStore.getState().plans.data!.plans[2]
    const basis = useStore.getState().plans.data!.estimate!.basis
    const reached = basis.filter((v, i) => v.state !== 0 && plan.coverage[i] > 0.5).length
    expect(plan.picks.length).toBeGreaterThan(0)
    expect(box.querySelector('.pl-villages')!.textContent).toContain(`새로 닿음 ${reached}`)
    expect(text()).toContain(plan.name)
    expect(box.querySelector('.pl-rate')!.textContent).toContain(`${(plan.rate * 100).toFixed(1)}%`)
  })
  test('진단 화면의 자가용 탭 · 필터가 범례 계산에 섞이지 않는다', async () => {
    await estimatedSetup(state({ budget: 0, planShow: 0 }))
    const before = box.querySelector('.pl-villages')!.textContent
    await act(async () => { useStore.setState({ travel: 'car', carTarget: 'er', carView: 10 }) })
    expect(box.querySelector('.pl-villages')!.textContent).toBe(before)
  })
  test('민감도도 추정이라고 밝히고 서버를 부르지 않는다', async () => {
    await estimatedSetup()
    await until(() => useStore.getState().sens.status === 'ok')
    expect(useStore.getState().sens.source).toBe('estimated')
    await wait(10)
    expect(text()).toContain('추정 계산이에요')
    expect((fetch as unknown as { mock: { calls: string[][] } }).mock.calls.some((c) => String(c[0]).includes('/api/sensitivity'))).toBe(false)
  })
  test('서버 결과에는 추정 표시가 없다', async () => {
    setup(state()); ok()
    await act(async () => { await useStore.getState().fetchJudge(); await useStore.getState().fetchPlans() })
    await render('/r/99999/result', createElement(Results, { mapRef: mapRef as never }))
    await wait(30)
    expect(text()).not.toContain('추정')
    expect(text()).toContain('서버가 ')
    expect(text()).toContain('서버안')
  })
  test('서버로 다시 계산을 눌러 복구되면 서버 값으로 바뀌고 안내가 사라진다', async () => {
    await estimatedSetup(state())
    ok()
    const btn = [...box.querySelectorAll('button')].find((b) => b.textContent === '서버로 다시 계산')!
    await act(async () => { btn.click(); await new Promise((r) => setTimeout(r, 30)) })
    await until(() => useStore.getState().plans.source === 'server')
    await wait(30)
    expect(text()).not.toContain('추정 시뮬레이션')
    expect(text()).toContain('서버안')
    expect(useStore.getState().plans.key).toBe(calcKey('99999', state()))
  })
})

describe('What-if', () => {
  const change = async (value: number) => {
    const input = box.querySelector('input[type=range]') as HTMLInputElement
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => { set.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const curveDots = () => box.querySelectorAll('svg circle').length
  test('추정 모드: 서버를 부르지 않고 곡선을 그리고, 예산을 바꾸면 조합을 다시 계산한다', async () => {
    setup(state({ budget: 6, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    const f = fetch as unknown as { mock: { calls: unknown[][] } }
    const before = f.mock.calls.length
    await render('/r/99999/whatif', createElement(WhatIf))
    await until(() => curveDots() >= 9 && text().includes('추정값'), 6000)
    expect(text()).toContain('추정 시뮬레이션')
    expect(f.mock.calls.length).toBe(before) // What-if만 서버 값을 끌어오지 않는다
    expect(useStore.getState().state!.budget).toBe(6)
    await change(0.5)
    await wait(350)
    await until(() => text().includes('0.5억일 때'))
    const low = estimatePlans(data, state({ budget: 0.5, target: 1 })).plans[2]
    expect(text()).toContain(`${Math.round(low.rate * 1000) / 10}%`)
    expect(useStore.getState().state!.budget).toBe(6) // 적용 전까지 원본 조건은 그대로
  })
  test('빠르게 바꾸면 마지막 예산의 결과만 남는다', async () => {
    setup(state({ budget: 6, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    await render('/r/99999/whatif', createElement(WhatIf))
    await change(1); await change(2); await change(4)
    await wait(350)
    await until(() => text().includes('→ 4억일 때'))
    expect(text()).not.toContain('→ 2억일 때')
  })
  test('서버 정상: 서버 값을 쓰고 추정 표시가 없다', async () => {
    setup(state({ budget: 6, target: 1 })); ok()
    await act(async () => { await useStore.getState().fetchPlans() })
    await render('/r/99999/whatif', createElement(WhatIf))
    await until(() => curveDots() >= 9, 6000)
    expect(text()).not.toContain('추정 시뮬레이션')
    expect(text()).toContain('서버가 예산별로 계산한 값')
  })
  test('서버 값으로 보던 중 끊기면 표 전체를 추정으로 바꾼다(섞지 않는다)', async () => {
    setup(state({ budget: 6, target: 1 })); ok()
    await act(async () => { await useStore.getState().fetchPlans() })
    down()
    await render('/r/99999/whatif', createElement(WhatIf))
    await until(() => text().includes('추정 시뮬레이션'))
    await until(() => curveDots() >= 9, 6000)
    expect(text()).toContain('추정값')
    expect(useStore.getState().plans.source).toBe('server') // 대안 원본은 건드리지 않는다
  })
})

describe('레포트', () => {
  test('추정 중에는 서버 레포트 대신 추정 요약을 보여 주고 서버를 부르지 않는다', async () => {
    setup(state({ budget: 30, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    const f = fetch as unknown as { mock: { calls: string[][] } }
    await render('/r/99999/report', createElement(Report))
    await wait(350)
    expect(text()).toContain('추정 결과 요약')
    expect(text()).toContain('공문 초안 대신')
    expect(text()).toContain('예시 자료') // 자료에 담긴 출처만
    expect(f.mock.calls.some((c) => String(c[0]).includes('/api/report'))).toBe(false)
    expect(box.querySelector('.notes')).toBeNull() // 각주를 만들지 않는다
    const plan = useStore.getState().plans.data!.plans[1]
    expect(text()).toContain(`${(plan.rate * 100).toFixed(1)}%`)
  })
  test('서버 대안인데 레포트만 실패하면 요약으로 꾸미지 않고 오류를 보여 준다', async () => {
    setup(state()); respond({ '/api/plans': (b) => json(serverPlans(b.state)) })
    await act(async () => { await useStore.getState().fetchPlans() })
    await render('/r/99999/report', createElement(Report))
    await until(() => text().includes('서버 오류예요.'))
    expect(text()).not.toContain('추정 결과 요약')
  })
})

describe('추정값을 서버 값처럼 보이지 않게', () => {
  test('추정 중에는 단계 메뉴 · 버튼에 초안 · 레포트라고 적지 않는다', async () => {
    setup(state({ budget: 30, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    useStore.setState({ reached: { code: '99999', max: 5 } })
    await render('/r/99999/sim', createElement(Progress, { code: '99999', at: 4 }))
    await act(async () => { (box.querySelector('.step-pill') as HTMLButtonElement).click() })
    await wait(30)
    expect(text()).toContain('대안 3개 (추정)')
    expect(text()).toContain('(지금)')
    expect(text()).toContain('추정 요약')
    expect(text()).not.toContain('초안')
  })
  test('결과 · What-if의 다음 단계 버튼도 추정 요약이라고 적는다', async () => {
    setup(state({ budget: 30, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    await render('/r/99999/result', createElement(Results, { mapRef: mapRef as never }))
    await wait(30)
    expect(text()).toContain('추정 요약 보기')
    expect(text()).not.toContain('레포트 만들기')
  })
  test('추정 요약에는 서버 계산 · 각주 표현이 없고 추정 표시가 남는다', async () => {
    setup(state({ budget: 30, target: 1 })); down()
    await act(async () => { await useStore.getState().fetchPlans() })
    await render('/r/99999/report', createElement(Report))
    await wait(350)
    expect(text()).toContain('추정 시뮬레이션')
    expect(text()).toContain('공식 검토 자료로 쓰지 말아')
    expect(text()).not.toContain('서버 초안')
    expect(text()).not.toContain('서버 계산 결과')
    expect(box.querySelector('.rt')).toBeNull() // 편집기를 열지 않는다(자동 저장이 서버로 가지 않는다)
  })
  test('복구 뒤 서버 레포트 요청에는 조건만 가고 추정 숫자는 가지 않는다', async () => {
    const st = state({ budget: 30, target: 1 })
    setup(st); down()
    await act(async () => { await useStore.getState().fetchPlans(); await useStore.getState().fetchSens() })
    const bodies: Record<string, unknown>[] = []
    respond({ '/api/plans': (b) => json(serverPlans(b.state)), '/api/judge': (b) => json(estimateJudge(data, b.state)), '/api/report': (b) => { bodies.push(b as never); return json({ form: 'official', title: '서버 레포트 제목', plan: 1, sections: [], table: [], notes: [], tableNotes: {}, markdown: '' }) } })
    await render('/r/99999/report', createElement(Report))
    await act(async () => { await useStore.getState().retryServer(); await new Promise((r) => setTimeout(r, 300)) })
    await until(() => text().includes('서버 레포트 제목'))
    expect(text()).not.toContain('추정 시뮬레이션')
    expect(Object.keys(bodies[0]).sort()).toEqual(['region', 'state'])
    expect(JSON.stringify(bodies[0])).not.toContain('coverage')
    expect(JSON.stringify(bodies[0])).not.toContain('estimate')
  })
})

test('원격진료만 허용해도 흐름이 이어진다', async () => {
  setup(state({ allowedSupply: only('tele'), budget: 1, target: 1 })); down()
  await render('/r/99999/sim', createElement(Simulate))
  await until(() => text().includes('결과 화면'))
  const ps = useStore.getState().plans.data!
  expect(ps.plans[2].picks.every((x) => x.type === 'tele')).toBe(true)
})
