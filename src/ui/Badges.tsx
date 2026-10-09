import type { DataLevel } from '../data/regions'
import { useStore } from '../store'

export const LevelBadge = ({ level }: { level: DataLevel }) =>
  level === 'precise' ? <span className="badge precise">정밀</span> : <span className="badge estimated">추정 포함</span>

// AI가 만든 요소(프리셋 추천, 해설, 레포트)는 모두 같은 배지를 쓴다
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
