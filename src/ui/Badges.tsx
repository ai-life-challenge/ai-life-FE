import type { Tier } from '../api/types'
import { useStore } from '../store'

// 정밀 지역은 버스 하루 운행 횟수·읍내행 첫차까지 보고, 나머지는 정류장까지 걷는 거리만 본다
export const LevelBadge = ({ tier }: { tier: Tier }) =>
  tier === 'precise' ? <span className="badge precise" title="버스 운행 횟수와 첫차까지 반영">정밀</span> : <span className="badge estimated" title="정류장까지 걷는 거리만 반영">간이 판정</span>

// AI가 만든 요소(에이전트 답, 레포트 초안)는 모두 같은 배지를 쓴다
export const AiBadge = ({ children = 'AI' }: { children?: React.ReactNode }) => <span className="badge ai"><span>✦ {children}</span></span>

// [공공데이터] / [가정값] 배지. 누르면 가정과 출처 화면의 해당 행으로 간다
export function SrcBadge({ kind, id, note }: { kind: 'public' | 'assume'; id: string; note?: string }) {
  const open = useStore((s) => s.openSources)
  return (
    <button className={`badge ${kind}`} onClick={(e) => { e.stopPropagation(); open(id) }} title="가정과 출처에서 보기">
      {kind === 'public' ? '공공데이터' : '가정값'}{note ? ` · ${note}` : ''}
    </button>
  )
}
