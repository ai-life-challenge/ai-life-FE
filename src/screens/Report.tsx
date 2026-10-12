// S8 레포트: 서버가 계산 결과로 채운 공문(또는 주민 안내문) 초안. 문단은 눌러서 고칠 수 있고, 고친 글은 서버에 다시 보내 그대로 실린다.
// 인쇄 CSS로 PDF 저장, 링크 복사로 같은 조건을 공유한다.
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import type { AgeId, Report as ReportT, ReportForm, SectionKey, Service } from '../api/types'
import { AGES, eok, pct } from '../api/meta'
import { useAutoFetch } from '../hooks'
import { useStore } from '../store'
import { AiBadge, LevelBadge } from '../ui/Badges'

const today = new Date().toLocaleDateString('sv-SE')
const FORMS: { id: ReportForm; name: string }[] = [{ id: 'official', name: '공문' }, { id: 'resident', name: '주민 안내문' }]

export function Report() {
  const { code } = useParams()
  const [q] = useSearchParams()
  const { state, regions, plans, report, patch, fetchReport, fetchPlans } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const [toast, setToast] = useState<string | null>(null)

  // 공유 링크(?s=&a=&b=&t=&p=)로 들어오면 그 조건을 먼저 적용한다
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    const s = q.get('s') as Service, a = q.get('a') as AgeId, b = Number(q.get('b')), t = Number(q.get('t')), p = Number(q.get('p'))
    patch((x) => ({
      ...x,
      service: s === 'med' || s === 'bus' ? s : x.service,
      age: AGES.some((g) => g.id === a) ? a : x.age,
      budget: q.get('b') && b >= 0 && b <= 30 ? b : x.budget,
      target: q.get('t') && t >= 0.5 && t <= 1 ? t : x.target,
      planShow: q.get('p') && [0, 1, 2].includes(p) ? p : x.planShow,
    }))
  }, [q, patch])

  useAutoFetch('fetchPlans')
  useAutoFetch('fetchReport', true, 200)

  const rep = report.data
  const toastIt = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }
  const copyLink = async () => {
    const u = new URL(window.location.href)
    u.search = new URLSearchParams({ s: st.service, a: st.age, b: String(st.budget), t: String(st.target), p: String(st.planShow) }).toString()
    try { await navigator.clipboard.writeText(u.toString()); toastIt('링크를 복사했어요') } catch { toastIt('복사하지 못했어요. 주소창의 링크를 써 주세요') }
  }
  const setSection = (key: SectionKey, text: string | null) => patch((s) => ({ ...s, report: { ...s.report, sections: { ...s.report.sections, [key]: text } } }))

  return (
    <motion.div className="report-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="report-bar no-print">
        <div className="row">
          <div className="seg" role="radiogroup" aria-label="문서 형식">
            {FORMS.map((f) => (
              <button key={f.id} role="radio" aria-checked={st.report.form === f.id} className={st.report.form === f.id ? 'on' : ''} onClick={() => patch((s) => ({ ...s, report: { ...s.report, form: f.id } }))}>
                {st.report.form === f.id && <motion.span layoutId="form-bg" className="tab-bg" />}<span style={{ position: 'relative' }}>{f.name}</span>
              </button>
            ))}
          </div>
          {plans.data && (
            <div className="seg" role="radiogroup" aria-label="기준 안">
              {plans.data.plans.map((p) => (
                <button key={p.k} role="radio" aria-checked={st.planShow === p.k} className={st.planShow === p.k ? 'on' : ''} onClick={() => patch((s) => ({ ...s, planShow: p.k }))}>
                  {st.planShow === p.k && <motion.span layoutId="plan-bg" className="tab-bg" />}<span style={{ position: 'relative' }}>{p.name}{p.recommended ? ' ⭐' : ''}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="row">
          <button className="ghost" onClick={copyLink}>링크 복사</button>
          <button className="primary" onClick={() => window.print()}>PDF로 저장</button>
        </div>
      </div>

      <article className="paper">
        {report.status === 'error' && <p className="check bad" role="alert">{report.error} <button className="link" onClick={() => void fetchReport()}>다시 불러오기</button></p>}
        {!rep && report.status !== 'error' && <p className="muted" role="status">레포트를 만드는 중이에요…</p>}
        {rep && <Body rep={rep} regionName={r.name} tier={r.tier} onEdit={setSection} loading={report.status === 'loading'} />}
        {!plans.data && report.data && plans.status === 'error' && <p className="muted small">{plans.error} <button className="link" onClick={() => void fetchPlans()}>다시 불러오기</button></p>}
      </article>
      {toast && <div className="toast" role="status">{toast}</div>}
    </motion.div>
  )
}

function Body({ rep, regionName, tier, onEdit, loading }: { rep: ReportT; regionName: string; tier: 'precise' | 'auto'; onEdit: (k: SectionKey, text: string | null) => void; loading: boolean }) {
  return (
    <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <p className="muted small" style={{ margin: 0 }}>{today} · {regionName} <LevelBadge tier={tier} /> <AiBadge>서버 초안</AiBadge></p>
      <h1>{rep.title}</h1>
      {rep.sections.map((s) => (
        <section key={s.key}>
          <h2>{s.title}{s.rewritten && <span className="badge">직접 고침</span>}</h2>
          <Para key={s.text} text={s.text} onSave={(t) => onEdit(s.key, t)} />
          {s.rewritten && <button className="link small no-print" onClick={() => onEdit(s.key, null)}>원래 글로 되돌리기</button>}
        </section>
      ))}
      <h2>대안 비교</h2>
      <table className="ltable">
        <thead><tr><th>안</th><th className="r">달성률</th><th className="r">연 비용</th><th className="r">설치</th><th className="r">10년 뒤</th></tr></thead>
        <tbody>
          {rep.table.map((t) => (
            <tr key={t.k} className={t.chosen ? 'rec' : ''}>
              <td><b>{t.name}</b>{t.recommended ? ' ⭐' : ''}<br /><span className="muted small">{t.summary}</span></td>
              <td className="r">{pct(t.rate)}</td><td className="r">{eok(t.year)}</td><td className="r">{eok(t.install)}</td><td className="r">{pct(t.future)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">표시된 줄이 이 문서가 기준으로 삼은 안이에요. 숫자는 모두 서버 계산 결과예요.</p>
    </div>
  )
}

// 문단: 누르면 고칠 수 있고, 포커스를 잃을 때 글이 바뀌었으면 서버에 다시 보낸다
function Para({ text, onSave }: { text: string; onSave: (t: string) => void }) {
  return (
    <p className="para" contentEditable suppressContentEditableWarning spellCheck={false} role="textbox" aria-label="문단 (눌러서 고칠 수 있어요)"
      onBlur={(e) => { const t = e.currentTarget.innerText.trim(); if (t && t !== text) onSave(t) }}>
      {text}
    </p>
  )
}
