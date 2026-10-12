// S4 안 만들기: 서버에 판정과 대안 계산을 부르는 동안 도구 호출 칩을 보여 주고, 끝나면 결과로 넘어간다.
import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion } from 'motion/react'
import { calcKey, judgeKey, useStore } from '../store'
import { eok, fmt, pct } from '../api/meta'
import { Tools, type ToolCall } from '../ui/Tools'

export function Simulate() {
  const { code } = useParams()
  const nav = useNavigate()
  const { state, judge, plans, regions, fetchJudge, fetchPlans } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const jFresh = judge.status === 'ok' && judge.key === judgeKey(code!, st)
  const pFresh = plans.status === 'ok' && plans.key === calcKey(code!, st)

  // 이미 같은 조건으로 받아 둔 결과가 있으면 다시 부르지 않는다
  useEffect(() => { if (!jFresh) void fetchJudge() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pFresh) void fetchPlans() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const failed = plans.status === 'error' || judge.status === 'error'
  const went = useRef(false)
  useEffect(() => {
    if (pFresh && !went.current) {
      went.current = true
      const t = setTimeout(() => nav(`/r/${code}/result`, { replace: true }), 700)
      return () => { clearTimeout(t); went.current = false }
    }
  }, [pFresh, code, nav])

  const calls: ToolCall[] = [
    {
      id: 'judge', label: `judge(${r.name})`, state: jFresh ? 'done' : judge.status === 'error' ? 'wait' : 'run',
      result: judge.data ? `공백 ${fmt(judge.data.summary.gap)}명 (${pct(judge.data.summary.rate)})` : undefined,
    },
    {
      id: 'plans', label: `plans(목표 ${Math.round(st.target * 100)}%, 연 ${eok(st.budget)})`, state: pFresh ? 'done' : plans.status === 'error' ? 'wait' : 'run',
      result: plans.data ? `안 ${plans.data.plans.length}개 · 추천 ${plans.data.plans.find((p) => p.recommended)?.name ?? ''}` : undefined,
    },
  ]

  return (
    <motion.aside className="panel sim-panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">4단계 · 안 만들기</p>
      <h1>{r.name}의 예산안을 만들고 있어요</h1>
      <p className="muted small">계산은 모두 서버가 해요. 화면은 받은 결과만 그려요.</p>
      <Tools calls={calls} />
      {failed && (
        <div className="toast-inline" role="alert">
          {plans.error ?? judge.error}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" onClick={() => { void fetchJudge(); void fetchPlans() }}>다시 시도</button>
            <button className="ghost" onClick={() => nav(`/r/${code}/goal`)}>← 조건 바꾸기</button>
          </div>
        </div>
      )}
    </motion.aside>
  )
}
