// 검토 메모: 결재용 보고서 초안. 문장은 AI 초안(시제품은 틀에 계산값을 채운 것), 표와 숫자는 계산 결과에서 그대로 온다.
// 문단은 눌러서 바로 고치고, 고친 문단의 숫자가 계산 결과와 맞는지 검사한다.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { motion, useReducedMotion } from 'motion/react'
import { useStore, usePlans, type MemoState } from '../store'
import { AGES, COUNTIES, diagnose, service, type Model } from '../api/mock'
import { recommendReason, summarize, type Goal, type Plan } from '../api/plans'
import { SUPPLY_COLOR_CSS } from '../map/colors'
import { tween } from '../motion/tween'
import { fmt, pct } from '../motion/useCountUp'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Stepper } from '../ui/Stepper'

const eok = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)}억`
const today = new Date().toLocaleDateString('sv-SE') // 로컬 날짜 YYYY-MM-DD

interface Section { id: 'status' | 'rec' | 'limits'; title: string; text: string }

function buildMemo(m: Model, g: Goal, plans: Plan[], memo: MemoState, tele: number) {
  const age = AGES.find((a) => a.id === g.age)!.name
  const svc = service(g.service).name
  const d = diagnose(m, g.service, g.mode, g.age, g.T)
  const rec = plans.find((p) => p.id === memo.recPlan) ?? plans.find((p) => p.recommended)!
  const pctT = Math.round(g.target * 100)
  const top = d.topVillages.slice(0, 3).map((v) => m.villages[v.village].name).join(', ')
  const title = `${m.county.name} ${age} ${svc} 접근성 개선 검토`
  const summary = `${rec.name}으로 연 ${eok(rec.year)}을 들여 ${age}의 ${svc} ${g.T}분 접근 달성률을 ${pct(rec.base)}에서 ${pct(rec.rate)}로 올린다.`
  const status = `${m.county.name} ${age} ${fmt(d.total)}명 가운데 ${fmt(d.gap)}명(${pct(d.rate)})이 ${g.mode === 'bus' ? '버스로' : '자가용으로'} ${g.T}분 안에 ${svc}에 닿지 못한다. 군 평균 이동시간은 ${Math.round(d.avgMinutes)}분이라 평균만 보면 문제가 드러나지 않지만, 500m 격자로 보면 ${top} 등에 공백이 몰려 있다.`
  const recText = memo.shortRec
    ? `${rec.name}을 권고한다. 연 ${eok(rec.year)}으로 달성률 ${pct(rec.rate)}(목표 ${pctT}%). 10년 뒤 ${pct(rec.future)}.`
    : `${rec.name}을 권고한다. ${summarize(rec, g.service)}을 두면 ${age} 달성률이 ${pct(rec.base)}에서 ${pct(rec.rate)}로 올라 목표 ${pctT}%를 ${rec.meets ? '넘긴다' : '넘기지 못한다'}. 연 비용은 ${eok(rec.year)}(설치비 ${eok(rec.cap)} 별도)이고, 10년 뒤 달성률은 ${pct(rec.future)}로 예상한다. ${memo.recPlan ? '' : recommendReason(plans, g, true)}`
  const limits = [
    `기준 시간 ${g.T}분은 공식 목표치가 확인되지 않아 가정값으로 썼다.`,
    `공급 수단 단가와 원격 효과계수(${tele})는 가정값이며, 효과계수 0.3과 단가 20% 인상으로 민감도를 확인했다.`,
    '대안 계산은 시제품용 간단 방식(비용 대비 효과 순)이며 실서비스는 최대커버링 모델로 푼다.',
    '시제품의 인구·시설·버스는 가상 데이터다.',
    ...memo.extraLimits,
  ].map((x) => `· ${x}`).join('\n')
  const sections: Section[] = [
    { id: 'status', title: '1. 현황', text: status },
    { id: 'rec', title: '3. 권고', text: recText },
    { id: 'limits', title: '4. 가정과 한계', text: limits },
  ]
  // 숫자 대조 기준: 계산 결과로 만든 문장과 표에 들어간 숫자
  const tableNums = plans.flatMap((p) => [pct(p.rate), eok(p.year), eok(p.cap), pct(p.future), pct(p.base)])
  const allowed = new Set(nums([title, summary, status, recText, limits, ...tableNums, String(pctT), String(g.T), String(tele)].join(' ')))
  return { title, summary, sections, rec, d, allowed }
}
const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((x) => x.replace(/,/g, ''))

export function Memo() {
  const { sgg: param } = useParams()
  const nav = useNavigate()
  const s = useStore()
  const p = usePlans()
  useEffect(() => {
    if (!param || !COUNTIES.some((c) => c.sgg === param)) { nav('/start'); return }
    if (useStore.getState().model?.county.sgg !== param) useStore.getState().loadCounty(param)
  }, [param, nav])
  const ready = p && p.model.county.sgg === param
  const memo = ready ? buildMemo(p.model, p.goal, p.plans, s.memo, s.assume.tele) : null // 가벼운 계산이라 매번 만든다
  if (!ready || !memo) return <div className="memo-wrap"><p className="muted">메모를 만드는 중…</p></div>

  const { model: m, goal: g, plans } = p
  const sectionText = (x: Section) => s.memo.overrides[x.id] ?? x.text
  const unknown = memo.sections.flatMap((x) => nums(sectionText(x)).filter((n) => !memo.allowed.has(n)).map((n) => ({ id: x.id, n })))
  const save = (id: Section['id'], text: string) => {
    const st = useStore.getState()
    const overrides = { ...st.memo.overrides }
    if (text === memo.sections.find((x) => x.id === id)!.text) delete overrides[id]
    else overrides[id] = text
    st.set({ memo: { ...st.memo, overrides } })
  }

  return (
    <motion.div className="memo-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="memo-toolbar">
        <Stepper sgg={m.county.sgg} at={2} />
        <div className="row">
          <motion.span key={unknown.length} className={`check ${unknown.length ? 'bad' : 'ok'}`} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            {unknown.length ? `⚠ 계산 결과에 없는 숫자 ${unknown.length}개: ${unknown.map((u) => u.n).join(', ')}` : '✓ 숫자 대조 검사 통과 — 모든 숫자가 계산 결과와 같아요'}
          </motion.span>
          <button className="ghost" onClick={() => window.print()}>PDF로 저장</button>
        </div>
      </div>

      <motion.article className="paper" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 26 }}>
        <header className="paper-head">
          <p className="muted small">검토 메모 · {today} · <span contentEditable suppressContentEditableWarning>○○과 담당자</span> <AiBadge>AI 초안</AiBadge> <LevelBadge level={m.county.level} /></p>
          <h1>{memo.title}</h1>
          {s.memo.summaryLine && <motion.p className="summary-line" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}><b>결재 요약</b> {memo.summary}</motion.p>}
        </header>

        <Para section={memo.sections[0]} text={sectionText(memo.sections[0])} version={s.memo.version} onSave={save} delay={0.2} edited={memo.sections[0].id in s.memo.overrides} />
        <Figure m={m} g={g} plan={null} caption={`그림 1. ${service(g.service).name}까지 ${g.T}분 넘게 걸리는 칸 (빨강)`} />

        <h2>2. 대안 비교</h2>
        <table className="memo-table">
          <thead><tr><th>안</th><th>구성</th><th>달성률</th><th>연 비용</th><th>설치비</th><th>10년 뒤</th><th>판정</th></tr></thead>
          <tbody>
            {plans.map((pl, k) => (
              <motion.tr key={pl.id} className={pl.id === memo.rec.id ? 'rec' : ''} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + k * 0.12 }}>
                <td><b>{pl.id}</b> {pl.name}</td>
                <td className="small">{summarize(pl, g.service)}</td>
                <td className={pl.meets ? '' : 'bad'}>{pct(pl.rate)}</td>
                <td className={pl.withinBudget ? '' : 'bad'}>{eok(pl.year)}</td>
                <td>{eok(pl.cap)}</td>
                <td>{pct(pl.future)}</td>
                <td>{pl.id === memo.rec.id ? '권고' : !pl.meets ? '목표 미달' : !pl.withinBudget ? '예산 초과' : !pl.robust ? '민감도 약함' : '가능'}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>

        <Para section={memo.sections[1]} text={sectionText(memo.sections[1])} version={s.memo.version} onSave={save} delay={0.8} edited={memo.sections[1].id in s.memo.overrides} />
        <Figure m={m} g={g} plan={memo.rec} caption={`그림 2. ${memo.rec.name}을 시행하면 새로 닿는 칸 (파랑)과 공급 위치`} />
        <Para section={memo.sections[2]} text={sectionText(memo.sections[2])} version={s.memo.version} onSave={save} delay={1.2} edited={memo.sections[2].id in s.memo.overrides} />

        <h2>5. 데이터 출처</h2>
        <ul className="small sources">
          <li>행정 경계: 통계청 SGIS 기반 vuski/admdongkor ver20260701 (CC BY 4.0)</li>
          <li>바탕 지도: OpenFreeMap, © OpenStreetMap 기여자</li>
          <li>인구·시설·버스·단가: 시제품 가상 데이터 (실서비스는 SGIS 격자, 주민등록 인구, 심평원, 군 버스 시각표)</li>
        </ul>
        <p className="muted small">문장은 AI가 쓴 초안이고, 표와 숫자는 계산 결과에서 그대로 가져왔어요. 문단을 눌러 고칠 수 있어요.</p>
      </motion.article>
    </motion.div>
  )
}

// 문단: 처음엔 타이핑되듯 나타나고, 다 나오면 눌러서 고칠 수 있다
function Para({ section, text, version, onSave, delay, edited }: { section: Section; text: string; version: number; onSave: (id: Section['id'], t: string) => void; delay: number; edited: boolean }) {
  const reduce = useReducedMotion()
  const [n, setN] = useState(edited || reduce ? text.length : 0)
  const typedKey = useRef('')
  useEffect(() => {
    const key = `${version}:${section.text}`
    if (edited || reduce || typedKey.current === key) { setN(text.length); return }
    typedKey.current = key
    setN(0)
    let stop = () => {}
    const t = setTimeout(() => { stop = tween(0, text.length, Math.min(2200, text.length * 14), (v) => setN(Math.round(v)), { ease: (x) => x }) }, delay * 1000)
    return () => { clearTimeout(t); stop() }
    // 섹션 원문이나 AI 수정 버전이 바뀌면 다시 타이핑한다
  }, [version, section.text, edited, reduce])
  const typing = n < text.length
  return (
    <section className="memo-sec">
      <h2>{section.title} {edited && <span className="badge assume">직접 고침</span>}</h2>
      <p
        className={`memo-text ${typing ? 'typing' : ''}`}
        contentEditable={!typing}
        suppressContentEditableWarning
        onBlur={(e) => onSave(section.id, e.currentTarget.innerText.trim())}
      >
        {text.slice(0, n)}
        {typing && <span className="caret" />}
      </p>
    </section>
  )
}

// 보고서용 작은 지도 (SVG). 격자 칸을 공백/새로 닿음/이미 닿음으로 칠한다
function Figure({ m, g, plan, caption }: { m: Model; g: Goal; plan: Plan | null; caption: string }) {
  const { W, H, colors } = useMemo(() => {
    const t = m.times[g.service][g.mode].t
    const cov = plan?.cov
    const colors = m.cells.map((c, i) => {
      if (c.pop === 0) return '#ece9e2'
      if (t[i] <= g.T) return '#a9d3b4' // 이미 닿음
      if (cov && cov[i] > 0) return cov[i] >= 1 ? '#2f5bd3' : '#8aa6ea' // 이 안으로 새로 닿음 (일부만 닿으면 옅게)
      return '#d73027' // 공백
    })
    return { W: Math.max(...m.cells.map((c) => c.cx)) + 0.5, H: Math.max(...m.cells.map((c) => c.cy)) + 0.5, colors }
  }, [m, g, plan])
  return (
    <figure className="memo-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={caption}>
        {m.cells.map((c, i) => <rect key={i} x={c.cx - 0.25} y={c.cy - 0.25} width={0.5} height={0.5} fill={colors[i]} />)}
        {plan?.picks.map((pk, k) => (pk.type === 'tour' && pk.stops ? pk.stops : [pk.village]).map((vi) => (
          <circle key={`${k}-${vi}`} cx={m.villages[vi].x} cy={m.villages[vi].y} r={0.7} fill={SUPPLY_COLOR_CSS[pk.type]} stroke="#fff" strokeWidth={0.25} />
        )))}
      </svg>
      <figcaption className="muted small">{caption}</figcaption>
    </figure>
  )
}
