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

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal, timeoutMs = FAST): Promise<T> {
  // 부른 쪽이 멈추면 AbortError 그대로, 시간이 넘으면 화면에 보일 수 있는 오류로 바꾼다
  const ac = new AbortController()
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
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal, timeoutMs?: number) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }, signal, timeoutMs)
type Calc = { region: string; state: State }

export const api = {
  health: () => call<Health>('/api/health'),
  regions: () => call<RegionList>('/api/regions'),
  region: (code: string) => call<RegionData>(`/api/regions/${code}`),
  map: (code: string) => call<GeoJSON.FeatureCollection>(`/api/regions/${code}/map`),
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
export const regionData = (code: string) => cached(`region:${code}`, () => api.region(code))
export const regionMap = (code: string) => cached(`map:${code}`, () => api.map(code))
