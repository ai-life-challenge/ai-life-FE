// S7 가정과 출처 (보조 화면, 사이드 시트). 어느 화면에서든 출처 배지를 누르면 해당 행으로 스크롤되고 하이라이트된다.
// 단가를 고치면 모든 결과가 다시 계산된다.
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { DATA_SOURCES } from '../data/regions'
import { DEFAULT_COSTS, FX, LEVERS, PRESETS, STD, type CostLevel } from '../sim/model'
import { useStore } from '../store'

const LV: CostLevel[] = ['low', 'mid', 'high']

export function Sources() {
  const { sources, costs, set } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  const close = () => set({ sources: { ...sources, open: false } })

  useEffect(() => {
    if (!sources.open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    // 시트가 열린 뒤 해당 행으로
    const t = setTimeout(() => {
      const el = sources.focus && ref.current?.querySelector<HTMLElement>(`[data-src="${sources.focus}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      const rows = el.tagName === 'TR' ? [el] : [...el.querySelectorAll('tr')]
      rows.forEach((row) => { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash') })
    }, 280)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [sources.open, sources.focus, sources.at])

  const setCost = (id: keyof typeof costs, lv: CostLevel, v: number) => {
    if (!(v > 0)) return
    set({ costs: { ...costs, [id]: { ...costs[id], [lv]: v } } })
  }
  const edited = JSON.stringify(costs) !== JSON.stringify(DEFAULT_COSTS)

  return (
    <AnimatePresence>
      {sources.open && (
        <>
          <motion.div className="scrim" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="가정과 출처" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
            <button className="close" onClick={close} aria-label="닫기">×</button>
            <h2>이 시뮬레이션이 사용한 데이터와 가정</h2>
            <p className="muted small">데이터와 가정을 나눠서 공개해요. 지금 지역 지표는 모두 수집 전 예시값이에요.</p>

            <h3><span className="badge public">공공데이터</span> 지역 지표</h3>
            <table className="stable">
              <thead><tr><th>항목</th><th>출처</th><th>기준일</th></tr></thead>
              <tbody>
                {DATA_SOURCES.map((d) => <tr key={d.id} data-src={d.id}><td>{d.label} <span className="badge warnb">예시값</span></td><td>{d.source}</td><td>{d.date}</td></tr>)}
              </tbody>
            </table>

            <h3><span className="badge assume">가정값</span> 단가 (억 원 / 단위·년) {edited && <button className="link small" onClick={() => set({ costs: DEFAULT_COSTS })}>기본값으로</button>}</h3>
            <p className="muted small" style={{ margin: '0 0 6px' }}>숫자를 고치면 결과가 바로 다시 계산돼요.</p>
            <table className="stable" data-src="costs">
              <thead><tr><th>정책 (단위)</th><th className="r">저</th><th className="r">중</th><th className="r">고</th><th>근거</th></tr></thead>
              <tbody>
                {LEVERS.map((l) => (
                  <tr key={l.id} data-src={`cost-${l.id}`}>
                    <td><span className="sw" style={{ background: l.color }} />{l.short} <span className="muted">(1{l.unit})</span></td>
                    {LV.map((lv) => <td key={lv} className="r"><input type="number" step="0.1" min="0.1" value={costs[l.id][lv]} onChange={(e) => setCost(l.id, lv, +e.target.value)} aria-label={`${l.short} ${lv} 단가`} /></td>)}
                    <td className="small">{l.sourceOk ? l.source : <span className="warn">⚠ 출처 확인 중 — {l.source}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3><span className="badge assume">가중치</span> 정책 목표 프리셋</h3>
            <table className="stable" data-src="weights">
              <thead><tr><th>프리셋</th><th className="r">γ 의료 비중</th><th className="r">의료 w1/w2/w3</th><th className="r">교통 w4/w5/w6</th></tr></thead>
              <tbody>{PRESETS.map((p) => <tr key={p.id}><td>{p.icon} {p.name}</td><td className="r">{p.gamma}</td><td className="r">{p.wm.join(' / ')}</td><td className="r">{p.wt.join(' / ')}</td></tr>)}</tbody>
            </table>
            <p className="muted small">w1 E30 · w2 E60 · w3 의사 수 / w4 최소서비스 · w5 사망률 · w6 병원 대중교통시간. AHP 응답 전 예시값이며, 팀 AHP(일관성 CR &lt; 0.1)로 확정해 결과표를 여기에 공개해요.</p>

            <h3><span className="badge assume">기준값</span> 공식 기준과 설정값</h3>
            <table className="stable" data-src="std">
              <tbody>
                <tr><td>응급의료 취약지 기준 (E30 또는 E60)</td><td className="r">{STD.theta * 100}%</td><td className="small">복지부·NMC, 27%/30% 혼재 → 설정값</td></tr>
                <tr><td>대중교통 최소서비스 확보 / 사각</td><td className="r">{STD.msTarget * 100}% / 60%</td><td className="small">대중교통현황조사 방법론</td></tr>
                <tr><td>인구 1천명당 의사 수 전국 평균</td><td className="r">{STD.natD}명</td><td className="small">보건의료인력 통계 (확인 필요)</td></tr>
                <tr><td>인구 10만명당 교통사고 사망자 전국 평균</td><td className="r">{STD.natAR}명</td><td className="small">TAAS (확인 필요) · 2배 = 100점</td></tr>
                <tr><td>병원까지 대중교통시간 100점</td><td className="r">{STD.htFull}분</td><td className="small">설정값 (구현안 60분 → 예시 지역이 넘어 120분)</td></tr>
                <tr><td>대중교통 이용자 병원 접근 기준</td><td className="r">{STD.ptLimit}분</td><td className="small">설정값 · 마을별 ±{STD.ptSpread * 100}% 분포 가정</td></tr>
                <tr><td>대중교통 의존 비율 τ</td><td className="r">고령×{STD.tauPerElderly}</td><td className="small">가정값 (교차효과 연결)</td></tr>
                <tr><td>교통사고 사망 1명 사회적 비용</td><td className="r">{STD.deathCost}억</td><td className="small">도로교통공단 2022</td></tr>
              </tbody>
            </table>

            <h3><span className="badge assume">효과 가정</span></h3>
            <table className="stable" data-src="effects">
              <tbody>
                <tr><td>응급 거점: E30 × e^(−k·개소)</td><td className="r">k = {FX.erK}</td><td className="small">E60은 {FX.erE60 * 100}%만 개선</td></tr>
                <tr><td>의료인력 체감 기준</td><td className="r">{FX.docMax}명</td><td className="small">가정값</td></tr>
                <tr><td>DRT 1대가 맡는 사각 인구</td><td className="r">{FX.drtCover.toLocaleString()}명</td><td className="small">커버 시 도보 {FX.drtWalkCut * 100}% 감소</td></tr>
                <tr><td>교통안전시설 CMF</td><td className="r">{FX.safetyCMF}</td><td className="small">국내 16개 유형 20–30% 감소(대한교통학회지 2023)</td></tr>
                <tr><td>구조개선 CMF (회전교차로)</td><td className="r">{FX.structCMF}</td><td className="small">FHWA CMF Clearinghouse 5229 · 다발지점 사망 비중 {FX.structShare * 100}%</td></tr>
                <tr><td>대책 겹침 하한</td><td className="r">{FX.cmfFloor}</td><td className="small">HSM 관행</td></tr>
              </tbody>
            </table>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
