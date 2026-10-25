// 하나만 고르는 선택(이동 수단 · 나이대 · 레포트 안): 둘러싼 막대 안에서 선택된 알약이 미끄러져 옮겨 간다
import { motion } from 'motion/react'

export function Seg<T extends string | number>({ id, label, options, value, onChange }: { id: string; label: string; options: { id: T; name: string }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="segc" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {value === o.id && <motion.span className="segc-pill" layoutId={`segc-${id}`} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          <span className="segc-text">{o.name}</span>
        </button>
      ))}
    </div>
  )
}
