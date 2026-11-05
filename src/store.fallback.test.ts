// @vitest-environment jsdom
// 서버 성공 · 실패에 따라 store가 서버 값과 추정 값을 구분해 담는지. fetch만 흉내 낸다
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { RETRY_AFTER_MS, isDown, resetDown } from './api/fallback'
import { estimateJudge, estimatePlans } from './api/estimatePlans'
import { resetSnapshotCache } from './api/snapshot'
import { only, region, state } from './api/testRegion'
import type { Plans } from './api/types'
import { calcKey, judgeKey, useStore } from './store'

const initial = useStore.getState()
const data = region()
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status })
const err500 = () => json({ error: 'server', message: '서버 오류예요.' }, 500)
const err400 = () => json({ error: 'bad_state', message: '값이 범위를 벗어났어요.' }, 400)

// 서버 응답 흉내: 추정 함수로 모양이 같은 값을 만들되 estimate 표시를 뺀다(서버 응답에는 없다). rate로 서버 값임을 알아본다
const serverPlans = (st = state()): Plans => { const { estimate: _e, ...p } = estimatePlans(data, st); return { ...p, plans: p.plans.map((x) => ({ ...x, summary: `서버 ${x.summary}` })) } }
type Route = (path: string, init?: RequestInit) => Response | Promise<Response>
const calls: string[] = []
function server(routes: Record<string, Route>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push(path)
    const hit = Object.keys(routes).find((k) => path.startsWith(k))
    if (!hit) return new Response('<html>not found</html>', { status: 404 })
    return routes[hit](path, init)
  }))
}
const ready = (o: Partial<ReturnType<typeof useStore.getState>> = {}) => useStore.setState({ code: '99999', data, state: state(), regions: [{ code: '99999', name: '예시군', sido: '예시도', tier: 'auto', villages: 6, center: [128, 35], shrinkingArea: false, erVulnerable: false }], ...o })
const s = () => useStore.getState()

beforeEach(() => { useStore.setState(initial, true); resetDown(); resetSnapshotCache(); calls.length = 0 })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('정상 서버', () => {
  test('서버 값을 그대로 쓰고 추정으로 덮지 않는다', async () => {
    ready()
    const plans = serverPlans()
    server({ '/api/plans': () => json(plans), '/api/judge': () => json(estimateJudge(data, state())) })
    await s().fetchPlans(); await s().fetchJudge()
    expect(s().plans).toMatchObject({ status: 'ok', source: 'server', key: calcKey('99999', state()) })
    expect(s().plans.data!.plans[0].summary).toContain('서버')
    expect(s().plans.data!.estimate).toBeUndefined()
    expect(s().judge.source).toBe('server')
    expect(isDown('plans')).toBe(false)
  })
  test('같은 조건이면 다시 부르지 않는다(화면 이동으로 계산을 되풀이하지 않음)', async () => {
    ready()
    server({ '/api/plans': () => json(serverPlans()) })
    await s().fetchPlans(); await s().fetchPlans(); await s().fetchPlans()
    expect(calls.filter((c) => c === '/api/plans')).toHaveLength(1)
  })
  test('같은 조건 요청이 가는 중이면 함께 기다린다', async () => {
    ready()
    server({ '/api/plans': () => json(serverPlans()) })
    await Promise.all([s().fetchPlans(), s().fetchPlans()])
    expect(calls.filter((c) => c === '/api/plans')).toHaveLength(1)
  })
})

describe('서버 장애 → 추정', () => {
  test('대안 API 500이면 추정 대안을 쓰고 출처를 남긴다', async () => {
    ready()
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    expect(s().plans).toMatchObject({ status: 'ok', source: 'estimated', error: null, reason: '서버 오류예요.' })
    expect(s().plans.data!.estimate!.basis).toHaveLength(6)
    expect(s().plans.key).toBe(calcKey('99999', state()))
  })
  test('네트워크 실패여도 추정한다', async () => {
    ready()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await s().fetchPlans()
    expect(s().plans.source).toBe('estimated')
    expect(s().plans.reason).toContain('연결하지 못했어요')
  })
  test('시간 초과(30초)면 추정한다', async () => {
    vi.useFakeTimers()
    ready()
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))))
    const p = s().fetchPlans()
    expect(s().plans.status).toBe('loading')
    await vi.advanceTimersByTimeAsync(30_000)
    await p
    expect(s().plans).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(s().plans.reason).toContain('늦게')
  })
  test('입력 오류(400)는 추정으로 숨기지 않는다', async () => {
    ready()
    server({ '/api/plans': err400 })
    await s().fetchPlans()
    expect(s().plans).toMatchObject({ status: 'error', data: null, error: '값이 범위를 벗어났어요.' })
    expect(isDown('plans')).toBe(false)
  })
  test('읽을 수 없거나 형식이 틀린 응답은 숫자를 지어내지 않고 추정으로 다룬다', async () => {
    ready()
    server({ '/api/plans': () => json({ plans: [] }) })
    await s().fetchPlans()
    expect(s().plans.source).toBe('estimated')
    resetDown(); useStore.setState({ plans: { status: 'idle', data: null, error: null } })
    server({ '/api/plans': () => new Response('<html>', { status: 200 }) })
    await s().fetchPlans()
    expect(s().plans.source).toBe('estimated')
  })
  test('판정 API만 실패하면 판정만 브라우저 값으로, 대안은 서버 값 그대로', async () => {
    ready()
    server({ '/api/judge': err500, '/api/plans': () => json(serverPlans()) })
    await Promise.all([s().fetchJudge(), s().fetchPlans()])
    expect(s().judge).toMatchObject({ status: 'ok', source: 'estimated', key: judgeKey('99999', state()) })
    expect(s().judge.data!.summary.gap).toBe(140)
    expect(s().plans.source).toBe('server')
    expect(isDown('judge')).toBe(true)
    expect(isDown('plans')).toBe(false)
  })
  test('마을 자료가 없으면 추정 값을 만들지 않고 오류로 둔다', async () => {
    ready({ data: null })
    server({ '/api/plans': err500, '/api/judge': err500 })
    await s().fetchPlans(); await s().fetchJudge()
    expect(s().plans).toMatchObject({ status: 'error', data: null })
    expect(s().plans.error).toContain('마을 자료가 없어')
    expect(s().judge.status).toBe('error')
  })
  test('다른 지역 자료로 추정하지 않는다', async () => {
    ready({ code: '11111' })
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    expect(s().plans.status).toBe('error')
  })
})

describe('요청 순서와 재요청', () => {
  test('빠르게 조건을 바꾸면 마지막 요청만 반영한다: 늦게 온 앞 응답이 덮지 않는다', async () => {
    ready()
    let releaseFirst!: () => void
    const first = new Promise<void>((r) => { releaseFirst = r })
    const stA = state({ budget: 1 }), stB = state({ budget: 2 })
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const st = JSON.parse(init.body as string).state
      if (st.budget === 1) { await first; return json(serverPlans(stA)) } // 취소가 늦어 응답이 도착한 경우
      return json(serverPlans(stB))
    }))
    useStore.setState({ state: stA })
    const a = s().fetchPlans()
    useStore.setState({ state: stB })
    await s().fetchPlans()
    releaseFirst()
    await a
    expect(s().plans.key).toBe(calcKey('99999', stB))
    expect(s().plans.data!.budget).toBe(2)
  })
  test('장애를 기억하는 동안에는 서버를 다시 부르지 않고 바로 추정한다(무한 재요청 없음)', async () => {
    ready()
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    expect(calls).toHaveLength(1)
    useStore.setState({ state: state({ budget: 3 }) })
    await s().fetchPlans()
    await s().fetchPlans()
    expect(calls).toHaveLength(1)
    expect(s().plans).toMatchObject({ status: 'ok', source: 'estimated', key: calcKey('99999', state({ budget: 3 })) })
  })
  test('추정 값이 서버 값으로 잘못 남지 않는다: 복구 뒤 같은 조건을 다시 물으면 서버 값으로 바뀐다', async () => {
    vi.useFakeTimers()
    ready()
    server({ '/api/plans': err500, '/api/sensitivity': err500 })
    await s().fetchPlans()
    await s().fetchSens()
    expect(s().sens.source).toBe('estimated')
    expect(s().plans.source).toBe('estimated')
    const sensBody = s().sens.data
    server({ '/api/plans': () => json(serverPlans()), '/api/sensitivity': () => json(sensBody) })
    await s().fetchPlans() // 아직 기억하는 동안: 서버를 부르지 않는다
    expect(s().plans.source).toBe('estimated')
    vi.advanceTimersByTime(RETRY_AFTER_MS)
    await s().fetchPlans() // 시간이 지나면 뒤에서 한 번 묻는다
    expect(s().plans.source).toBe('server')
    expect(s().plans.data!.estimate).toBeUndefined()
    expect(isDown('plans')).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(s().sens.source).toBe('server') // 민감도도 서버 값으로
  })
  test('서버로 다시 계산: 바로 묻고, 되면 바꾸고, 안 되면 추정 값을 그대로 둔다', async () => {
    ready()
    server({ '/api/plans': err500, '/api/judge': err500 })
    await s().fetchPlans(); await s().fetchJudge()
    const before = s().plans.data
    await s().retryServer()
    expect(s().plans.source).toBe('estimated')
    expect(s().plans.data).toBe(before) // 실패해도 화면 값이 사라지지 않는다
    expect(s().plans.status).toBe('ok')
    server({ '/api/plans': () => json(serverPlans()), '/api/judge': () => json(estimateJudge(data, state())) })
    await s().retryServer()
    expect(s().plans.source).toBe('server')
    expect(s().judge.source).toBe('server')
  })
  test('복구를 확인하는 중에 400이 오면 숨기지 않는다', async () => {
    vi.useFakeTimers()
    ready()
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    vi.advanceTimersByTime(RETRY_AFTER_MS)
    server({ '/api/plans': err400 })
    await s().fetchPlans()
    expect(s().plans.status).toBe('error')
  })
})

describe('민감도와 레포트', () => {
  test('추정 대안의 민감도는 서버를 부르지 않고 다시 계산한다', async () => {
    ready()
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    calls.length = 0
    await s().fetchSens()
    expect(calls).toEqual([])
    expect(s().sens).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(typeof s().sens.data!.same).toBe('boolean')
  })
  test('서버 대안의 민감도가 실패하면 추정으로 메우지 않는다(값이 섞이지 않게)', async () => {
    ready()
    server({ '/api/plans': () => json(serverPlans()), '/api/sensitivity': err500 })
    await s().fetchPlans()
    await s().fetchSens()
    expect(s().sens).toMatchObject({ status: 'error', data: null })
  })
  test('추정 대안으로는 서버 레포트를 만들지 않는다', async () => {
    ready()
    server({ '/api/plans': err500 })
    await s().fetchPlans()
    calls.length = 0
    await s().fetchReport()
    expect(calls).toEqual([])
    expect(s().report.status).toBe('idle')
  })
  test('서버 대안이고 레포트만 실패하면 오류를 그대로 보여 준다', async () => {
    ready()
    server({ '/api/plans': () => json(serverPlans()), '/api/report': err500 })
    await s().fetchPlans()
    await s().fetchReport()
    expect(s().report).toMatchObject({ status: 'error', error: '서버 오류예요.' })
  })
})

describe('지역 자료 · 전체 장애', () => {
  const manifest = { capturedAt: '2026-11-04', origin: 'x', totalRegions: 72, regions: [{ code: '99999', name: '예시군', sido: '예시도', tier: 'auto', villages: 6, center: [128, 35], shrinkingArea: false, erVulnerable: false }], defaultState: state() }
  const snapshotFiles = { '/data/snapshot/manifest.json': () => json(manifest), '/data/snapshot/99999.json': () => json({ data, map: { type: 'FeatureCollection', features: [] } }) }

  test('서버가 처음부터 안 되면 저장한 지역만 목록에 보인다', async () => {
    server({ '/api/': err500, ...snapshotFiles })
    await s().loadList()
    expect(s()).toMatchObject({ listSource: 'snapshot', listError: null })
    expect(s().regions.map((r) => r.code)).toEqual(['99999'])
    expect(s().state).toEqual(state())
    expect(s().snapshot!.capturedAt).toBe('2026-11-04')
  })
  test('저장한 지역은 스냅샷 자료로 진행하고 대안은 추정으로 표시된다', async () => {
    server({ '/api/': err500, ...snapshotFiles })
    await s().loadList()
    await s().loadRegion('99999')
    expect(s()).toMatchObject({ dataSource: 'snapshot', regionError: null })
    expect(s().data!.code).toBe('99999')
    await Promise.all([s().fetchJudge(), s().fetchPlans()])
    expect(s().plans.source).toBe('estimated')
    expect(s().judge.source).toBe('estimated')
  })
  test('저장하지 않은 지역은 값을 지어내지 않고 계산할 수 없다고 안내한다', async () => {
    server({ '/api/': err500, ...snapshotFiles })
    await s().loadList()
    await s().loadRegion('11111')
    expect(s().data).toBeNull()
    expect(s().regionError).toContain('진단과 계산을 할 수 없어요')
    await s().fetchPlans()
    expect(s().plans.status).toBe('error')
  })
  test('스냅샷도 없으면 기존처럼 오류를 보여 준다(파일 대신 앱 HTML이 와도)', async () => {
    server({ '/api/': err500 })
    await s().loadList()
    expect(s().regions).toEqual([])
    expect(s().listError).toContain('서버 오류예요.')
    expect(s().listError).toContain('진단과 계산을 할 수 없어요')
    expect(s().listSource).toBe('server')
  })
  test('스냅샷이 없는 전체 장애: 다시 시도하면 불러오는 중으로 돌아가고, 복구되면 목록이 나온다', async () => {
    server({ '/api/': err500 })
    await s().loadList()
    expect(s().listError).toBeTruthy()
    const before = calls.length
    server({ '/api/regions': () => json({ regions: manifest.regions, defaultState: state() }) })
    const p = s().loadList()
    expect(s().listError).toBeNull() // 오류를 지우고 다시 묻는 중
    await p
    expect(s().regions).toHaveLength(1)
    expect(s().listError).toBeNull()
    expect(s().listSource).toBe('server')
    expect(calls.length).toBe(before + 1)
  })
  test('입력 오류나 404는 스냅샷으로 숨기지 않는다', async () => {
    server({ '/api/regions': () => json({ error: 'x', message: '없는 지역이에요.' }, 404), ...snapshotFiles })
    await s().loadRegion('99999')
    expect(s().data).toBeNull()
    expect(s().regionError).toBe('없는 지역이에요.')
  })
  test('목록은 받았고 마을 자료만 실패하면 저장한 자료를 쓰고, 경계만 실패하면 서버 자료로 계속한다', async () => {
    server({ '/api/regions/99999/map': () => json({ type: 'FeatureCollection', features: [] }), '/api/regions/99999': err500, ...snapshotFiles })
    await s().loadRegion('99999')
    expect(s().dataSource).toBe('snapshot')
    useStore.setState({ code: null, data: null })
    server({ '/api/regions/77777/map': err500, '/api/regions/77777': () => json(data), '/data/': () => new Response('x', { status: 404 }) })
    resetSnapshotCache()
    await s().loadRegion('77777')
    expect(s().regionError).toBeNull()
    expect(s().map).toBeNull()
    expect(s().data).not.toBeNull()
  })
  test('서버가 돌아오면 전체 목록과 서버 자료로 돌아간다', async () => {
    server({ '/api/': err500, ...snapshotFiles })
    await s().loadList()
    await s().loadRegion('99999')
    await s().fetchPlans()
    const full = [...manifest.regions, { ...manifest.regions[0], code: '22222' }]
    server({ '/api/regions/99999/map': () => json({ type: 'FeatureCollection', features: [] }), '/api/regions/99999': () => json(data), '/api/regions': () => json({ regions: full, defaultState: state() }), '/api/plans': () => json(serverPlans()), '/api/judge': () => json(estimateJudge(data, state())) })
    await s().retryServer()
    expect(s()).toMatchObject({ listSource: 'server', dataSource: 'server', snapshot: null })
    expect(s().regions).toHaveLength(2)
    expect(s().plans.source).toBe('server')
  })
})

test('고른 공급수단 · 가정값을 추정에 그대로 쓴다', async () => {
  const st = state({ allowedSupply: only('tele'), budget: 30, target: 1 })
  ready({ state: st })
  server({ '/api/plans': err500 })
  await s().fetchPlans()
  expect(s().plans.data!.plans[2].picks.every((x) => x.type === 'tele')).toBe(true)
  expect(s().plans.data!.budget).toBe(30)
})
