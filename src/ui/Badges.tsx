import type { DataLevel } from '../api/types'

export const LevelBadge = ({ level }: { level: DataLevel }) =>
  level === 'precise' ? <span className="badge precise">정밀</span> : <span className="badge estimated">추정 포함</span>

// AI가 한 일은 그라데이션 글자로 구분한다
export const AiBadge = ({ children = 'AI' }: { children?: React.ReactNode }) => <span className="badge ai"><span>✦ {children}</span></span>
