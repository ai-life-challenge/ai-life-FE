import { useEffect, useMemo, useState } from 'react'
import { api, cached } from './api/client'
import { GRACE_MS, RETRY_AFTER_MS } from './api/fallback'
import { compare, judgeCar, judgeLocal } from './api/judge'
import { loadSnapshotManifest } from './api/snapshot'
import { calcKey, isDegraded, judgeKey, reportKey, useStore } from './store'
import type { JudgedVillage, JudgeSummary } from './api/types'

// 브라우저에서 바로 계산한 판정: 기준을 바꾸면 서버 응답을 기다리지 않고 지도가 바뀐다
export function useLocalJudge() {
  const data = useStore((s) => s.data)
  const st = useStore((s) => s.state)
  const carTarget = useStore((s) => s.carTarget)
  return useMemo(() => (data && st ? judgeLocal(data, st, carTarget) : null), [data, st?.service, st?.age, st?.criteria, carTarget]) // eslint-disable-line react-hooks/exhaustive-deps
}

// 서버 판정(지금 기준으로 받은 것만)을 기준으로 브라우저 판정과 대조한다
export function useFreshServerJudge() {
  const judge = useStore((s) => s.judge)
  const now = useStore((s) => judgeKey(s.code, s.state))
  return judge.data && judge.key === now && judge.source !== 'estimated' ? judge.data : null // 브라우저가 대신 계산한 판정은 서버 판정이 아니다: 대조하지 않는다
}
export function useJudgeCompare() {
  const local = useLocalJudge()
  const server = useFreshServerJudge()
  const carTarget = useStore((s) => s.carTarget)
  return useMemo(() => (local && server && carTarget === 'med' ? compare(server, local) : null), [local, server, carTarget])
}

// 화면에 보이는 판정: 브라우저 판정을 바로 쓰고, 서버와 다르면 서버 판정으로 바꾼다 (서버가 기준)
// 자가용 이용을 보고 있으면 서버에 없는 자가용 판정(화면 계산)을 보여 준다
export function useShownJudge(): { villages: JudgedVillage[]; summary: JudgeSummary; source: 'local' | 'server' | 'car' } | null {
  const local = useLocalJudge()
  const server = useFreshServerJudge()
  const cmp = useJudgeCompare()
  const travel = useStore((s) => s.travel)
  const carTarget = useStore((s) => s.carTarget)
  const data = useStore((s) => s.data)
  const st = useStore((s) => s.state)
  const carView = useStore((s) => s.carView)
  const carMin = carView ?? st?.criteria.carMinutes
  const car = useMemo(() => (travel === 'car' && data && st && carMin != null ? judgeCar(data, st.age, carMin, carTarget) : null), [travel, carTarget, data, st?.age, carMin]) // eslint-disable-line react-hooks/exhaustive-deps
  if (car) return { villages: car.villages, summary: car.summary, source: 'car' }
  if (server && cmp && !cmp.same) return { villages: server.villages, summary: server.summary, source: 'server' }
  return local && { villages: local.villages, summary: local.summary, source: 'local' }
}

// 조건(지역 · 계산에 쓰는 state)이 바뀌면 그 종류의 서버 계산을 다시 부른다. 연달아 바뀌면 마지막 것만 부른다
const KEY = { fetchJudge: judgeKey, fetchPlans: calcKey, fetchSens: calcKey, fetchReport: reportKey }
export function useAutoFetch(kind: 'fetchJudge' | 'fetchPlans' | 'fetchSens' | 'fetchReport', enabled = true, delay = 250) {
  const key = useStore((s) => KEY[kind](s.code, s.state))
  const ready = useStore((s) => !!s.code && !!s.state && !!s.data)
  useEffect(() => {
    if (!enabled || !ready) return
    const t = setTimeout(() => { void useStore.getState()[kind]() }, delay)
    return () => clearTimeout(t)
  }, [key, ready, enabled, kind, delay])
}

// 판정 등급별 지역 수(서버 /api/health). 정밀 지역이 늘어도 문구를 고치지 않게 서버 값을 쓴다. 서버가 안 되면 저장한 자료의 값을 쓰고, 그것도 없으면 null
export function useTierCounts() {
  const [n, setN] = useState<{ precise: number; total: number } | null>(null)
  useEffect(() => {
    let live = true, fromServer = false
    const saved = () => loadSnapshotManifest().then((m) => {
      if (!live || fromServer || !m) return
      setN({ precise: m.tiers?.precise ?? m.regions.filter((r) => r.tier === 'precise').length, total: m.totalRegions })
    })
    const t = setTimeout(saved, GRACE_MS)
    cached('health', () => api.health()).then((h) => { fromServer = true; clearTimeout(t); if (live) setN({ precise: h.tiers.precise, total: h.regions }) }, () => { clearTimeout(t); void saved() })
    return () => { live = false; clearTimeout(t) }
  }, [])
  return n
}

// 저장 자료나 추정을 쓰는 동안 서버가 돌아왔는지 가볍게 확인한다: 일정 시간마다, 탭으로 돌아왔을 때, 네트워크가 다시 붙었을 때. 정상일 때는 아무것도 부르지 않는다
export function useServerRecovery() {
  const degraded = useStore(isDegraded)
  useEffect(() => {
    if (!degraded) return
    const check = () => { if (document.visibilityState !== 'hidden') void useStore.getState().recheckServer() }
    const id = setInterval(check, RETRY_AFTER_MS)
    window.addEventListener('online', check)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(id); window.removeEventListener('online', check); document.removeEventListener('visibilitychange', check) }
  }, [degraded])
}
