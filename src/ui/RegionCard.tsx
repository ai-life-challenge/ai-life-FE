// 지역 카드: S1 왼쪽 패널 목록과, 지도에서 군에 마우스를 올렸을 때 그 군 위에 뜨는 카드가 같이 쓴다.
import { motion } from 'motion/react'
import type { Region } from '../data/regions'
import { indicators, isVulnerable } from '../sim/model'
import { fmt, pct } from '../motion/useCountUp'
import { Count } from './Count'
import { LevelBadge } from './Badges'

export function RegionCard({ r, compact, on, dim, onClick, onHover }: { r: Region; compact?: boolean; on?: boolean; dim?: boolean; onClick?: () => void; onHover?: (on: boolean) => void }) {
  const vul = isVulnerable(indicators(r))
  const body = (
    <>
      <div className="row">
        <h2>{r.name}</h2>
        {vul && <span className="badge red">응급취약</span>}
        <span className="spacer" />
        <LevelBadge level={r.level} />
      </div>
      <dl className="stats">
        <div><dt>인구</dt><dd><Count value={r.pop} ms={compact ? 500 : 900} />명</dd></div>
        <div><dt>65세 이상</dt><dd>{pct(r.elderly)}</dd></div>
        <div><dt>응급실 30분 밖</dt><dd className={r.e30 >= 0.27 ? 'bad' : ''}>{pct(r.e30)}</dd></div>
        <div><dt>보건+교통 예산</dt><dd>{fmt(r.budget.health + r.budget.transport)}억</dd></div>
      </dl>
      {compact && <p className="pop-hint">눌러서 이 군으로 시작 →</p>}
    </>
  )
  if (compact) return <div className="region pop">{body}</div>
  return (
    <motion.button className={`region ${on ? 'on' : ''}`} onClick={onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
      animate={{ opacity: dim ? 0.35 : 1, scale: dim ? 0.98 : 1 }} whileHover={{ y: -3 }}>
      {body}
    </motion.button>
  )
}
