// 서버 계산(목표 · 결과 · 레포트 · AI)이 쓰는 판정 기준 한 줄. 서버는 진단 화면의 시설 필터와 자가용 탭을 모르고
// 늘 '모든 병의원 · 대중교통'으로 계산하므로, 진단에서 다른 것을 보고 왔으면 그것이 반영되지 않았다고 함께 적는다
import { viewName } from '../api/meta'
import { useStore } from '../store'

export function Basis({ className = 'muted small', style }: { className?: string; style?: React.CSSProperties }) {
  const st = useStore((s) => s.state)
  // 진단 화면에 있으면 지금 보는 필터, 다른 화면이면 진단에서 마지막으로 본 필터
  const pick = useStore((s) => (s.state ? viewName(s.travel, s.carTarget, s.carView ?? s.state.criteria.carMinutes) : null) ?? s.diagPick)
  // 자료 · 계산 출처: 서버 자료 + 서버 계산이면 적지 않는다. 그 밖의 조합만 숫자가 어디서 왔는지 알린다
  const origin = useStore((s) => {
    const estimated = s.plans.source === 'estimated' || s.judge.source === 'estimated'
    if (s.dataSource !== 'snapshot' && !estimated) return null
    const data = s.dataSource === 'snapshot' ? `저장된 정적 자료${s.snapshot ? `(${s.snapshot.capturedAt} 수집)` : ''}` : '서버 자료'
    return `자료: ${data} · 계산: ${estimated ? '브라우저 추정' : '서버 계산'}`
  })
  if (!st) return null
  const rule = st.service === 'med' ? `모든 병의원 · 대중교통 · 자가용 ${st.criteria.carMinutes}분` : '버스 이용 · 정류장과 운행만 봐요'
  return (
    <p className={className} style={style}>
      기준: {rule}
      {pick && <> · 진단에서 본 ‘{pick}’은 화면 전용이라 계산에 쓰지 않아요</>}
      {origin && <> · {origin}</>}
    </p>
  )
}
