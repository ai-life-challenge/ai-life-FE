// 오른쪽 위 단계 표시: '2 / 6 · 진단' 알약 버튼. 누르면 6단계 목록이 펼쳐지고, 거쳐 온 단계와 바로 다음 단계로 이동할 수 있다.
// 목록에는 그 단계에서 정한 값(지역, 목표·예산, 추천안 등)을 같이 보여 준다.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { SERVICES, eok, pct } from '../api/meta'
import { useStore } from '../store'
import { Chevron } from './Chevron'

export const STEPS = [
  { path: '', label: '지역' },
  { path: '', label: '진단' },
  { path: '/goal', label: '목표' },
  { path: '/sim', label: '시뮬레이션' },
  { path: '/result', label: '결과' },
  { path: '/report', label: '레포트' },
]

export function Progress({ code, at }: { code: string | null; at: number }) {
  const nav = useNavigate()
  const { reached, set, regions, state, judge, plans } = useStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const r = regions.find((x) => x.code === code)
  // 지금까지 가 본 가장 먼 단계 (지역이 바뀌면 처음부터 센다)
  const max = r && reached.code === r.code ? Math.max(reached.max, at) : at
  useEffect(() => {
    if (r && (reached.code !== r.code || reached.max < at)) set({ reached: { code: r.code, max: reached.code === r.code ? Math.max(reached.max, at) : at } })
  }, [r, at, reached, set])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const value = (i: number) => {
    if (!r || i > max) return ''
    if (i === 0) return r.name
    if (i === 1) return judge.data ? `공백 ${pct(judge.data.summary.rate)}` : ''
    if (i === 2) return state ? `${SERVICES.find((x) => x.id === state.service)!.name} · 연 ${eok(state.budget)}` : ''
    if (i === 3) return plans.data ? `대안 ${plans.data.plans.length}개` : ''
    if (i === 4) return plans.data ? `추천 ${plans.data.plans.find((p) => p.recommended)?.name ?? ''}` : ''
    if (i === 5) return '초안'
    return ''
  }
  const go = (i: number) => { setOpen(false); nav(i === 0 ? '/start' : `/r/${code}${STEPS[i].path}`) }

  return (
    <div className="step-menu" ref={ref}>
      <button className="step-pill" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} aria-label={`${STEPS.length}단계 중 ${at + 1}단계 ${STEPS[at].label}. 눌러서 다른 단계로 이동`}>
        <b className="num">{at + 1} / {STEPS.length}</b> · {STEPS[at].label} <Chevron open={open} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul className="step-list" role="menu" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.15 }}>
            {STEPS.map((s, i) => {
              const locked = i > max + 1 || (i > 0 && !code)
              const state = i === at ? 'on' : i <= max ? 'done' : 'todo'
              return (
                <li key={s.label} role="none">
                  <button role="menuitem" className={`step-item ${state}`} disabled={locked || i === at} onClick={() => go(i)} title={locked ? '앞 단계를 먼저 거쳐야 해요' : undefined} aria-current={i === at ? 'step' : undefined}>
                    <span className="st" aria-hidden>{state === 'on' ? '●' : state === 'done' ? '✓' : locked ? <LockIcon /> : '○'}</span>
                    <span className="num">{i + 1}</span>
                    <span className="lbl">{s.label}</span>
                    <span className="val">{i === at ? '(지금)' : value(i)}</span>
                  </button>
                </li>
              )
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  )
}

// 잠긴 단계 표시 (이모지 대신 선 아이콘)
const LockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-label="잠김" role="img">
    <rect x="3" y="7" width="10" height="7" rx="1.6" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
)
