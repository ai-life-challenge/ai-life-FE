// 백엔드 호출. 운영 서버를 바로 부른다(운영 서버가 localhost:* 와 *.workers.dev 를 CORS로 허용한다).
// 다른 서버를 쓰려면 빌드할 때 VITE_API_URL을 넣는다. 빌드 시점에 코드에 박히므로 바꾸면 다시 빌드해야 한다.
import type { ApiErrorBody, Examples, Health, Judge, Plans, RegionData, RegionList, Report, Sensitivity, State, VillageDetail } from './types'

export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'https://api.village-coverage.kro.kr').replace(/\/$/, '')

// message는 화면에 그대로 보여 줘도 되는 문구다. detail은 개발 중 확인용
export class ApiError extends Error {
  status: number
  code: string
  detail?: string
  constructor(status: number, code: string, message: string, detail?: string) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

// 서버 문서의 타임아웃 권고: 대안 계산(plans · sensitivity)은 마을이 많은 군에서 한 요청에 7초쯤 걸려 30초, 나머지는 1초 안이라 넉넉히 20초.
// 질문(ask)은 서버가 40초에 끊으니 60초로 api/ask.ts에서 따로 잡는다
const FAST = 20_000, SLOW = 30_000

// 페이지를 떠나면(주소 입력 · 링크) 가는 중인 요청을 끊는다. 브라우저가 페이지를 뒤로 가기 캐시에 얼리면 답 없는 요청이 살아남아,
// 서버가 돌아와도 같은 주소의 새 요청이 약 20초 막힌다(HTTP 캐시 잠금, HTTP/1.1이면 연결 한도까지). 끊긴 채로 되돌아온 페이지는 답을 기다릴 수 없어 새로 불러온다
const live = new Set<AbortController>()
let cutOnLeave = false
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (live.size) cutOnLeave = true
    for (const a of live) a.abort()
  })
  window.addEventListener('pageshow', (e) => { if (e.persisted && cutOnLeave) location.reload() })
}

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal, timeoutMs = FAST): Promise<T> {
  // 부른 쪽이 멈추면 AbortError 그대로, 시간이 넘으면 화면에 보일 수 있는 오류로 바꾼다
  const ac = new AbortController()
  live.add(ac)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ac.abort() }, timeoutMs)
  const onAbort = () => ac.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    let res: Response
    try {
      res = await fetch(API_URL + path, { ...init, signal: ac.signal, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined })
    } catch (e) {
      if (timedOut) throw new ApiError(0, 'timeout', '서버가 늦게 답하고 있어요. 잠시 뒤 다시 시도해 주세요.')
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError(0, 'network', '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    }
    if (!res.ok) {
      const b = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null
      throw new ApiError(res.status, b?.error ?? 'unknown', b?.message ?? '요청을 처리하지 못했어요.', b?.detail)
    }
    try {
      return (await res.json()) as T
    } catch (e) {
      if (timedOut) throw new ApiError(0, 'timeout', '서버가 늦게 답하고 있어요. 잠시 뒤 다시 시도해 주세요.')
      if ((e as Error).name === 'AbortError') throw e
      throw new ApiError(res.status, 'bad_response', '서버 응답을 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    }
  } finally {
    live.delete(ac)
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// 복구 확인용 요청: 멈춘 요청이 쥔 HTTP 캐시 잠금을 비켜 가고(8절) 캐시된 옛 응답을 '서버가 살아났다'로 착각하지 않게 캐시를 쓰지 않는다. 멈춘 서버를 오래 기다리지 않게 짧게 끊는다
export const QUICK = 8_000
const FRESH: RequestInit = { cache: 'no-store' }
export type GetOpt = { signal?: AbortSignal; fresh?: boolean }
const get = <T>(path: string, o?: GetOpt) => call<T>(path, o?.fresh ? FRESH : undefined, o?.signal, o?.fresh ? QUICK : FAST)

const post = <T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs?: number) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }, signal, timeoutMs)
type Calc = { region: string; state: State }

export const api = {
  health: () => call<Health>('/api/health'),
  ping: () => call<Health>('/api/health', FRESH, undefined, 4_000), // 서버가 돌아왔는지 가볍게 묻는다
  regions: (o?: GetOpt) => get<RegionList>('/api/regions', o),
  region: (code: string, o?: GetOpt) => get<RegionData>(`/api/regions/${code}`, o),
  map: (code: string, o?: GetOpt) => get<GeoJSON.FeatureCollection>(`/api/regions/${code}/map`, o),
  examples: (region: string) => call<Examples>(`/api/examples?region=${encodeURIComponent(region)}`),
  judge: (b: Calc, signal?: AbortSignal) => post<Judge>('/api/judge', b, signal),
  village: (b: Calc & { villageId: string }, signal?: AbortSignal) => post<VillageDetail>('/api/village', b, signal),
  plans: (b: Calc, signal?: AbortSignal) => post<Plans>('/api/plans', b, signal, SLOW),
  sensitivity: (b: Calc, signal?: AbortSignal) => post<Sensitivity>('/api/sensitivity', b, signal, SLOW),
  report: (b: Calc, signal?: AbortSignal) => post<Report>('/api/report', b, signal, SLOW),
}

// 같은 지역 자료는 한 번만 받는다 (마을 원자료는 50KB가 넘는다)
const cache = new Map<string, Promise<unknown>>()
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = load().catch((e) => { cache.delete(key); throw e })
    cache.set(key, p)
  }
  return p
}
export const forgetAll = () => { cache.clear() } // 테스트용
export const remember = <T>(key: string, value: T) => { cache.set(key, Promise.resolve(value)) } // 복구 때 새로 받은 값을 기억해 둔다
export const regionData = (code: string) => cached(`region:${code}`, () => api.region(code))
export const regionMap = (code: string) => cached(`map:${code}`, () => api.map(code))
