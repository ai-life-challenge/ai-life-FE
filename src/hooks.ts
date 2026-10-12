import { useEffect, useMemo } from 'react'
import { compare, judgeLocal } from './api/judge'
import { calcKey, judgeKey, reportKey, useStore } from './store'
import type { JudgedVillage, JudgeSummary } from './api/types'

// 브라우저에서 바로 계산한 판정: 기준을 바꾸면 서버 응답을 기다리지 않고 지도가 바뀐다
export function useLocalJudge() {
  const data = useStore((s) => s.data)
  const st = useStore((s) => s.state)
  return useMemo(() => (data && st ? judgeLocal(data, st) : null), [data, st?.service, st?.age, st?.criteria]) // eslint-disable-line react-hooks/exhaustive-deps
}

// 서버 판정(지금 기준으로 받은 것만)을 기준으로 브라우저 판정과 대조한다
export function useFreshServerJudge() {
  const judge = useStore((s) => s.judge)
  const now = useStore((s) => judgeKey(s.code, s.state))
  return judge.data && judge.key === now ? judge.data : null
}
export function useJudgeCompare() {
  const local = useLocalJudge()
  const server = useFreshServerJudge()
  return useMemo(() => (local && server ? compare(server, local) : null), [local, server])
}

// 화면에 보이는 판정: 브라우저 판정을 바로 쓰고, 서버와 다르면 서버 판정으로 바꾼다 (서버가 기준)
export function useShownJudge(): { villages: JudgedVillage[]; summary: JudgeSummary; source: 'local' | 'server' } | null {
  const local = useLocalJudge()
  const server = useFreshServerJudge()
  const cmp = useJudgeCompare()
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
