import { useNavigate } from 'react-router'
import { motion } from 'motion/react'

const STEPS = [
  { path: '', label: '공백 진단' },
  { path: '/plan', label: '목표·대안·추천' },
  { path: '/memo', label: '검토 메모' },
]

export function Stepper({ sgg, at }: { sgg: string; at: 0 | 1 | 2 }) {
  const nav = useNavigate()
  return (
    <ol className="stepper">
      {STEPS.map((s, i) => (
        <li key={s.path} className={i === at ? 'on' : i < at ? 'done' : ''}>
          <button onClick={() => nav(`/c/${sgg}${s.path}`)}>
            <span className="num">{i + 1}</span>
            {s.label}
          </button>
          {i === at && <motion.span layoutId="step-bar" className="step-bar" />}
        </li>
      ))}
    </ol>
  )
}
