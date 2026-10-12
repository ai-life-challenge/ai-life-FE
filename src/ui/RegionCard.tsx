// 지역 카드: S1 왼쪽 패널 목록과, 지도에서 군에 마우스를 올렸을 때 그 군 위에 뜨는 카드가 같이 쓴다.
import { motion } from 'motion/react'
import type { RegionItem } from '../api/types'
import { LevelBadge } from './Badges'

export function RegionCard({ r, compact, on, dim, onClick, onHover }: { r: RegionItem; compact?: boolean; on?: boolean; dim?: boolean; onClick?: () => void; onHover?: (on: boolean) => void }) {
  const body = (
    <>
      <div className="row">
        <h2>{r.name}</h2>
        <span className="muted small">{r.sido}</span>
        <span className="spacer" />
        <LevelBadge tier={r.tier} />
      </div>
      <p className="muted small" style={{ margin: 0 }}>마을 <b className="num">{r.villages}</b>곳</p>
      {compact && <p className="pop-hint">눌러서 이 군으로 시작 →</p>}
    </>
  )
  if (compact) return <div className="region pop">{body}</div>
  return (
    <motion.button className={`region ${on ? 'on' : ''}`} onClick={onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
      animate={{ opacity: dim ? 0.35 : 1, scale: dim ? 0.98 : 1 }} whileHover={{ y: -2 }}>
      {body}
    </motion.button>
  )
}
