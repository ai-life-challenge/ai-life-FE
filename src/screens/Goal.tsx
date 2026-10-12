// S3 목표·예산: 연 예산, 목표 달성률, 쓸 수 있는 공급수단을 정한다. 값은 모두 서버가 정한 범위 안이다(예산 0~30억, 목표 50~100%).
import { useNavigate, useParams } from 'react-router'
import { motion } from 'motion/react'
import { SUPPLY, SUPPLY_IDS, eok } from '../api/meta'
import type { SupplyId } from '../api/types'
import { useStore } from '../store'
import { Count } from '../ui/Count'
import { SrcBadge } from '../ui/Badges'

export function Goal() {
  const { code } = useParams()
  const nav = useNavigate()
  const { state, regions, patch } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const allowed = SUPPLY_IDS.filter((k) => st.allowedSupply[k])
  const toggle = (k: SupplyId) => {
    if (st.allowedSupply[k] && allowed.length === 1) return // 하나는 남겨 둔다
    patch((s) => ({ ...s, allowedSupply: { ...s.allowedSupply, [k]: !s.allowedSupply[k] } }))
  }

  return (
    <motion.aside className="panel goal-panel" initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 28 }}>
      <p className="eyebrow">3단계 · 목표와 예산</p>
      <h1>{r.name}, 얼마를 써서 어디까지 닿을까요?</h1>
      <p className="muted">연 예산과 목표를 정하면 목표를 채우는 가장 싼 안부터, 예산 안에서 가장 많이 닿는 안까지 3개를 만들어요.</p>

      <div className="slider-box">
        <div className="row"><b>연 예산</b><span className="spacer" /><span className="big num"><Count value={st.budget} ms={300} format={(n) => (Math.round(n * 2) / 2).toString()} /><small>억</small></span></div>
        <input type="range" min={0} max={30} step={0.5} value={st.budget} onChange={(e) => patch((s) => ({ ...s, budget: +e.target.value }))} aria-label="연 예산(억 원)" />
        <div className="slider-ends"><span>0억</span><span>30억</span></div>
      </div>

      <div className="slider-box">
        <div className="row"><b>목표 달성률</b><span className="spacer" /><span className="big num">{Math.round(st.target * 100)}<small>%</small></span></div>
        <input type="range" min={50} max={100} step={1} value={Math.round(st.target * 100)} onChange={(e) => patch((s) => ({ ...s, target: +e.target.value / 100 }))} aria-label="목표 달성률(%)" />
        <div className="slider-ends"><span>50%</span><span>100%</span></div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>선택한 기준에서 갈 수 있는 사람의 비율이에요.</p>
      </div>

      <h3 style={{ marginTop: 22 }}>쓸 수 있는 공급수단 <SrcBadge kind="assume" id="costs" note="단가" /></h3>
      <div className="supply-list" role="group" aria-label="공급수단">
        {SUPPLY_IDS.map((k) => {
          const c = st.assumptions.costs[k], on = st.allowedSupply[k]
          return (
            <button key={k} className={`supply ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(k)} disabled={on && allowed.length === 1} title={on && allowed.length === 1 ? '하나는 켜 두어야 해요' : undefined}>
              <i className="sw" style={{ background: SUPPLY[k].color }} />
              <b>{SUPPLY[k].name}</b>
              <span className="muted small">설치 {eok(c.install)} · 연 {eok(c.yearly)} · {c.years}년</span>
            </button>
          )
        })}
      </div>

      <div className="next-row">
        <button className="ghost" onClick={() => nav(`/r/${code}`)}>← 진단으로</button>
        <button className="primary big-btn" onClick={() => nav(`/r/${code}/sim`)}>안 만들기 →</button>
      </div>
    </motion.aside>
  )
}
