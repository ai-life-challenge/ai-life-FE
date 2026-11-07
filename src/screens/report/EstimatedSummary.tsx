// 추정 결과 요약: 서버 레포트를 만들 수 없을 때(대안이 추정일 때) 보여 주는 제한된 문서. 계산한 숫자와 그 식만 적는다.
// 문단 생성 · 출처 각주 · 편집기는 서버 레포트 전용이라 쓰지 않고, 출처는 이 지역 자료에 담긴 목록만 그대로 옮긴다(날짜 · 링크를 지어내지 않는다).
// 같은 조건은 링크로 다시 열 수 있다(서버 레포트와 같은 공유 링크). 서버가 돌아와 정식 대안을 받으면 이 문서 대신 서버 레포트가 열린다.
import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { motion } from 'motion/react'
import { TYPE_NAME as COST_NAME, yearCost } from '../../api/estimatePlans'
import { AGES, SUPPLY_IDS, eok, fmt, pct1 } from '../../api/meta'
import { shareQuery } from '../../api/share'
import type { Plan, Plans } from '../../api/types'
import { useStore } from '../../store'
import { AiBadge, LevelBadge } from '../../ui/Badges'
import { Basis } from '../../ui/Basis'
import { EstimateNotice } from '../../ui/EstimateNotice'
import { OsmNotice } from '../../ui/OsmNotice'

const today = new Date().toLocaleDateString('sv-SE')

// 공백 마을 수: 앞에서부터 공백 → 새로 닿음(coverage 1) · 원격만(0~1) · 남음(0). 지도 · 범례와 같은 coverage를 쓴다
function villageCounts(plans: Plans, plan: Plan) {
  const basis = plans.estimate!.basis
  let before = 0, reached = 0, tele = 0, left = 0, full = 0, teleOnly = 0, total = 0
  basis.forEach((v, i) => {
    const c = plan.coverage[i]
    total += v.people
    if (v.state === 0) { full += v.people; return }
    before++
    if (c >= 1) { reached++; full += v.people } else if (c > 0) { tele++; teleOnly += v.people } else left++
  })
  return { before, reached, tele, left, full, teleOnly, total }
}

export function EstimatedSummary({ plans }: { plans: Plans }) {
  const { code } = useParams()
  const { state, regions, data, dataSource, snapshot, snapshotNotes, patch } = useStore()
  const [toast, setToast] = useState<string | null>(null)
  const copyLink = async () => {
    const u = new URL(window.location.href)
    u.search = shareQuery(state!, u.searchParams).toString()
    try { await navigator.clipboard.writeText(u.toString()); setToast('같은 조건을 다시 여는 링크를 복사했어요') } catch { setToast('복사하지 못했어요. 주소창의 링크를 써 주세요') }
    setTimeout(() => setToast(null), 1800)
  }
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const plan = plans.plans[st.planShow] ?? plans.plans[plans.recommended]
  const counts = useMemo(() => villageCounts(plans, plan), [plans, plan])
  const e = st.assumptions.teleEffect
  const groups = SUPPLY_IDS.flatMap((t) => { const ps = plan.picks.filter((x) => x.type === t); return ps.length ? [{ t, ps }] : [] })

  return (
    <motion.div className="report-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="report-bar no-print">
        <span />
        <div className="report-actions">
          <button className="ghost" onClick={() => void copyLink()}>링크 복사</button>
          <button className="primary" onClick={() => window.print()}>PDF로 저장</button>
        </div>
      </div>
      <article className="paper">
        <p className="muted small" style={{ margin: 0 }}>{today} · {r.name} <LevelBadge tier={r.tier} /> <AiBadge>추정 요약</AiBadge></p>
        <h1>{r.name} 추정 결과 요약</h1>
        <Basis />
        <EstimateNotice />
        <p>서버 레포트를 만들 수 없어 공문 초안 대신 계산 결과만 정리했어요. 공문 문단과 출처 각주는 서버가 돌아오면 다시 만들 수 있어요. 이 문서는 공식 검토 자료로 쓰지 말아 주세요.</p>

        <h2>계산 조건</h2>
        <ul>
          <li>연 예산 {eok(st.budget)} · 목표 달성률 {pct1(st.target)} · {AGES.find((a) => a.id === st.age)!.name} 기준</li>
          <li>자가용 {st.criteria.carMinutes}분 · 정류장까지 걸어서 {st.criteria.stopWalkMinutes}분{r.tier === 'precise' ? ` · 버스 하루 ${st.criteria.dailyRuns}번 이상 · 낮 12시 전 읍내행 첫차` : ' · 간이 판정 지역이라 버스 운행은 보지 않아요'}</li>
          <li>쓸 수 있는 공급수단: {SUPPLY_IDS.filter((t) => st.allowedSupply[t]).map((t) => COST_NAME[t]).join(', ') || '없음'} · 순회 진료 주 {st.assumptions.tourWeekly}회</li>
        </ul>

        <h2>대안 비교</h2>
        <table className="ltable">
          <thead><tr><th>안</th><th className="r">달성률</th><th className="r">남는 공백</th><th className="r">연 비용</th><th className="r">설치</th><th className="r">10년 뒤</th></tr></thead>
          <tbody>
            {plans.plans.map((t) => (
              <tr key={t.k} className={`pick${t.k === plan.k ? ' rec' : ''}`} onClick={() => patch((s) => ({ ...s, planShow: t.k }))}>
                <td><button type="button" className="row-pick" aria-pressed={t.k === plan.k} title="이 안을 기준으로 보기"><b>{t.name}</b></button>{t.recommended ? ' ⭐' : ''}<br /><span className="muted small">{t.summary}</span></td>
                <td className="r">{pct1(t.rate)}<br /><span className="muted small">{t.meetsTarget ? '목표 달성 (추정)' : '목표 미달 (추정)'}</span></td>
                <td className="r">{fmt(t.gapAfter)}명</td><td className="r">{eok(t.year)}</td><td className="r">{eok(t.install)}</td>
                <td className="r">{t.future != null ? pct1(t.future) : <span className="muted" title="10년 뒤 값은 80세 이상 기준에서만 계산해요">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>{plan.name}의 배치</h2>
        {!plan.picks.length && <p>추가로 놓는 공급수단이 없어요.</p>}
        {!!plan.picks.length && (
          <table className="ltable">
            <thead><tr><th>공급수단</th><th className="r">수량</th><th className="r">연 비용</th><th className="r">설치</th></tr></thead>
            <tbody>
              {groups.map(({ t, ps }) => (
                <tr key={t}>
                  <td>{COST_NAME[t]}<br /><span className="muted small">{ps.map((x) => x.label.replace(`${COST_NAME[t]} `, '').replace(/^\(|\)$/g, '')).join(', ')}</span></td>
                  <td className="r">{ps.length}</td>
                  <td className="r">{eok(ps.reduce((a, x) => a + x.year, 0))}</td>
                  <td className="r">{eok(ps.reduce((a, x) => a + x.install, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>계산 근거</h2>
        <ul>
          <li>공백 마을 {counts.before}곳 가운데 {counts.reached}곳이 새로 닿고, {counts.tele}곳은 원격진료로만 닿고, {counts.left}곳이 남아요.</li>
          <li>달성률 {pct1(plan.rate)} = {counts.teleOnly > 0 ? `(${fmt(counts.full)}명 + ${fmt(counts.teleOnly)}명 × ${e})` : `${fmt(counts.full)}명`} ÷ {fmt(counts.total)}명</li>
          <li>연 비용 {eok(plan.year)} = {groups.length ? groups.map(({ t, ps }) => `${COST_NAME[t]} ${eok(yearCost(st.assumptions.costs[t]))} × ${ps.length}`).join(' + ') : '0'} (예산 {eok(st.budget)})</li>
          <li>수단별 연 비용 = 설치비 ÷ 쓰는 기간 + 연 운영비. 단가와 원격진료 효과 {e}는 가정값이에요.</li>
        </ul>

        <h2>쓴 자료</h2>
        {dataSource === 'snapshot' && snapshot
          ? <p className="muted small">자료: {snapshot.capturedAt}에 수집해 저장한 값(서버 최신 자료가 아니에요) · 계산: 브라우저 추정. 수집일은 저장한 날짜이고 원본 통계의 기준 시점은 출처마다 달라요.</p>
          : <p className="muted small">자료: 서버에서 받은 지역 자료 · 계산: 브라우저 추정</p>}
        {dataSource === 'snapshot' && !!snapshotNotes?.length && (
          <table className="ltable">
            <thead><tr><th>원자료</th><th>이용 조건</th><th className="r">자료 기준 시점</th></tr></thead>
            <tbody>{snapshotNotes.map((n) => <tr key={`${n.org}-${n.title}`}><td>{n.org} · {n.title}</td><td>{n.license ?? ''}</td><td className="r">{n.date ?? '표시 없음'}</td></tr>)}</tbody>
          </table>
        )}
        <p className="muted small">이 지역 마을 자료에 담긴 출처 목록이에요: {data?.sources.join(' · ')}</p>
        <OsmNotice />
      </article>
      {toast && <div className="toast no-print" role="status">{toast}</div>}
    </motion.div>
  )
}
