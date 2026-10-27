// 지역 카드: S1 왼쪽 패널 목록과, 지도에서 군에 마우스를 올렸을 때 그 군 위에 뜨는 카드가 같이 쓴다.
// 인구·고령 비율·병원 30분 밖·취약도는 지역 자료(지역마다 70KB 안팎)가 있어야 해서, 카드가 화면에 보일 때(지도 카드는 바로) 받아 온다.
import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'motion/react'
import type { RegionItem } from '../api/types'
import { regionData } from '../api/client'
import { fmt, pct } from '../api/meta'
import { STD, vulnOf } from '../api/vuln'
import { Count } from './Count'
import { LevelBadge } from './Badges'

interface Summary { pop: number; elderly: number; e30: number | null; vulnerable: boolean; mvi: number; tvi: number }

function useSummary(code: string, enabled: boolean) {
  const [s, setS] = useState<Summary | null>(null)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    regionData(code).then((d) => {
      const v = vulnOf(d)
      if (alive) setS({ pop: d.indicators.pop ?? 0, elderly: d.indicators.elderly ?? 0, e30: v.e30, vulnerable: v.vulnerable, mvi: v.mvi, tvi: v.tvi })
    }, () => {})
    return () => { alive = false }
  }, [code, enabled])
  return s
}

export function RegionCard({ r, compact, on, dim, onClick, onHover }: { r: RegionItem; compact?: boolean; on?: boolean; dim?: boolean; onClick?: () => void; onHover?: (on: boolean) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const seen = useInView(ref, { once: true, margin: '200px' })
  const s = useSummary(r.code, compact || seen)
  const body = (
    <>
      <div className="row">
        <h2>{r.name}</h2>
        {s?.vulnerable && <span className="badge red" title={`응급실 30분 밖 또는 권역센터 60분 밖 주민이 ${pct(STD.theta)} 이상이에요`}>응급의료 취약지</span>}
        <span className="muted small">{r.sido}</span>
        <span className="spacer" />
        <LevelBadge tier={r.tier} />
      </div>
      <dl className="stats">
        <div><dt>인구</dt><dd>{s ? <><Count value={s.pop} ms={compact ? 500 : 900} />명</> : '…'}</dd></div>
        <div><dt>65세 이상</dt><dd>{s ? pct(s.elderly) : '…'}</dd></div>
        <div><dt>응급실 30분 밖</dt><dd className={s && s.e30 != null && s.e30 >= STD.theta ? 'bad' : ''}>{s ? (s.e30 == null ? '자료 없음' : pct(s.e30)) : '…'}</dd></div>
        <div><dt>의료 · 교통 취약도</dt><dd>{s ? <>{Math.round(s.mvi)} · {Math.round(s.tvi)}<small className="muted">점</small></> : '…'}</dd></div>
      </dl>
      <p className="muted small" style={{ margin: 0 }}>마을 <b className="num">{fmt(r.villages)}</b>곳</p>
    </>
  )
  // 지도 위 카드: 시작 안내는 흰 카드 밖, 카드 위에 따로 띄운다
  if (compact) return <div className="pop-wrap"><p className="pop-hint">눌러서 이 군으로 시작<svg aria-hidden width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.5 5l5 5-5 5" /></svg></p><div className="region pop">{body}</div></div>
  return (
    <motion.button ref={ref} className={`region ${on ? 'on' : ''}`} onClick={onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)} onFocus={() => onHover?.(true)} onBlur={() => onHover?.(false)}
      animate={{ opacity: dim ? 0.35 : 1, scale: dim ? 0.98 : 1 }} whileHover={{ y: -2 }}>
      {body}
    </motion.button>
  )
}
