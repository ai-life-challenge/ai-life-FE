// S8 레포트: 서버가 계산 결과로 채운 공문 초안. 문단은 마크다운이고 본문 속 [n]은 맨 아래 '출처와 근거'의 n번 각주로 이어진다.
// 문단은 문서 안에서 바로 눌러 고친다(서식 있는 글 → 마크다운). 입력을 멈추거나 문단을 떠나면 자동 저장하고(서버가 받아 준 글만 '저장됨'),
// 고친 글은 지역마다 이 브라우저에도 남겨 새로고침해도 이어진다. 인쇄 CSS로 PDF 저장, 링크 복사로 같은 조건을 공유한다.
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useParams, useSearchParams } from 'react-router'
import { motion } from 'motion/react'
import type { Note, Report as ReportT, ReportSection, SectionKey, State } from '../api/types'
import { eok, pct } from '../api/meta'
import { api } from '../api/client'
import { readShare, shareQuery } from '../api/share'
import { useAutoFetch } from '../hooks'
import { calcKey, reportKey, useStore, type Load } from '../store'
import { AiBadge, LevelBadge } from '../ui/Badges'
import { Basis } from '../ui/Basis'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { Md } from '../ui/Md'
import { Seg } from '../ui/Seg'
import { linkNotes } from '../ui/mdText'
import type { Autosave, SaveStatus } from './report/autosave'
import { restoreReport, saverFor } from './report/reportSaver'

const today = new Date().toLocaleDateString('sv-SE')
// 편집기(TipTap)는 레포트 화면에서만 쓰므로 따로 받는다. 받는 동안은 같은 모양의 읽기 전용 글을 보여 준다
const RichText = lazy(() => import('../ui/RichText').then((m) => ({ default: m.RichText })))

export function Report() {
  const { code } = useParams()
  const [q] = useSearchParams()
  const { state, regions, plans, report, patch, fetchReport, fetchPlans } = useStore()
  const st = state!
  const r = regions.find((x) => x.code === code)!
  const [toast, setToast] = useState<string | null>(null)
  const saver = saverFor(code!)
  const status = useSyncExternalStore(saver.subscribe, saver.status)
  useEffect(() => { restoreReport(code!) }, [code])

  // 서버에 아직 없는 글이 있으면: 탭을 가리거나 다시 연결되면 바로 보내고, 페이지를 떠나려 하면 한 번 묻는다(글은 이 브라우저에도 남아 있다)
  useEffect(() => {
    const flushIfHidden = () => { if (document.visibilityState === 'hidden') saver.flush() }
    const onOnline = () => saver.flush()
    const onLeave = (e: BeforeUnloadEvent) => { if (saver.hasUnsaved()) { saver.flush(); e.preventDefault(); e.returnValue = '' } }
    document.addEventListener('visibilitychange', flushIfHidden)
    window.addEventListener('online', onOnline)
    window.addEventListener('beforeunload', onLeave)
    return () => {
      document.removeEventListener('visibilitychange', flushIfHidden)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('beforeunload', onLeave)
      saver.flush() // 다른 화면으로 가도 남은 글을 보낸다
    }
  }, [saver])

  // 공유 링크로 들어오면 그 조건(기준 · 공급수단 · 단가 · 예산 · 목표 · 안)을 먼저 적용한다. 서버 계산은 바뀐 조건으로 다시 부른다(useAutoFetch)
  const applied = useRef(false)
  useEffect(() => {
    if (applied.current) return
    applied.current = true
    patch((x) => readShare(q, x))
  }, [q, patch])

  useEffect(() => { if (st.report.form !== 'official') patch((s) => ({ ...s, report: { ...s.report, form: 'official' } })) }, [st.report.form, patch]) // 주민 안내문은 없앴다: 공문만
  useAutoFetch('fetchPlans')
  useAutoFetch('fetchReport', true, 200)

  const rep = report.data
  const originals = useOriginals(code!, st, report)
  const toastIt = (m: string) => { setToast(m); setTimeout(() => setToast(null), 1800) }
  // 기준 안 고르기: 위 선택 막대와 아래 대안 비교 표가 같은 값(state.planShow)을 쓴다. 같은 안을 다시 고르면 그대로 둔다
  const pickPlan = (k: number) => patch((s) => (s.planShow === k ? s : { ...s, planShow: k }))
  const copyLink = async () => {
    const u = new URL(window.location.href)
    u.search = shareQuery(st, u.searchParams).toString()
    const edited = saver.hasUnsaved() || Object.values(st.report.sections).some((t) => t != null) // 고쳐 쓴 문단(저장 전 글 포함)은 링크에 담지 않는다
    try { await navigator.clipboard.writeText(u.toString()); toastIt(edited ? '링크를 복사했어요 · 직접 고친 문단은 링크에 담기지 않아요' : '링크를 복사했어요') } catch { toastIt('복사하지 못했어요. 주소창의 링크를 써 주세요') }
  }

  return (
    <motion.div className="report-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="report-bar no-print">
        {plans.data ? (
          <Seg id="plan" label="기준 안" options={plans.data.plans.map((p) => ({ id: p.k, name: p.name, badge: p.recommended ? '추천' : undefined }))} value={st.planShow} onChange={pickPlan} fade />
        ) : <span />}
        <div className="report-actions">
          <SaveState status={status} onRetry={() => saver.flush()} />
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
        {rep && <Body rep={rep} regionName={r.name} tier={r.tier} saver={saver} loading={report.status === 'loading'} plan={st.planShow} onPickPlan={pickPlan} originals={originals} />}
        {!plans.data && report.data && plans.status === 'error' && <p className="muted small">{plans.error} <button className="link" onClick={() => void fetchPlans()}>다시 불러오기</button></p>}
      </article>
      {toast && <div className="toast" role="status">{toast}</div>}
    </motion.div>
  )
}

function Body({ rep, regionName, tier, saver, loading, plan, onPickPlan, originals }: { rep: ReportT; regionName: string; tier: 'precise' | 'auto'; saver: Autosave; loading: boolean; plan: number; onPickPlan: (k: number) => void; originals: Originals }) {
  const fn = rep.tableNotes?.future
  return (
    <div aria-busy={loading} style={{ opacity: loading ? 0.6 : 1, transition: 'opacity .2s' }}>
      <p className="muted small" style={{ margin: 0 }}>{today} · {regionName} <LevelBadge tier={tier} /> <AiBadge>서버 초안</AiBadge></p>
      <h1>{rep.title}</h1>
      <Basis />
      {rep.sections.map((s) => s.key == null
        ? (
          // key가 null인 '출처와 근거' 문단은 고칠 수 없다. 각주 목록(notes)으로 그린다(없으면 서버 글 그대로)
          <section key="notes">
            <h2>{s.title}</h2>
            {rep.notes.length ? <Notes notes={rep.notes} /> : <Md text={s.text} prefix="rep-notes" />}
          </section>
        )
        : <Section key={s.key} s={{ ...s, key: s.key }} saver={saver} original={originals[s.key]} />)}
      <h2>대안 비교</h2>
      <table className="ltable">
        <thead><tr><th>안</th><th className="r">공백 마을</th><th className="r">달성률</th><th className="r">연 비용</th><th className="r">설치</th><th className="r">10년 뒤{fn != null && <sup><a href={`#note-${fn}`}>[{fn}]</a></sup>}</th></tr></thead>
        <tbody>
          {rep.table.map((t) => (
            // 줄 전체를 눌러 이 안을 기준으로 고른다. 키보드는 안 이름 단추(Tab · Enter · Space)로 고른다. 강조는 지금 고른 안, ⭐은 추천 안
            <tr key={t.k} className={`pick${t.k === plan ? ' rec' : ''}`} onClick={() => onPickPlan(t.k)}>
              <td><button type="button" className="row-pick" aria-pressed={t.k === plan} title="이 안을 기준으로 보기"><b>{t.name}</b></button>{t.recommended ? ' ⭐' : ''}<br /><span className="muted small">{t.summary}</span></td>
              <td className="r">{t.gapVillagesBefore}곳 → {t.gapVillagesAfter}곳<br /><span className="muted small">새로 닿음 {t.reachedVillages}{t.teleOnlyVillages > 0 ? ` · 원격만 ${t.teleOnlyVillages}` : ''}</span></td>
              <td className="r">{pct(t.rate)}</td><td className="r">{eok(t.year)}</td><td className="r">{eok(t.install)}</td><td className="r">{t.future != null ? pct(t.future) : <span className="muted" title="10년 뒤 값은 80세 이상 기준에서만 계산해요">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">표시된 줄이 이 문서가 기준으로 삼은 안이에요. 숫자는 모두 서버 계산 결과예요.</p>
    </div>
  )
}

// 문단: 문서 그대로 보이다가 누르면 그 자리에서 고친다. 서버가 받기 전의 글(입력 중 · 저장 실패 · 되살린 글)이 있으면 그 글을 보여 준다.
// '직접 고침'은 서버가 고친 글을 갖고 있을 때다. 고친 글이 원래 글(AI 초안)과 같아지면 고친 글 대신 null(초안으로)을 보내 표시가 사라진다
function Section({ s, saver, original }: { s: ReportSection & { key: SectionKey }; saver: Autosave; original?: string }) {
  const pending = useSyncExternalStore(saver.subscribe, () => (saver.isDirty(s.key) ? saver.valueOf(s.key) : undefined))
  const text = typeof pending === 'string' ? pending : pending === null && original != null ? original : s.text
  // 되돌리기: 확인 창에서 '되돌리기'를 눌렀을 때만 보낸다. 서버가 받기 전에는 창을 닫지 않고, 실패하면 고친 글을 그대로 둔다
  const [confirm, setConfirm] = useState<{ busy: boolean; error: string | null } | null>(null)
  const headRef = useRef<HTMLHeadingElement>(null)
  const revert = async () => {
    if (confirm?.busy) return
    setConfirm({ busy: true, error: null })
    try {
      await saver.revert(s.key)
      setConfirm(null)
    } catch (e) {
      setConfirm({ busy: false, error: `되돌리지 못했어요. 고친 글은 그대로 있어요. (${(e as Error).message})` })
    }
  }
  return (
    <section>
      <h2 ref={headRef} tabIndex={-1}>
        {s.title}
        {s.rewritten && <span className="badge">직접 고침</span>}
        {s.rewritten && <button className="link small no-print revert" onClick={() => setConfirm({ busy: false, error: null })}>원래 글로 되돌리기</button>}
      </h2>
      <Suspense fallback={<div className="rt"><div className="rt-doc"><Md text={linkNotes(text)} prefix={`rep-${s.key}`} /></div></div>}>
        <RichText
          value={text}
          original={original}
          label={`${s.title} 본문`}
          anchor={() => headRef.current}
          onChange={(md) => saver.edit(s.key, md)}
          onLeave={() => saver.flush()}
          onSync={(md) => saver.base(s.key, s.rewritten ? md : null)}
        />
      </Suspense>
      <ConfirmDialog
        open={!!confirm}
        title="초안으로 되돌릴까요?"
        confirmLabel="되돌리기"
        busyLabel="되돌리는 중…"
        busy={!!confirm?.busy}
        error={confirm?.error ?? null}
        onConfirm={() => void revert()}
        onClose={() => setConfirm(null)}
        fallbackFocus={() => headRef.current}
      >
        지금까지 수정한 내용은 사라지고, AI가 생성한 초안으로 돌아갑니다.
      </ConfirmDialog>
    </section>
  )
}

// 저장 버튼 대신 작은 상태 글. 저장할 때마다 알림을 띄우지 않는다
function SaveState({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  return (
    <span className={`save-state ${status.kind}`} role="status" aria-live="polite">
      {status.kind === 'pending' || status.kind === 'saving' ? '저장 중…'
        : status.kind === 'saved' ? '저장됨'
          : status.kind === 'error' ? <><span title={status.message}>저장 실패</span> · <button className="link" onClick={onRetry}>다시 시도</button></>
            : status.kind === 'invalid' ? <span title={status.message}>{status.key} · {status.message}</span>
              : null}
    </span>
  )
}

// 문단별 원래 글(AI 초안). 고친 글이 없는 문단은 서버가 초안을 그대로 주고, 고친 문단의 초안은 모르므로
// 지금 조건(계산 조건 · 기준 안)에서 고친 글을 뺀 레포트를 한 번 더 받아 온다. 조건마다 따로 두어 늦게 온 응답이 다른 조건의 초안이 되지 않는다
type Originals = Partial<Record<SectionKey, string>>
function useOriginals(code: string, st: State, report: Load<ReportT>): Originals {
  const [fetched, setFetched] = useState<Record<string, Originals>>({})
  const asked = useRef(new Set<string>())
  const cond = JSON.stringify([calcKey(code, st), st.planShow, st.report.form])
  const fresh = report.status === 'ok' && !!report.data && report.key === reportKey(code, st) // 지금 조건의 레포트일 때만 초안으로 쓴다
  const fromReport: Originals = fresh ? Object.fromEntries(report.data!.sections.filter((s) => s.key && !s.rewritten).map((s) => [s.key, s.text])) : {}
  const missing = fresh && report.data!.sections.some((s) => s.key && s.rewritten && fetched[cond]?.[s.key] == null)
  useEffect(() => {
    if (!missing || asked.current.has(cond)) return
    asked.current.add(cond)
    api.report({ region: code, state: { ...st, report: { ...st.report, sections: {} } } }).then(
      (r) => setFetched((f) => ({ ...f, [cond]: Object.fromEntries(r.sections.filter((s) => s.key).map((s) => [s.key, s.text])) })),
      () => { asked.current.delete(cond) }, // 못 받으면 비교하지 않는다(고친 글은 그대로 저장된다). 다음에 다시 묻는다
    )
  }, [missing, cond]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...fetched[cond], ...fromReport }
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
