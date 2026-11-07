// @vitest-environment jsdom
// 백엔드 전체 장애와 장애 형태별 전환, 복구. fetch만 흉내 낸다. 정적 파일(/data/snapshot)은 실제 배포처럼 같은 출처 주소로 온다
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GRACE_MS, isDown, resetDown } from './api/fallback'
import { estimateJudge, estimatePlans } from './api/estimatePlans'
import { loadSnapshotManifest, resetSnapshotCache, snapshotIndicators, snapshotRegion } from './api/snapshot'
import { splitRegion } from './api/snapshotSplit'
import { region, state } from './api/testRegion'
import type { Plans, RegionData } from './api/types'
import { forgetAll } from './api/client'
import { calcKey, isDegraded, resetRequests, useStore } from './store'

const initial = useStore.getState()
const data: RegionData = { ...region(), indicators: { pop: 300 } as RegionData['indicators'] }
const item = { code: '99999', name: '예시군', sido: '예시도', tier: 'auto' as const, villages: 6, center: [128, 35] as [number, number], shrinkingArea: false, erVulnerable: false }
const map = { type: 'FeatureCollection', features: [] }
const fileBody = JSON.stringify({ data, map })
const sha = createHash('sha256').update(fileBody).digest('hex')
const manifest = {
  schema: 2, dataVersion: 'v', capturedAt: '2026-11-06', origin: 'x', complete: true, totalRegions: 1, totalVillages: 6, tiers: { precise: 0, auto: 1 }, regions: [item], defaultState: state(),
  files: { 99999: { path: '99999.json', bytes: fileBody.length, sha256: sha, villages: 6, status: 'ok', indicators: data.indicators } },
}
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
const html = () => new Response('<!doctype html><title>app</title>', { status: 200, headers: { 'content-type': 'text/html' } })
const err = (status = 500) => json({ error: 'server', message: '서버 오류예요.' }, status)
const netFail = () => { throw new TypeError('Failed to fetch') }
// 답 없이 멈춘 서버: signal이 끊기 전까지 끝나지 않는다
const hang = (_p: string, init?: RequestInit) => new Promise<Response>((_, no) => { init?.signal?.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))) })
const serverPlans = (st = state()): Plans => { const { estimate: _e, ...p } = estimatePlans(data, st); return { ...p, plans: p.plans.map((x) => ({ ...x, summary: `서버 ${x.summary}` })) } }

type Route = (path: string, init?: RequestInit) => Response | Promise<Response>
const calls: string[] = []
const staticOk: Record<string, Route> = { '/data/snapshot/manifest.json': () => json(manifest), '/data/snapshot/99999.json': () => new Response(fileBody, { headers: { 'content-type': 'application/json' } }) }
function net(routes: Record<string, Route>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push(path)
    const hit = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => path.startsWith(k))
    if (!hit) return html() // 정적 호스팅의 SPA 응답처럼 HTML이 온다
    return routes[hit](path, init)
  }))
}
const healthy: Record<string, Route> = {
  '/api/health': () => json({ ok: true, regions: 1, tiers: { precise: 0, auto: 1 }, agent: true, examples: {} }),
  '/api/regions/99999/map': () => json(map), '/api/regions/99999': () => json(data), '/api/regions': () => json({ regions: [item], defaultState: state() }),
  '/api/plans': (_p, i) => json(serverPlans(JSON.parse(i!.body as string).state)), '/api/judge': (_p, i) => json(estimateJudge(data, JSON.parse(i!.body as string).state)),
  '/api/sensitivity': () => json({ base: { k: 1, name: '균형안', rate: 1, year: 1, summary: '' }, lo: { k: 1, name: '균형안', rate: 1, year: 0.8, summary: '' }, hi: { k: 1, name: '균형안', rate: 1, year: 1.2, summary: '' }, same: true }),
}
const s = () => useStore.getState()
const serverCalls = () => calls.filter((c) => c.startsWith('/api/'))
// 진단 화면에 들어온 뒤 판정 · 대안까지 부른 상태
const openRegion = async () => { await s().loadList(); await s().loadRegion('99999'); await Promise.all([s().fetchJudge(), s().fetchPlans()]) }

beforeEach(() => { resetRequests(); useStore.setState(initial, true); resetDown(); resetSnapshotCache(); forgetAll(); calls.length = 0 })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('서버 정상', () => {
  test('정적 파일을 건드리지 않고 서버 값만 쓴다', async () => {
    net({ ...healthy, ...staticOk })
    await openRegion()
    expect(calls.filter((c) => c.startsWith('/data/'))).toEqual([])
    expect(s()).toMatchObject({ listSource: 'server', dataSource: 'server', snapshot: null })
    expect(s().plans.source).toBe('server')
    expect(s().judge.source).toBe('server')
    expect(isDegraded(s())).toBe(false)
  })
})

describe('백엔드 전체 장애 · 최초 방문', () => {
  const outages: [string, Route][] = [
    ['연결 실패', netFail], ['HTTP 500', () => err(500)], ['HTTP 502', () => new Response('Bad Gateway', { status: 502 })], ['HTTP 503', () => err(503)],
    ['잘못된 JSON', () => new Response('{oops', { status: 200 })], ['HTML 응답', () => html()],
  ]
  test.each(outages)('%s: 목록 · 자료 · 판정 · 대안이 저장 자료와 브라우저 추정으로 이어진다', async (_name, fail) => {
    net({ '/api/': fail, ...staticOk })
    await openRegion()
    expect(s()).toMatchObject({ listSource: 'snapshot', dataSource: 'snapshot', listError: null, regionError: null })
    expect(s().regions).toEqual([item])
    expect(s().state).toEqual(state())
    expect(s().data).toEqual(data)
    expect(s().snapshot!.capturedAt).toBe('2026-11-06')
    expect(s().plans).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(s().judge).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(s().plans.data!.plans).toHaveLength(3)
  })
  test('누락된 필드: 응답을 쓰지 않고 저장 자료로 넘어간다', async () => {
    const broken = { ...data, villages: data.villages.map(({ pop: _pop, ...v }) => v) }
    net({ '/api/regions/99999/map': () => json(map), '/api/regions/99999': () => json(broken), '/api/regions': () => json({ regions: [item] }), '/api/': () => err(), ...staticOk })
    await s().loadList()
    expect(s().listSource).toBe('snapshot') // defaultState가 빠진 목록
    await s().loadRegion('99999')
    expect(s().dataSource).toBe('snapshot')
    expect(s().data!.villages[0].pop).toBeTruthy()
  })
  test('답 없이 멈춘 서버: 타임아웃을 기다리지 않고 저장 자료를 쓰며 계산도 바로 추정한다', async () => {
    vi.useFakeTimers()
    net({ '/api/': hang, ...staticOk })
    const list = s().loadList()
    await vi.advanceTimersByTimeAsync(GRACE_MS + 10)
    expect(s()).toMatchObject({ listSource: 'snapshot', listError: null })
    expect(s().regions).toHaveLength(1)
    expect(isDown('plans')).toBe(true)
    await s().loadRegion('99999') // 멈춘 요청을 기다리지 않는다
    expect(s().dataSource).toBe('snapshot')
    calls.length = 0
    await Promise.all([s().fetchJudge(), s().fetchPlans()])
    expect(s().plans).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(s().judge).toMatchObject({ status: 'ok', source: 'estimated' })
    expect(serverCalls()).toEqual([]) // 다시 물을 때까지 서버를 부르지 않는다
    await vi.advanceTimersByTimeAsync(30_000)
    await list
  })
  test('주소로 바로 들어와도(목록과 자료를 함께 부른다) 멈춘 서버를 기다리지 않는다', async () => {
    vi.useFakeTimers()
    net({ '/api/': hang, ...staticOk })
    void s().loadList(); void s().loadRegion('99999')
    await vi.advanceTimersByTimeAsync(GRACE_MS + 10)
    await vi.waitFor(() => expect(s().data).not.toBeNull()) // 무결성 계산은 타이머 밖에서 끝난다
    expect(s()).toMatchObject({ code: '99999', dataSource: 'snapshot', listSource: 'snapshot', regionError: null })
    await vi.advanceTimersByTimeAsync(40_000)
  })
  test('늦게라도 서버가 답하면 서버 값으로 바뀌고 입력값은 그대로다', async () => {
    vi.useFakeTimers()
    let release: () => void = () => {}
    const slow = new Promise<void>((go) => { release = go })
    net({ ...healthy, '/api/regions': async () => { await slow; return json({ regions: [item], defaultState: state() }) }, ...staticOk })
    const list = s().loadList()
    await vi.advanceTimersByTimeAsync(GRACE_MS + 10)
    expect(s().listSource).toBe('snapshot')
    s().patch((x) => ({ ...x, budget: 12 }))
    release()
    await vi.advanceTimersByTimeAsync(10)
    await list
    expect(s().listSource).toBe('server')
    expect(s().state!.budget).toBe(12)
  })
})

describe('정적 파일 문제 · 가짜 값을 만들지 않는다', () => {
  const noFile: [string, Record<string, Route>][] = [
    ['manifest 없음(HTML)', {}],
    ['manifest 404', { '/data/snapshot/manifest.json': () => new Response('x', { status: 404 }) }],
    ['manifest 깨짐', { '/data/snapshot/manifest.json': () => new Response('{"regions":[', { headers: { 'content-type': 'application/json' } }) }],
    ['manifest 형식 오류', { '/data/snapshot/manifest.json': () => json({ capturedAt: 'x', regions: [] }) }],
    ['파일 정보 없는 지역', { '/data/snapshot/manifest.json': () => json({ ...manifest, files: {} }) }],
  ]
  test.each(noFile)('%s: 목록 오류를 보여 준다', async (_n, routes) => {
    net({ '/api/': () => err(), ...routes })
    await s().loadList()
    expect(s().regions).toEqual([])
    expect(s().listError).toContain('진단과 계산을 할 수 없어요')
  })
  const badFile: [string, Route][] = [
    ['파일 없음(HTML)', () => html()],
    ['깨진 JSON', () => new Response('{"data":', { headers: { 'content-type': 'application/json' } })],
    ['해시 불일치', () => new Response(JSON.stringify({ data: { ...data, name: '바뀐군' }, map }), { headers: { 'content-type': 'application/json' } })],
  ]
  test.each(badFile)('지역 파일 %s: 지역 오류를 보여 주고 계산하지 않는다', async (_n, file) => {
    net({ '/api/': () => err(), '/data/snapshot/manifest.json': () => json(manifest), '/data/snapshot/99999.json': file })
    await s().loadList()
    await s().loadRegion('99999')
    expect(s().data).toBeNull()
    expect(s().regionError).toContain('진단과 계산을 할 수 없어요')
    await s().fetchPlans()
    expect(s().plans.status).toBe('error')
  })
  test('다른 지역 파일이 와도 쓰지 않는다', async () => {
    const other = JSON.stringify({ data: { ...data, code: '88888' }, map })
    const m = { ...manifest, files: { 99999: { ...manifest.files[99999], sha256: createHash('sha256').update(other).digest('hex') } } }
    net({ '/api/': () => err(), '/data/snapshot/manifest.json': () => json(m), '/data/snapshot/99999.json': () => new Response(other) })
    expect(await snapshotRegion('99999')).toBeNull()
  })
  test('마을 수가 manifest와 다른 파일을 쓰지 않는다', async () => {
    const less = JSON.stringify({ data: { ...data, villages: data.villages.slice(1) }, map })
    const m = { ...manifest, files: { 99999: { ...manifest.files[99999], sha256: createHash('sha256').update(less).digest('hex') } } }
    net({ '/data/snapshot/manifest.json': () => json(m), '/data/snapshot/99999.json': () => new Response(less) })
    expect(await snapshotRegion('99999')).toBeNull()
  })
  test('한 번 실패한 정적 파일은 기억하지 않고 다시 받는다', async () => {
    net({})
    expect(await snapshotRegion('99999')).toBeNull()
    net(staticOk)
    expect((await snapshotRegion('99999'))!.data.code).toBe('99999')
  })
  test('같은 지역 파일은 한 번만 받는다', async () => {
    net(staticOk)
    await Promise.all([snapshotRegion('99999'), snapshotRegion('99999')])
    await snapshotRegion('99999')
    expect(calls.filter((c) => c === '/data/snapshot/99999.json')).toHaveLength(1)
    expect(calls.filter((c) => c === '/data/snapshot/manifest.json')).toHaveLength(1)
  })
  test('지역 카드 지표는 지역 파일을 받지 않고 manifest에서 읽는다', async () => {
    net(staticOk)
    expect(await snapshotIndicators('99999')).toEqual({ indicators: data.indicators })
    expect(calls).toEqual(['/data/snapshot/manifest.json'])
  })
})

describe('일부 API만 장애', () => {
  test('지역 목록 API만 실패: 목록은 저장 자료, 지역 자료와 계산은 서버', async () => {
    net({ ...healthy, '/api/regions': () => err(), '/api/regions/99999': () => json(data), '/api/regions/99999/map': () => json(map), ...staticOk })
    await openRegion()
    expect(s().listSource).toBe('snapshot')
    expect(s().dataSource).toBe('server')
    expect(s().plans.source).toBe('server')
  })
  test('지역 자료 API만 실패: 자료는 저장본, 계산은 서버', async () => {
    net({ ...healthy, '/api/regions/99999': () => err(), ...staticOk })
    await s().loadList()
    await s().loadRegion('99999')
    expect(s().dataSource).toBe('snapshot')
    expect(s().snapshot!.capturedAt).toBe('2026-11-06')
    resetDown()
    await s().fetchPlans()
    expect(s().plans.source).toBe('server')
  })
  test('지도 경계 API만 실패: 서버 자료 + 저장한 경계', async () => {
    const saved = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'm1' }, geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } }] }
    const body = JSON.stringify({ data, map: saved })
    const m = { ...manifest, files: { 99999: { ...manifest.files[99999], sha256: createHash('sha256').update(body).digest('hex') } } }
    net({ ...healthy, '/api/regions/99999/map': () => err(), '/data/snapshot/manifest.json': () => json(m), '/data/snapshot/99999.json': () => new Response(body) })
    await openRegion()
    expect(s().dataSource).toBe('server')
    expect(s().map).toEqual(saved)
    expect(s().plans.source).toBe('server')
  })
  test('지도 경계가 깨진 응답이면 저장한 경계 없이도 자료로 계속한다', async () => {
    net({ ...healthy, '/api/regions/99999/map': () => json({ nope: 1 }) })
    await openRegion()
    expect(s().regionError).toBeNull()
    expect(s().dataSource).toBe('server')
    expect(s().map).toBeNull()
  })
  test('계산 API만 실패: 서버 자료 + 브라우저 추정(기존 동작)', async () => {
    net({ ...healthy, '/api/plans': () => err(), '/api/judge': () => err(), ...staticOk })
    await openRegion()
    expect(s()).toMatchObject({ listSource: 'server', dataSource: 'server' })
    expect(s().plans.source).toBe('estimated')
    expect(calls.filter((c) => c.startsWith('/data/'))).toEqual([])
  })
})

describe('서버 복구', () => {
  const recover = async () => {
    net({ '/api/': netFail, ...staticOk })
    await openRegion()
    expect(s().plans.source).toBe('estimated')
  }
  test('서버가 돌아오면 자료 · 계산을 서버 값으로 바꾸고 입력값을 지킨다', async () => {
    await recover()
    s().patch((x) => ({ ...x, budget: 9, target: 0.9, planShow: 2, allowedSupply: { ...x.allowedSupply, fix: false } }))
    await Promise.all([s().fetchJudge(), s().fetchPlans()])
    const st = s().state!
    calls.length = 0
    net({ ...healthy, ...staticOk })
    await s().retryServer()
    expect(s()).toMatchObject({ listSource: 'server', dataSource: 'server', snapshot: null })
    expect(s().state).toEqual(st)
    expect(s().plans).toMatchObject({ source: 'server', key: calcKey('99999', st) })
    expect(s().plans.data!.estimate).toBeUndefined()
    expect(s().plans.data!.budget).toBe(9)
    expect(s().judge.source).toBe('server')
    expect(isDegraded(s())).toBe(false)
  })
  test('복구하는 동안 화면을 비우지 않는다(지역 자료가 null이 되지 않는다)', async () => {
    await recover()
    const seen: unknown[] = []
    const off = useStore.subscribe((x) => seen.push(x.data))
    net({ ...healthy, ...staticOk })
    await s().retryServer()
    off()
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((d) => d != null)).toBe(true)
  })
  test('자료가 같으면 지도와 계산이 흔들리지 않게 같은 객체를 쓴다', async () => {
    await recover()
    const before = s().data
    net({ ...healthy, ...staticOk })
    await s().retryServer()
    expect(s().data).toBe(before)
  })
  test('앱이 읽지 않는 칸만 다르면 같은 자료로 본다(스냅샷은 그 칸을 저장하지 않는다)', async () => {
    await recover()
    const before = s().data
    const plans = s().plans
    const full = { ...data, myeons: data.myeons.map((m) => ({ ...m, pharmacy: true })), villages: data.villages.map((v) => ({ ...v, nearest: { ...v.nearest, school: 3, library: 4 }, bus: { ...v.bus, dailyRunsBis: 2 } })) }
    let wentIdle = false
    const off = useStore.subscribe((x) => { if (x.plans.status === 'idle') wentIdle = true })
    net({ ...healthy, '/api/regions/99999': () => json(full), ...staticOk })
    await s().retryServer()
    off()
    expect(s().data).toBe(before)
    expect(wentIdle).toBe(false) // 복구하는 동안 대안 카드가 사라지지 않는다
    expect(plans.source).toBe('estimated')
    expect(s().plans.source).toBe('server')
  })
  test('서버 자료가 달라졌으면 옛 자료로 만든 추정을 남기지 않는다', async () => {
    await recover()
    const newer = { ...data, villages: data.villages.map((v) => ({ ...v, pop: { ...v.pop, a80: v.pop.a80 + 1 } })) }
    net({ ...healthy, '/api/regions/99999': () => json(newer), '/api/plans': () => err(), '/api/judge': () => err(), ...staticOk })
    await s().retryServer()
    expect(s().dataSource).toBe('server')
    expect(s().data!.villages[0].pop.a80).toBe(newer.villages[0].pop.a80)
    const total = newer.villages.reduce((a, v) => a + v.pop.a80, 0)
    expect(s().judge).toMatchObject({ source: 'estimated' })
    expect(s().judge.data!.summary.total).toBe(total) // 새 자료로 다시 계산했다
  })
  test('요청이 겹치지 않는다: 복구 한 번에 계산마다 서버를 한 번씩만 부른다', async () => {
    await recover()
    calls.length = 0
    net({ ...healthy, ...staticOk })
    await s().retryServer()
    for (const p of ['/api/plans', '/api/judge', '/api/regions', '/api/regions/99999', '/api/regions/99999/map']) expect(calls.filter((c) => c === p), p).toHaveLength(1)
  })
  test('아직 안 되면 값을 그대로 두고 빠르게 돌려준다', async () => {
    await recover()
    const { plans, judge, data: d } = s()
    calls.length = 0
    await s().retryServer()
    expect(s().plans).toBe(plans)
    expect(s().judge).toBe(judge)
    expect(s().data).toBe(d)
    expect(s().dataSource).toBe('snapshot')
    expect(serverCalls()).toEqual(['/api/health']) // 연결이 안 되면 다른 API를 되풀이해 부르지 않는다
  })
  test('자동 복구 확인: 안 되면 health만 묻고, 되면 정식 결과로 바꾼다', async () => {
    await recover()
    calls.length = 0
    await s().recheckServer()
    expect(serverCalls()).toEqual(['/api/health'])
    await s().recheckServer() // 너무 잦은 확인은 건너뛴다
    expect(serverCalls()).toEqual(['/api/health'])
    vi.useFakeTimers({ now: Date.now() + 60_000 })
    net({ ...healthy, ...staticOk })
    await vi.runAllTimersAsync()
    const p = s().recheckServer()
    await vi.runAllTimersAsync()
    await p
    expect(s().plans.source).toBe('server')
  })
  test('정상일 때는 복구 확인이 아무것도 부르지 않는다', async () => {
    net({ ...healthy, ...staticOk })
    await openRegion()
    calls.length = 0
    await s().recheckServer()
    expect(calls).toEqual([])
  })
  test('오래된 응답이 새 조건의 결과를 덮지 않는다', async () => {
    await recover()
    let release: (r: Response) => void = () => {}
    const late = new Promise<Response>((go) => { release = go })
    net({ ...healthy, '/api/plans': () => late, ...staticOk })
    const retry = s().retryServer()
    await new Promise((r) => setTimeout(r, 20))
    s().patch((x) => ({ ...x, budget: 20 })) // 복구 응답을 기다리는 동안 조건을 바꿨다
    const next = serverPlans(state({ budget: 20 }))
    net({ ...healthy, '/api/plans': () => json(next), ...staticOk })
    await s().fetchPlans()
    release(json(serverPlans()))
    await retry
    expect(s().plans.key).toBe(calcKey('99999', s().state))
    expect(s().plans.data!.budget).toBe(20)
  })
  test('지역을 바꾼 뒤 끝난 복구가 다른 지역 자료를 넣지 않는다', async () => {
    await recover()
    let release: (r: Response) => void = () => {}
    const late = new Promise<Response>((go) => { release = go })
    net({ ...healthy, '/api/regions/99999': () => late, ...staticOk })
    const retry = s().retryServer()
    await new Promise((r) => setTimeout(r, 20))
    useStore.setState({ code: '11111', data: null })
    release(json(data))
    await retry
    expect(s().data).toBeNull()
  })
})

// 공개 형식: 공공데이터 파일과 OSM 파생 파일(ODbL)이 나뉘어 있고, 정적 자료에 없는 지역은 unsupported에 이름만 있다
describe('공개 스냅샷(schema 3)', () => {
  const full = { ...data, indicators: { pop: 300, elderly: 0.5, walkMin: 5, e30: 0.1 } as RegionData['indicators'] }
  const { base, osm } = splitRegion(full)
  const baseBody = JSON.stringify({ data: base, map, notes: [{ org: '기관', title: '자료', license: '이용허락범위 제한 없음' }] })
  const osmBody = JSON.stringify(osm)
  const indexBody = JSON.stringify({ regions: { 99999: { center: item.center, indicators: osm.indicators } } })
  const hash = (b: string) => createHash('sha256').update(b).digest('hex')
  const part = (path: string, b: string) => ({ path, bytes: b.length, sha256: hash(b) })
  const { center: _c, ...listItem } = item
  const m3 = {
    schema: 3, dataVersion: 'v', capturedAt: '2026-11-06', origin: 'x', complete: false, totalRegions: 2, totalVillages: 12, tiers: { precise: 0, auto: 1 },
    regions: [listItem], unsupported: [{ code: '88888', name: '보류군', sido: '예시도' }], defaultState: state(),
    files: { 99999: { ...part('99999.json', baseBody), osm: part('osm/99999.json', osmBody), villages: 6, status: 'ok', indicators: base.indicators } },
    osmIndex: part('osm/index.json', indexBody),
  }
  const text = (b: string) => () => new Response(b, { headers: { 'content-type': 'application/json' } })
  const stat: Record<string, Route> = {
    '/data/snapshot/manifest.json': () => json(m3), '/data/snapshot/99999.json': text(baseBody), '/data/snapshot/osm/99999.json': text(osmBody), '/data/snapshot/osm/index.json': text(indexBody),
  }
  const down: Record<string, Route> = { '/api/': netFail, ...stat }

  test('두 파일을 합친 값이 나누기 전과 같다', async () => { // 실제 자료의 칸 순서까지 같은지는 scripts/public-snapshot.test.ts가 본다
    net(down)
    const r = await snapshotRegion('99999')
    expect(r!.data).toEqual(full)
    expect(r!.notes![0].license).toBe('이용허락범위 제한 없음')
  })
  test('목록의 중심 좌표와 카드 지표는 osm/index.json을 합친다', async () => {
    net(down)
    const m = await loadSnapshotManifest()
    expect(m!.regions[0].center).toEqual(item.center)
    expect((await snapshotIndicators('99999'))!.indicators).toEqual(full.indicators)
    expect(calls.filter((c) => c.endsWith('99999.json'))).toEqual([])
  })
  test.each([
    ['OSM 파일 없음', { '/data/snapshot/osm/99999.json': () => html() }],
    ['OSM 파일 변조', { '/data/snapshot/osm/99999.json': text(JSON.stringify({ ...osm, depot: 'x' })) }],
    ['공공데이터 파일 변조', { '/data/snapshot/99999.json': text(JSON.stringify({ data: { ...base, name: '바뀐군' }, map })) }],
  ] as [string, Record<string, Route>][])('%s: 그 지역을 쓰지 않는다', async (_n, routes) => {
    net({ ...down, ...routes })
    await s().loadList()
    await s().loadRegion('99999')
    expect(s().data).toBeNull()
    expect(s().regionError).toContain('진단과 계산을 할 수 없어요')
  })
  test('osm/index.json이 없으면 목록을 쓰지 않는다', async () => {
    net({ ...down, '/data/snapshot/osm/index.json': () => html() })
    await s().loadList()
    expect(s().regions).toEqual([])
    expect(s().listError).toContain('진단과 계산을 할 수 없어요')
  })
  test('전체 장애: 담은 지역은 계산까지 되고, 목록에 보류 지역은 없다', async () => {
    net(down)
    await openRegion()
    expect(s().regions.map((r) => r.code)).toEqual(['99999'])
    expect(s()).toMatchObject({ listSource: 'snapshot', dataSource: 'snapshot' })
    expect(s().plans.source).toBe('estimated')
    expect(serverCalls().filter((c) => !c.startsWith('/api/regions') && !c.startsWith('/api/judge') && !c.startsWith('/api/plans'))).toEqual([])
  })
  test('전체 장애에 보류 지역을 열면 지원하지 않는다고 알리고 값을 만들지 않는다', async () => {
    net(down)
    await s().loadList()
    await s().loadRegion('88888')
    expect(s().unsupported).toEqual({ code: '88888', name: '보류군', sido: '예시도' })
    expect(s().data).toBeNull()
    expect(s().regionError).toBeNull()
    expect(isDegraded(s())).toBe(true)
    await s().fetchJudge(); await s().fetchPlans()
    expect(s().judge.data).toBeNull()
    expect(s().plans.data).toBeNull()
    expect(calls.filter((c) => c.includes('88888') && c.startsWith('/data/'))).toEqual([])
  })
  const healthyHeld: Record<string, Route> = {
    ...healthy,
    '/api/regions/88888/map': () => json(map), '/api/regions/88888': () => json({ ...data, code: '88888', name: '보류군' }),
    '/api/regions': () => json({ regions: [item, { ...item, code: '88888', name: '보류군' }], defaultState: state() }),
  }
  test('서버 정상: 보류 지역도 기존대로 서버 자료를 쓰고 정적 파일을 받지 않는다', async () => {
    net({ ...healthyHeld, ...stat })
    await s().loadList()
    await s().loadRegion('88888')
    expect(s().regions).toHaveLength(2)
    expect(s()).toMatchObject({ dataSource: 'server', unsupported: null })
    expect(s().data!.name).toBe('보류군')
    expect(calls.filter((c) => c.startsWith('/data/'))).toEqual([])
  })
  test('서버가 돌아오면 보류 지역이 서버 자료로 이어진다', async () => {
    net(down)
    await s().loadList()
    await s().loadRegion('88888')
    expect(s().unsupported).not.toBeNull()
    net({ ...healthyHeld, ...stat })
    await s().retryServer()
    expect(s()).toMatchObject({ unsupported: null, dataSource: 'server', listSource: 'server' })
    expect(s().data!.name).toBe('보류군')
    expect(s().regions).toHaveLength(2)
    expect(isDegraded(s())).toBe(false)
  })
  test('자료 API만 장애: 목록은 서버, 보류 지역은 지원하지 않는다고 알리고 복구된다', async () => {
    net({ ...healthyHeld, '/api/regions/88888': () => err(), ...stat })
    await s().loadList()
    await s().loadRegion('88888')
    expect(s().listSource).toBe('server')
    expect(s().unsupported?.name).toBe('보류군')
    net({ ...healthyHeld, ...stat })
    await s().retryServer()
    expect(s()).toMatchObject({ unsupported: null, dataSource: 'server' })
    expect(s().data!.name).toBe('보류군')
  })
  test('목록 API만 장애: 저장 목록에 없는 지역이어도 서버 자료가 오면 이어서 쓴다', async () => {
    net({ ...healthyHeld, '/api/regions': (p) => (p === '/api/regions' ? err() : json({ ...data, code: '88888', name: '보류군' })), ...stat })
    await s().loadList()
    expect(s().listSource).toBe('snapshot')
    await s().loadRegion('88888')
    expect(s().regions.map((r) => r.code)).toEqual(['99999', '88888'])
    expect(s()).toMatchObject({ unsupported: null, dataSource: 'server' })
  })
  test('답 없이 멈춘 서버: 보류 지역 안내를 바로 보여 주고, 늦게라도 답하면 서버 자료로 바꾼다', async () => {
    vi.useFakeTimers()
    let release: (r: Response) => void = () => {}
    net({ ...healthyHeld, '/api/regions/88888/map': () => json(map), '/api/regions/88888': () => new Promise<Response>((go) => { release = go }), ...stat })
    await s().loadList()
    const p = s().loadRegion('88888')
    await vi.advanceTimersByTimeAsync(GRACE_MS + 10)
    vi.useRealTimers()
    await vi.waitFor(() => expect(s().unsupported?.name).toBe('보류군'))
    release(json({ ...data, code: '88888', name: '보류군' }))
    await p
    expect(s()).toMatchObject({ unsupported: null, dataSource: 'server' })
  })
})
