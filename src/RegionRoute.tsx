import { useEffect } from 'react'
import { Navigate, useParams } from 'react-router'
import { useStore } from './store'

// /r/:code 아래 화면은 지역 자료가 와 있어야 한다. 없는 코드면 지역 선택으로 돌려보내고, 오는 중이면 기다린다
export function RegionRoute({ children }: { children: React.ReactNode }) {
  const { code } = useParams()
  const { regions, listError, code: loaded, data, state, regionError, unsupported, snapshot, listSource, loadList, loadRegion, retryServer } = useStore()
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => { if (code) void loadRegion(code) }, [code, loadRegion])
  // 서버 장애 때 지원하지 않는 지역: 지역 선택으로 말없이 돌려보내지 않고 이유를 알린다. 서버가 돌아오면 이 화면이 자료 화면으로 바뀐다
  const held = unsupported ?? (listSource === 'snapshot' && !(loaded === code && data) ? snapshot?.unsupported?.find((r) => r.code === code) ?? null : null)
  if (held) {
    return (
      <aside className="panel" role="status">
        <p className="eyebrow">서버 장애 중</p>
        <h1>{held.name}은(는) 지금 지원하지 않아요</h1>
        <p className="muted">서버에 연결되지 않는 동안에는 이 지역의 진단과 계산을 할 수 없어요. 원자료 이용 조건을 확인하는 중이라 저장 자료에 넣지 않았어요. 값을 어림해서 보여 드리지 않아요.</p>
        <p className="muted">서버가 돌아오면 이 화면이 자동으로 이어져요.</p>
        <div className="row"><button className="primary" onClick={() => void retryServer()}>서버 다시 확인</button><button className="ghost" onClick={() => window.location.assign('/start')}>저장 자료가 있는 지역 고르기</button></div>
      </aside>
    )
  }
  const error = listError ?? regionError
  if (error) {
    return (
      <aside className="panel">
        <h1>불러오지 못했어요</h1>
        <p className="muted">{error}</p>
        <div className="row"><button className="primary" onClick={() => { void loadList(); if (code) { useStore.setState({ code: null }); void loadRegion(code) } }}>다시 시도</button><button className="ghost" onClick={() => window.location.assign('/start')}>지역 다시 고르기</button></div>
      </aside>
    )
  }
  if (!regions.length) return <aside className="panel"><p className="muted" role="status">불러오는 중이에요…</p></aside>
  if (!regions.some((r) => r.code === code)) return <Navigate to="/start" replace />
  if (loaded !== code || !data || !state) return <aside className="panel"><p className="muted" role="status">{regions.find((r) => r.code === code)!.name} 자료를 불러오는 중이에요…</p></aside>
  return children
}
