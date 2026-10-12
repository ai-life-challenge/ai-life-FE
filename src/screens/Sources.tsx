// S7 가정과 출처 (보조 화면, 사이드 시트). 어느 화면에서든 출처 배지를 누르면 해당 행으로 스크롤되고 하이라이트된다.
// 단가·효과 가정을 고치면 서버 계산이 모두 다시 돈다. 값의 범위는 서버가 정한다(범위를 벗어나면 400).
import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { SUPPLY, SUPPLY_IDS } from '../api/meta'
import { FIRST_BUS_LIMIT } from '../api/judge'
import type { Cost, SupplyId } from '../api/types'
import { useStore } from '../store'

const FIELDS: { key: keyof Cost; label: string; min: number; max: number; step: number }[] = [
  { key: 'install', label: '설치(억)', min: 0, max: 100, step: 0.1 },
  { key: 'yearly', label: '연 운영(억)', min: 0, max: 50, step: 0.1 },
  { key: 'years', label: '수명(년)', min: 1, max: 50, step: 1 },
]

export function Sources() {
  const { sources, state, defaults, data, patch, set } = useStore()
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
  }, [sources.open, sources.focus, sources.at]) // eslint-disable-line react-hooks/exhaustive-deps

  const a = state?.assumptions
  const edited = !!a && !!defaults && JSON.stringify(a) !== JSON.stringify(defaults.assumptions)
  // 범위를 벗어난 값은 서버가 거절하므로 입력 단계에서 막는다
  const setCost = (id: SupplyId, key: keyof Cost, v: number, min: number, max: number) => {
    if (!Number.isFinite(v) || v < min || v > max) return
    patch((s) => ({ ...s, assumptions: { ...s.assumptions, costs: { ...s.assumptions.costs, [id]: { ...s.assumptions.costs[id], [key]: key === 'years' ? Math.round(v) : v } } } }))
  }

  return (
    <AnimatePresence>
      {sources.open && (
        <>
          <motion.div className="scrim" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label="가정과 출처" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 34 }}>
            <button className="close" onClick={close} aria-label="닫기">×</button>
            <h2>이 시뮬레이션이 사용한 데이터와 가정</h2>
            <p className="muted small">데이터와 가정을 나눠서 공개해요. 계산은 모두 서버가 해요.</p>

            <h3><span className="badge public">공공데이터</span> {data ? `${data.name} 자료` : '지역 자료'}</h3>
            <table className="stable" data-src="public">
              <tbody>
                {data ? data.sources.map((s) => <tr key={s}><td>{s}</td></tr>) : <tr><td className="muted">지역을 고르면 그 지역의 출처가 보여요</td></tr>}
              </tbody>
            </table>
            {data && <p className="muted small">{data.tier === 'precise' ? '정밀 지역: 버스 하루 운행 횟수와 읍내행 첫차까지 반영해요.' : '간이 판정 지역: 버스 운행 정보가 없어 정류장까지 걷는 거리만 반영해요.'}</p>}

            <h3><span className="badge assume">가정값</span> 공급수단 단가 {edited && defaults && <button className="link small" onClick={() => patch((s) => ({ ...s, assumptions: defaults.assumptions }))}>기본값으로</button>}</h3>
            {a ? (
              <>
                <p className="muted small" style={{ margin: '0 0 6px' }}>숫자를 고치면 결과가 바로 다시 계산돼요.</p>
                <table className="stable" data-src="costs">
                  <thead><tr><th>공급수단</th>{FIELDS.map((f) => <th key={f.key} className="r">{f.label}</th>)}</tr></thead>
                  <tbody>
                    {SUPPLY_IDS.map((id) => (
                      <tr key={id} data-src={`cost-${id}`}>
                        <td><span className="sw" style={{ background: SUPPLY[id].color }} />{SUPPLY[id].name}</td>
                        {FIELDS.map((f) => (
                          <td key={f.key} className="r">
                            <input type="number" step={f.step} min={f.min} max={f.max} defaultValue={a.costs[id][f.key]} key={`${id}-${f.key}-${a.costs[id][f.key]}`}
                              onChange={(e) => setCost(id, f.key, e.currentTarget.valueAsNumber, f.min, f.max)} aria-label={`${SUPPLY[id].name} ${f.label}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                <h3><span className="badge assume">효과 가정</span></h3>
                <table className="stable" data-src="effects">
                  <tbody>
                    <tr>
                      <td>원격진료가 병원 방문을 줄이는 정도</td>
                      <td className="r"><input type="number" step="0.05" min="0" max="1" defaultValue={a.teleEffect} key={a.teleEffect} aria-label="원격진료 효과"
                        onChange={(e) => { const v = e.currentTarget.valueAsNumber; if (v >= 0 && v <= 1) patch((s) => ({ ...s, assumptions: { ...s.assumptions, teleEffect: v } })) }} /></td>
                    </tr>
                    <tr>
                      <td>순회 진료 버스 주당 운행 횟수</td>
                      <td className="r"><input type="number" step="1" min="1" max="7" defaultValue={a.tourWeekly} key={a.tourWeekly} aria-label="순회 진료 주당 횟수"
                        onChange={(e) => { const v = Math.round(e.currentTarget.valueAsNumber); if (v >= 1 && v <= 7) patch((s) => ({ ...s, assumptions: { ...s.assumptions, tourWeekly: v } })) }} /></td>
                    </tr>
                  </tbody>
                </table>
              </>
            ) : <p className="muted">지역을 고르면 단가를 고칠 수 있어요.</p>}

            <h3><span className="badge assume">판정 기준</span></h3>
            <table className="stable" data-src="std">
              <tbody>
                <tr><td>버스 정류장 탐색 범위</td><td className="r">2km</td><td className="small">2km 안에 정류장이 없으면 걸음 60분으로 보고 ‘정류장 없음’</td></tr>
                <tr><td>읍내행 첫차 (정밀 지역)</td><td className="r">{FIRST_BUS_LIMIT / 60}시 전</td><td className="small">서버 판정 결과에서 알아낸 값. 서버 판정과 다르면 서버 결과로 보여 줘요</td></tr>
                <tr><td>마을 안에 병의원이 있는 마을</td><td className="r">갈 수 있음</td><td className="small">가까운 병의원 시간과 상관없이 갈 수 있음으로 봐요</td></tr>
              </tbody>
            </table>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
