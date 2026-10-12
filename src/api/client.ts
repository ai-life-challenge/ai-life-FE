// 백엔드 호출. 운영 서버를 바로 부른다(운영 서버가 localhost:* 와 *.workers.dev 를 CORS로 허용한다).
// 다른 서버를 쓰려면 빌드할 때 VITE_API_URL을 넣는다. 빌드 시점에 코드에 박히므로 바꾸면 다시 빌드해야 한다.
import type { Answer, ApiErrorBody, Examples, Health, Judge, Plans, RegionData, RegionList, Report, Sensitivity, Stage, State, Turn, VillageDetail } from './types'

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

async function call<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_URL + path, { ...init, signal, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'network', '서버에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  }
  if (!res.ok) {
    const b = (await res.json().catch(() => null)) as Partial<ApiErrorBody> | null
    throw new ApiError(res.status, b?.error ?? 'unknown', b?.message ?? '요청을 처리하지 못했어요.', b?.detail)
  }
  return res.json() as Promise<T>
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) => call<T>(path, { method: 'POST', body: JSON.stringify(body) }, signal)
type Calc = { region: string; state: State }

export const api = {
  health: () => call<Health>('/api/health'),
  regions: () => call<RegionList>('/api/regions'),
  region: (code: string) => call<RegionData>(`/api/regions/${code}`),
  map: (code: string) => call<GeoJSON.FeatureCollection>(`/api/regions/${code}/map`),
  judge: (b: Calc, signal?: AbortSignal) => post<Judge>('/api/judge', b, signal),
  village: (b: Calc & { villageId: string }, signal?: AbortSignal) => post<VillageDetail>('/api/village', b, signal),
  plans: (b: Calc, signal?: AbortSignal) => post<Plans>('/api/plans', b, signal),
  sensitivity: (b: Calc, signal?: AbortSignal) => post<Sensitivity>('/api/sensitivity', b, signal),
  report: (b: Calc, signal?: AbortSignal) => post<Report>('/api/report', b, signal),
  examples: (region: string) => call<Examples>(`/api/examples?region=${encodeURIComponent(region)}`),
  ask: (b: Calc & { stage: Stage; question: string; history: Turn[] }, signal?: AbortSignal) => post<Answer>('/api/ask', b, signal),
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
