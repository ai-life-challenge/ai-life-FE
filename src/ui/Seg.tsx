// 하나만 고르는 선택(이동 수단 · 나이대 · 레포트 안): 둘러싼 막대 안에서 선택된 알약이 미끄러져 옮겨 간다
// fade: 알약이 옮겨 가지 않고 고른 단추 자리에서 바로 나타난다. 고정(sticky) 막대 안에서 고른 뒤 아래 글 길이가 바뀌어
// 스크롤 위치가 움직이면, 미끄러지는 알약(layoutId)은 페이지 기준 위치가 바뀐 것으로 보고 세로로 튀었다가 돌아온다(레포트 상단)
import { motion } from 'motion/react'

export function Seg<T extends string | number>({ id, label, options, value, onChange, fade = false }: { id: string; label: string; options: { id: T; name: string; badge?: string }[]; value: T; onChange: (id: T) => void; fade?: boolean }) {
  return (
    <div className={`segc${fade ? ' fade' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {fade
            ? <span className="segc-pill" aria-hidden />
            : value === o.id && <motion.span className="segc-pill" layoutId={`segc-${id}`} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
          {fade ? (
            // 고르면 글자가 굵어져도 단추 너비가 바뀌지 않게, 보이지 않는 굵은 글자로 자리를 잡아 둔다
            <span className="segc-text">
              <span className="segc-label">{o.name}{o.badge && <em className="segc-badge">{o.badge}</em>}</span>
              <span className="segc-label segc-ghost" aria-hidden>{o.name}{o.badge && <em className="segc-badge">{o.badge}</em>}</span>
            </span>
          ) : <span className="segc-text">{o.name}{o.badge && <em className="segc-badge">{o.badge}</em>}</span>}
        </button>
      ))}
    </div>
  )
}
