// 추정 시뮬레이션 안내: 서버 계산을 쓸 수 없어 브라우저가 계산한 값이라는 것과, 그 값의 자료 · 한계를 함께 알린다.
// 예산안 만들기 · 결과 · What-if · 추정 요약이 같이 쓴다. '서버 다시 확인'이 되면 store가 정식 결과로 바꾸고 이 안내는 사라진다
import { useState } from 'react'
import { useStore } from '../store'

export function EstimateNotice({ notes, onRetried }: { notes?: string[]; onRetried?: () => void }) {
  const { plans, dataSource, snapshot, retryServer } = useStore()
  const [state, setState] = useState<'idle' | 'busy' | 'still'>('idle')
  const lines = notes ?? plans.data?.estimate?.notes ?? []
  const retry = async () => {
    setState('busy')
    await retryServer()
    onRetried?.()
    setState(useStore.getState().plans.source === 'estimated' ? 'still' : 'idle')
  }
  return (
    <div className="estimate-note" role="status">
      <b>추정 시뮬레이션</b>
      {dataSource === 'snapshot' && snapshot
        ? <p>현재 계산 서버에 연결할 수 없어, 사전에 확보한 지역별 공공데이터와 가정값을 바탕으로 브라우저에서 결과를 추정했습니다. 이 결과는 서버의 정식 최적화 결과와 다를 수 있습니다.</p>
        : <p>서버 계산을 사용할 수 없어 현재 지역 데이터와 가정값으로 계산한 참고 결과입니다. 실제 최적화 결과와 다를 수 있습니다.</p>}
      <p><b>실제 최적화 결과가 아니에요.</b> 달성률이 서버 결과보다 높거나 낮게 나올 수 있고, 목표 달성 여부도 다르게 판단될 수 있어요. 결정에 쓰기 전에 서버 결과로 확인해 주세요.</p>
      {dataSource === 'snapshot' && snapshot && <p>데이터 수집일: {snapshot.capturedAt}. 수집일은 저장한 날짜이고, 실제 자료의 기준 시점은 출처마다 다를 수 있습니다. 최신 자료와 다를 수 있어요.</p>}
      {lines.length > 0 && <details><summary>이 계산의 한계</summary><ul>{lines.map((x) => <li key={x}>{x}</li>)}</ul></details>}
      <button className="link no-print" onClick={() => void retry()} disabled={state === 'busy'}>{state === 'busy' ? '서버 확인 중…' : '서버로 다시 계산'}</button>
      {state === 'still' && <span className="muted small no-print"> 아직 서버에 연결되지 않아요.</span>}
    </div>
  )
}
