// S4 예산안 만들기: 서버에 판정과 대안 계산을 부르는 동안 AI가 일하는 모습을 보여 주고, 끝나면 결과로 넘어간다.
// 순서: 판정 → 공급수단 확인 → 대안 계산 → 세 안 비교. 서버가 빨라도(같은 조건이면 캐시라 0.1초) 단계가 눈에 보이도록 STEP만큼은 머문다.
// 단계 표시는 연출이고, 숫자(공백 인구 · 안 개수 · 추천)는 서버가 준 것만 나온다. 움직임 줄이기 설정이면 바로 넘어간다.
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import { calcKey, judgeKey, useStore } from '../store'
import { SUPPLY, SUPPLY_IDS, eok, fmt, pct } from '../api/meta'
import { Tools, type ToolCall } from '../ui/Tools'

// 각 단계가 보이기 시작하는(run) · 끝나는(done) 시각(ms)
const STEP = { judgeDone: 1000, supplyRun: 400, supplyDone: 1300, plansRun: 900, plansDone: 2400, compareDone: 3500 }
const TOTAL = STEP.compareDone

export function Simulate() {
  const { code } = useParams()
  const nav = useNavigate()
  const reduce = useReducedMotion() === true
  const { state, judge, plans, regions, fetchJudge, fetchPlans, set } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const jFresh = judge.status === 'ok' && judge.key === judgeKey(code!, st)
  const pFresh = plans.status === 'ok' && plans.key === calcKey(code!, st)

  // 이미 같은 조건으로 받아 둔 결과가 있으면 다시 부르지 않는다
  const cached = useRef(jFresh && pFresh) // 받아 둔 결과가 있으면 연출을 두 배로 빠르게
  useEffect(() => { if (!jFresh) void fetchJudge() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!pFresh) void fetchPlans() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 연출 시계: 0.1초마다 흐르고 TOTAL을 넘으면 멈춘다
  const [t, setT] = useState(reduce ? TOTAL : 0)
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setT((x) => Math.min(TOTAL, x + (cached.current ? 200 : 100))), 100)
    return () => clearInterval(id)
  }, [reduce])

  const failed = plans.status === 'error' || judge.status === 'error'
  const judgeState: ToolCall['state'] = jFresh && t >= STEP.judgeDone ? 'done' : judge.status === 'error' ? 'wait' : 'run'
  const supplyState: ToolCall['state'] = t >= STEP.supplyDone ? 'done' : t >= STEP.supplyRun ? 'run' : 'wait'
  const plansState: ToolCall['state'] = pFresh && t >= STEP.plansDone ? 'done' : plans.status === 'error' ? 'wait' : t >= STEP.plansRun ? 'run' : 'wait'
  const compareState: ToolCall['state'] = pFresh && t >= TOTAL ? 'done' : pFresh && t >= STEP.plansDone ? 'run' : 'wait'
  const allDone = compareState === 'done' && jFresh

  // 지도에서 못 가는 마을을 훑는 파동: 계산하는 동안만
  useEffect(() => { set({ thinking: !allDone && !failed }) }, [allDone, failed, set])
  useEffect(() => () => set({ thinking: false }), [set])

  const went = useRef(false)
  useEffect(() => {
    if (allDone && !went.current) {
      went.current = true
      const timer = setTimeout(() => nav(`/r/${code}/result`, { replace: true }), 500)
      return () => { clearTimeout(timer); went.current = false }
    }
  }, [allDone, code, nav])

  const allowed = SUPPLY_IDS.filter((k) => st.allowedSupply[k])
  const calls: ToolCall[] = [
    { id: 'judge', label: `judge(${r.name})`, state: judgeState, result: judge.data ? `공백 ${fmt(judge.data.summary.gap)}명 (${pct(judge.data.summary.rate)})` : undefined },
    { id: 'supply', label: `공급수단 ${allowed.length}종 확인`, state: supplyState, result: allowed.map((k) => SUPPLY[k].name).join(' · ') || '없음' },
    { id: 'plans', label: `plans(목표 ${Math.round(st.target * 100)}%, 연 ${eok(st.budget)})`, state: plansState, result: plans.data ? `안 ${plans.data.plans.length}개 만듦` : undefined },
    { id: 'compare', label: '세 안 비교 (비용 절감 · 균형 · 적극 투자)', state: compareState, result: `추천 ${plans.data?.plans.find((p) => p.recommended)?.name ?? ''}` },
  ]

  // 진행 막대: 서버 답을 못 받았으면 90%에서 기다린다
  const prog = Math.round(Math.min(pFresh ? 100 : 90, (t / TOTAL) * 100))
  // 연 예산을 블록으로: 0.5억(10억 넘으면 1억)마다 한 칸씩 쌓인다
  const unit = st.budget <= 10 ? 0.5 : 1
  const blocks = Math.max(1, Math.round(st.budget / unit))
  const filled = Math.min(blocks, Math.floor((t / (TOTAL * 0.9)) * blocks))

  return (
    <motion.aside className="panel sim-panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">4단계 · 예산안 만들기</p>
      <div className="ai-orb" aria-hidden><span className="core">✦</span><i /><i /></div>
      <h1 className={allDone || failed ? '' : 'shimmer-text'}>{r.name}의 예산안을 {allDone ? '만들었어요' : '만들고 있어요'}</h1>
      <p className="muted small">계산은 모두 서버가 해요. 화면은 받은 결과만 그려요.</p>

      <div className={`sim-progress ${allDone || failed ? '' : 'run'}`} role="progressbar" aria-valuenow={prog} aria-valuemin={0} aria-valuemax={100} aria-label="예산안 만드는 중"><i style={{ width: `${prog}%` }} /></div>
      <Tools calls={calls} />

      <div className="budget-blocks" role="img" aria-label={`연 예산 ${eok(st.budget)}`}>
        {Array.from({ length: blocks }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>연 {eok(st.budget)} 예산 안에서 공급수단 조합을 찾고 있어요</p>

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
