import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'

// 도구 호출 칩: 회색 + 스피너 → 초록 ✓. 펼치면 입력값과 결과 요약이 보인다
export interface ToolCall { id: string; label: string; state: 'wait' | 'run' | 'done'; result?: string; detail?: string }

export function Tools({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <ul className="tools">
      <AnimatePresence initial={false}>
        {calls.map((c) => (
          <motion.li key={c.id} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: c.state === 'wait' ? 0.6 : 1, y: 0 }}>
            <button className="tool-head" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id} disabled={!c.detail}>
              <span className={`st ${c.state === 'done' ? 'ok' : 'wait'}`}>{c.state === 'done' ? '✓' : c.state === 'run' ? <span className="spin" /> : '○'}</span>
              <code>{c.label}</code>
              {c.state === 'done' && c.result && <span className="res">{c.result}</span>}
            </button>
            <AnimatePresence>
              {open === c.id && c.detail && (
                <motion.div className="tool-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                  <pre>{c.detail}</pre>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
