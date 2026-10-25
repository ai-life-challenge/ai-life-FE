// S8 레포트: 서버가 계산 결과로 채운 공문 초안. 문단은 마크다운이고 본문 속 [n]은 맨 아래 '출처와 근거'의 n번 각주로 이어진다.
// 문단은 눌러서 고칠 수 있고(원문 그대로), 고친 글은 서버에 다시 보내 그대로 실린다. 인쇄 CSS로 PDF 저장, 링크 복사로 같은 조건을 공유한다.
import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import type { AgeId, Note, Report as ReportT, ReportSection, SectionKey, Service } from '../api/types'
import { AGES, eok, pct } from '../api/meta'
import { useAutoFetch } from '../hooks'
import { useStore } from '../store'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Md } from '../ui/Md'
import { linkNotes } from '../ui/mdText'

const today = new Date().toLocaleDateString('sv-SE')

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

  useEffect(() => { if (st.report.form !== 'official') patch((s) => ({ ...s, report: { ...s.report, form: 'official' } })) }, [st.report.form, patch]) // 주민 안내문은 없앴다: 공문만
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
        <span className="report-plan muted small">{plans.data ? `${plans.data.plans.find((p) => p.k === st.planShow)?.name ?? ''} 기준 · 결과 화면에서 고른 안이에요` : ''}</span>
        <div className="report-actions">
          <button className="ghost" onClick={copyLink}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>링크 복사
          </button>
          <button className="primary" onClick={() => window.print()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>PDF로 저장
          </button>
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
  const fn = rep.tableNotes?.future
  return (
    <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <p className="muted small" style={{ margin: 0 }}>{today} · {regionName} <LevelBadge tier={tier} /> <AiBadge>서버 초안</AiBadge></p>
      <h1>{rep.title}</h1>
      {rep.sections.map((s) => s.key == null
        ? (
          // key가 null인 '출처와 근거' 문단은 고칠 수 없다. 각주 목록(notes)으로 그린다(없으면 서버 글 그대로)
          <section key="notes">
            <h2>{s.title}</h2>
            {rep.notes.length ? <Notes notes={rep.notes} /> : <Md text={s.text} prefix="rep-notes" />}
          </section>
        )
        : <Section key={s.key} s={{ ...s, key: s.key }} onEdit={onEdit} />)}
      <h2>대안 비교</h2>
      <table className="ltable">
        <thead><tr><th>안</th><th className="r">공백 마을</th><th className="r">달성률</th><th className="r">연 비용</th><th className="r">설치</th><th className="r">10년 뒤{fn != null && <sup><a href={`#note-${fn}`}>[{fn}]</a></sup>}</th></tr></thead>
        <tbody>
          {rep.table.map((t) => (
            <tr key={t.k} className={t.chosen ? 'rec' : ''}>
              <td><b>{t.name}</b>{t.recommended ? ' ⭐' : ''}<br /><span className="muted small">{t.summary}</span></td>
              <td className="r">{t.gapVillagesBefore}곳 → {t.gapVillagesAfter}곳<br /><span className="muted small">새로 닿음 {t.reachedVillages}{t.teleOnlyVillages > 0 ? ` · 원격만 ${t.teleOnlyVillages}` : ''}</span></td>
              <td className="r">{pct(t.rate)}</td><td className="r">{eok(t.year)}</td><td className="r">{eok(t.install)}</td><td className="r">{pct(t.future)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">표시된 줄이 이 문서가 기준으로 삼은 안이에요. 숫자는 모두 서버 계산 결과예요.</p>
    </div>
  )
}

// 문단: 마크다운으로 보여 주고, 눌러서 고치면(원문 그대로) 포커스를 잃을 때가 아니라 '저장'을 누를 때 서버에 다시 보낸다
function Section({ s, onEdit }: { s: ReportSection & { key: SectionKey }; onEdit: (k: SectionKey, text: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(s.text)
  const start = () => { setDraft(s.text); setEditing(true) }
  const save = () => { const t = draft.trim(); setEditing(false); if (t && t !== s.text) onEdit(s.key, t) }
  return (
    <section>
      <h2>{s.title}{s.rewritten && <span className="badge">직접 고침</span>}</h2>
      {editing ? (
        <div className="no-print">
          <textarea className="para-edit" value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(18, draft.split('\n').length + 2)} aria-label={`${s.title} 고치기`} autoFocus />
          <div className="row"><button className="primary" onClick={save}>저장</button><button className="ghost" onClick={() => setEditing(false)}>취소</button></div>
        </div>
      ) : (
        // 각주 링크를 누를 때는 고치기로 넘어가지 않게 한다
        <div className="para" role="button" tabIndex={0} title="눌러서 고칠 수 있어요" onClick={(e) => { if (!(e.target as HTMLElement).closest('a')) start() }} onKeyDown={(e) => { if (e.key === 'Enter') start() }}>
          <Md text={linkNotes(s.text)} prefix={`rep-${s.key}`} />
        </div>
      )}
      {s.rewritten && !editing && <button className="link small no-print" onClick={() => onEdit(s.key, null)}>원래 글로 되돌리기</button>}
    </section>
  )
}

const KIND_NAME: Record<Note['kind'], string> = { source: '자료', rule: '기준', calc: '계산', assumption: '가정' }
// 각주 목록: n번이 본문의 [n]과 이어진다. 식 줄은 `label value = 항 + 항` 꼴로 읽는다
function Notes({ notes }: { notes: Note[] }) {
  return (
    <ol className="notes">
      {notes.map((n) => (
        <li key={n.n} id={`note-${n.n}`} value={n.n}>
          <b>{KIND_NAME[n.kind]}</b>{' '}
          {n.kind === 'source'
            ? <>{n.org && `${n.org}, `}「{n.url ? <a href={n.url} target="_blank" rel="noopener noreferrer">{n.title}</a> : n.title}」{n.date && `, ${n.date}`}</>
            : <>{n.title}{n.text && ` — ${n.text}`}</>}
          {!!n.lines?.length && (
            <ul>
              {n.lines.map((l, i) => (
                <li key={i}>
                  {l.text ?? <>{l.label} {l.value}{!!l.terms?.length && <> = {l.terms.map((t, j) => <span key={j}>{j > 0 && ' + '}{t.name && `${t.name} `}<code>{t.expr}</code></span>)}</>}</>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
