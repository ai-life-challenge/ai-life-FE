// 문서 안에서 바로 고치는 글 상자(Notion처럼). 평소에는 완성된 글처럼 보이고, 누르면 그 자리에 커서가 놓여 바로 고친다.
// 문단을 누르면 문단 오른쪽 위에 작은 서식 도구가, 글자를 고르면 고른 글자 위에 서식 도구가 뜬다(둘이 함께 뜨지 않는다).
// 마크다운 단축 입력(# · ## · - · 1. · >)과 실행 취소(⌘Z · ⌘⇧Z)도 된다.
// value는 지금 보여 줄 글(마크다운)이다. 고치는 중(포커스)에는 바깥 값이 바뀌어도 덮지 않아 커서·한글 조합이 끊기지 않는다.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor, type UseEditorOptions } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { PluginKey } from '@tiptap/pm/state'
import { LuBold, LuCheck, LuExternalLink, LuHeading1, LuHeading2, LuHeading3, LuItalic, LuLink, LuList, LuListOrdered, LuStrikethrough, LuTextQuote, LuUnlink } from 'react-icons/lu'
import { normalizeMarkdown, richTextExtensions, safeHref, toMarkdown } from './richTextSchema'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = isMac ? '⌘' : 'Ctrl+'

// 본문 속 각주 번호를 누르면 '출처와 근거'의 그 각주로 간다
function goToNote(href: string) {
  const el = document.getElementById(href.slice(1))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  history.replaceState(null, '', href)
}

export function RichText({ value, original, label, anchor, onChange, onLeave, onSync }: {
  value: string
  original?: string // 원래 글(AI 초안). 고친 글이 이것과 같아지면 onChange에 null을 준다. 모르면 비교하지 않는다
  label: string
  anchor?: () => HTMLElement | null // 문단 도구를 띄울 기준(예: 문단 제목). 없으면 글 상자 위
  onChange: (md: string | null) => void // 글이 바뀔 때마다(입력 중에도). 원래 글과 같아졌으면 null
  onLeave: () => void // 글 상자를 떠날 때: 남은 글을 바로 저장한다
  onSync: (md: string) => void // 바깥 값으로 글을 다시 채웠을 때 그 글(편집기 기준 마크다운)
}) {
  const originalMd = useMemo(() => (original == null ? null : normalizeMarkdown(original)), [original])
  const cb = useRef({ onChange, onLeave, onSync, anchor, originalMd })
  useLayoutEffect(() => { cb.current = { onChange, onLeave, onSync, anchor, originalMd } })
  const applied = useRef({ value, md: '' }) // 마지막으로 바깥 값에서 채운 글. 같은 값으로 다시 채우지 않아 실행 취소 기록을 지킨다
  const [linkOpen, setLinkOpen] = useState(false)
  const [quiet, setQuiet] = useState(false) // 글을 치는 동안 문단 서식 도구를 옅게 둔다. 마우스를 움직이면 다시 또렷해진다

  // 옵션은 처음 한 번만 만든다. 다시 그릴 때마다 새 객체를 주면 편집기가 옵션을 다시 적용해(자동 저장 때마다) 입력 중인 글에 손을 댄다
  const [options] = useState((): UseEditorOptions => ({
    extensions: richTextExtensions(),
    content: value,
    contentType: 'markdown',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'md rt-doc', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: 'false' },
      handleKeyDown: (view, e) => {
        if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'Process'].includes(e.key))) setQuiet(true)
        if (e.isComposing) return false
        if (e.key === 'Escape') { view.dom.blur(); return true } // 고친 글은 그대로 두고 글 상자에서 나온다
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !view.state.selection.empty) { setLinkOpen(true); return true }
        return false
      },
      handleDOMEvents: {
        click: (_view, e) => {
          const a = (e.target as HTMLElement).closest('a')
          const href = a?.getAttribute('href') ?? ''
          if (href.startsWith('#note-')) { e.preventDefault(); goToNote(href); return true }
          if (a && (e.metaKey || e.ctrlKey)) { e.preventDefault(); const u = safeHref(href); if (u) window.open(u, '_blank', 'noopener,noreferrer'); return true }
          return false
        },
      },
    },
    onCreate: ({ editor }) => { applied.current = { value, md: toMarkdown(editor) }; cb.current.onSync(applied.current.md) },
    onUpdate: ({ editor }) => { const md = toMarkdown(editor); cb.current.onChange(md === cb.current.originalMd ? null : md) },
    onBlur: ({ editor, event }) => {
      cb.current.onLeave()
      // 서식 도구(링크 입력 등)로 옮겨 간 것이면 아직 고치는 중이다
      if (!(event.relatedTarget instanceof Node && editor.view.dom.parentElement?.contains(event.relatedTarget))) setLinkOpen(false)
      setQuiet(false)
    },
  }))
  const editor = useEditor(options)

  // 바깥 값(서버 글 · 되살린 글)을 따라간다. 고치는 중이면 기다렸다가 글 상자를 떠난 뒤에 맞춘다
  const sync = () => {
    if (!editor || editor.isDestroyed || editor.isFocused) return
    const cur = toMarkdown(editor)
    if (cur === value || (value === applied.current.value && cur === applied.current.md)) return
    editor.chain().setMeta('addToHistory', false).setContent(value, { contentType: 'markdown', emitUpdate: false }).run()
    applied.current = { value, md: toMarkdown(editor) }
    cb.current.onSync(applied.current.md)
  }
  const syncRef = useRef(sync)
  useLayoutEffect(() => { syncRef.current = sync })
  useEffect(() => { sync() }, [value, editor]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!editor) return
    const onBlur = () => setTimeout(() => syncRef.current(), 0)
    editor.on('blur', onBlur)
    return () => { editor.off('blur', onBlur) }
  }, [editor])

  useEffect(() => {
    if (!quiet) return
    const wake = () => setQuiet(false)
    window.addEventListener('mousemove', wake, { once: true })
    return () => window.removeEventListener('mousemove', wake)
  }, [quiet])

  return (
    <div className="rt">
      {editor && <Toolbar editor={editor} linkOpen={linkOpen} setLinkOpen={setLinkOpen} quiet={quiet} anchor={() => cb.current.anchor?.() ?? null} />}
      <EditorContent editor={editor} />
    </div>
  )
}

// 상단 바와 레포트 막대(둘 다 화면 위에 고정) 아래로 도구를 띄울 높이
const UNDER_BARS = 140
const focusedIn = (view: Editor['view'], element: HTMLElement) => view.hasFocus() || element.contains(document.activeElement)
// 문단 도구: 기준(문단 제목) 바로 위 빈 줄의 오른쪽 끝. 제목 · 배지 · '원래 글로 되돌리기'와 본문을 가리지 않는다.
// 문단이 길어 위쪽이 화면 밖으로 나가면 고정 막대 바로 아래에 붙어 따라오고, 문단이 화면에서 사라지면 숨는다
const CARET_OPTIONS = { placement: 'top-end', offset: 2, flip: false, shift: { crossAxis: true, padding: { top: UNDER_BARS, right: 8, bottom: 8, left: 8 } }, hide: { padding: { top: UNDER_BARS } } } as const
// 고른 글자 도구: 고른 글자 바로 위(자리가 없으면 아래)
const SELECTION_OPTIONS = { placement: 'top', offset: 8, flip: { padding: { top: UNDER_BARS } }, shift: { padding: 8 } } as const

// 서식 도구 두 가지. 보이는 조건이 겹치지 않아 한 번에 하나만 뜬다(글 상자를 떠나면 둘 다 숨는다)
// - 문단 도구: 커서만 있을 때(링크 안 제외)
// - 고른 글자 도구: 글자를 골랐거나 커서가 링크 안에 있을 때. 링크 넣기 · 고치기도 여기서 한다
function Toolbar({ editor, linkOpen, setLinkOpen, quiet, anchor }: { editor: Editor; linkOpen: boolean; setLinkOpen: (v: boolean) => void; quiet: boolean; anchor: () => HTMLElement | null }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'), italic: e.isActive('italic'), strike: e.isActive('strike'), link: e.isActive('link'),
      h1: e.isActive('heading', { level: 1 }), h2: e.isActive('heading', { level: 2 }), h3: e.isActive('heading', { level: 3 }),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), quote: e.isActive('blockquote'),
      href: (e.getAttributes('link').href as string | undefined) ?? '',
      empty: e.state.selection.empty,
    }),
  })
  // 서식을 적용하고 바로 글 상자로 돌아간다(키보드로 도구를 눌렀을 때도 이어서 쓸 수 있게). 선택 범위는 편집기 상태에 남아 있다
  const run = (fn: (c: ReturnType<Editor['chain']>) => ReturnType<Editor['chain']>) => { fn(editor.chain()).run(); editor.view.focus() }
  const heading = (level: 1 | 2 | 3) => run((c) => c.toggleHeading({ level }))

  // 메뉴 플러그인에 넘기는 값은 바뀌지 않게 둔다(바뀔 때마다 편집기에 갱신 트랜잭션이 가서 입력 중인 글을 건드린다)
  const caretShow = useCallback(({ editor: e, view, element, from, to }: MenuShowProps) => e.isEditable && focusedIn(view, element) && from === to && !e.isActive('link'), [])
  const selectionShow = useCallback(({ editor: e, view, element, from, to }: MenuShowProps) => {
    if (!e.isEditable || !focusedIn(view, element)) return false
    return from !== to ? !!e.state.doc.textBetween(from, to).trim() || e.isActive('link') : e.isActive('link')
  }, [])
  // 글 상자 밖으로 포커스가 나가면 두 도구를 확실히 숨긴다. 메뉴 플러그인은 도구를 누를 때 '다음 한 번은 숨기지 않기'를 켜 두는데,
  // 도구를 눌러도 포커스가 글 상자에 남게 해 두었으니 그 표시가 남아 다음 바깥 클릭에서 숨지 않는다
  const [keys] = useState(() => ({ caret: new PluginKey('rtCaret'), selection: new PluginKey('rtSelection') }))
  const caretEl = useRef<HTMLDivElement>(null)
  const selectionEl = useRef<HTMLDivElement>(null)
  // 메뉴 틀 자체는 Tab으로 멈추지 않게 한다(안의 도구 막대가 한 번 멈춘다). 플러그인이 틀을 만들 때마다 Tab 순서에 넣으므로 뜰 때마다 뺀다
  const [menuOptions] = useState(() => ({
    caret: { ...CARET_OPTIONS, onShow: () => { if (caretEl.current) caretEl.current.tabIndex = -1 } },
    selection: { ...SELECTION_OPTIONS, onShow: () => { if (selectionEl.current) selectionEl.current.tabIndex = -1 } },
  }))
  useEffect(() => {
    const onBlur = ({ event }: { event: FocusEvent }) => {
      const root = editor.view.dom.closest('.rt')
      if (event.relatedTarget instanceof Node && root?.contains(event.relatedTarget)) return
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(keys.caret, 'hide').setMeta(keys.selection, 'hide'))
    }
    editor.on('blur', onBlur)
    return () => { editor.off('blur', onBlur) }
  }, [editor, keys])

  const anchorRef = useRef(anchor)
  useLayoutEffect(() => { anchorRef.current = anchor })
  // 기준의 위쪽부터 글 상자 아래쪽까지를 한 덩어리로 본다(문단이 화면에 조금이라도 보이면 도구가 남는다)
  const caretAnchor = useCallback(() => {
    const rect = () => {
      const ed = editor.view.dom.getBoundingClientRect()
      const top = Math.min(ed.top, anchorRef.current()?.getBoundingClientRect().top ?? ed.top)
      return new DOMRect(ed.left, top, ed.width, ed.bottom - top)
    }
    return { getBoundingClientRect: rect, getClientRects: () => [rect()] }
  }, [editor])
  // 도구를 눌러도 글 상자의 커서 · 선택이 풀리지 않게 한다(입력칸은 예외)
  const keepSelection = (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('input')) e.preventDefault() }

  const tools = (caret: boolean) => (
    <Tools label={caret ? '문단 서식' : '글 서식'} onEscape={() => editor.view.focus()}>
      <Btn label="제목 1" keys={`${MOD}⌥1`} on={s.h1} onClick={() => heading(1)}><LuHeading1 /></Btn>
      <Btn label="제목 2" keys={`${MOD}⌥2`} on={s.h2} onClick={() => heading(2)}><LuHeading2 /></Btn>
      <Btn label="제목 3" keys={`${MOD}⌥3`} on={s.h3} onClick={() => heading(3)}><LuHeading3 /></Btn>
      <span className="rt-sep" />
      <Btn label="굵게" keys={`${MOD}B`} on={s.bold} onClick={() => run((c) => c.toggleBold())}><LuBold /></Btn>
      <Btn label="기울임" keys={`${MOD}I`} on={s.italic} onClick={() => run((c) => c.toggleItalic())}><LuItalic /></Btn>
      <Btn label="취소선" keys={`${MOD}⇧S`} on={s.strike} onClick={() => run((c) => c.toggleStrike())}><LuStrikethrough /></Btn>
      {caret
        ? <Btn label="링크" hint="링크를 걸 글자를 먼저 골라 주세요" disabled onClick={() => {}}><LuLink /></Btn>
        : <Btn label="링크" keys={`${MOD}K`} on={s.link} onClick={() => setLinkOpen(true)}><LuLink /></Btn>}
      <span className="rt-sep" />
      <Btn label="글머리 기호 목록" keys={`${MOD}⇧8`} on={s.ul} onClick={() => run((c) => c.toggleBulletList())}><LuList /></Btn>
      <Btn label="번호 목록" keys={`${MOD}⇧7`} on={s.ol} onClick={() => run((c) => c.toggleOrderedList())}><LuListOrdered /></Btn>
      <Btn label="인용문" keys={`${MOD}⇧B`} on={s.quote} onClick={() => run((c) => c.toggleBlockquote())}><LuTextQuote /></Btn>
    </Tools>
  )

  return (
    <>
      <BubbleMenu ref={caretEl} pluginKey={keys.caret} editor={editor} resizeDelay={16} className={`rt-menu rt-caret no-print${quiet ? ' quiet' : ''}`} options={menuOptions.caret} shouldShow={caretShow} getReferencedVirtualElement={caretAnchor} onMouseDown={keepSelection}>
        {tools(true)}
      </BubbleMenu>
      <BubbleMenu ref={selectionEl} pluginKey={keys.selection} editor={editor} className="rt-menu no-print" options={menuOptions.selection} shouldShow={selectionShow} onMouseDown={keepSelection}>
        {linkOpen ? (
          <LinkForm
            initial={s.href}
            onApply={(href) => { run((c) => c.extendMarkRange('link').setLink({ href })); setLinkOpen(false) }}
            onRemove={s.link ? () => { run((c) => c.extendMarkRange('link').unsetLink()); setLinkOpen(false) } : undefined}
            onClose={() => { setLinkOpen(false); editor.view.focus() }}
          />
        ) : s.empty && s.link ? (
          // 커서가 링크 안에 있을 때: 주소 보기 · 열기 · 고치기 · 떼기
          <Tools label="링크" onEscape={() => editor.view.focus()}>
            <a className="rt-href" href={safeHref(s.href) ?? undefined} target="_blank" rel="noopener noreferrer nofollow" title="새 탭에서 열기">{s.href}<LuExternalLink aria-hidden /></a>
            <span className="rt-sep" />
            <Btn label="링크 고치기" onClick={() => setLinkOpen(true)}><LuLink /></Btn>
            <Btn label="링크 떼기" onClick={() => run((c) => c.extendMarkRange('link').unsetLink())}><LuUnlink /></Btn>
          </Tools>
        ) : tools(false)}
      </BubbleMenu>
    </>
  )
}
type MenuShowProps = { editor: Editor; view: Editor['view']; element: HTMLElement; from: number; to: number }

// 도구 막대: Tab으로는 한 번만 들어오고(첫 단추), 안에서는 ←/→ · Home/End로 옮긴다. Esc는 글 상자로 돌아간다
function Tools({ label, onEscape, children }: { label: string; onEscape: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') ?? [])]
  // 막대에 처음 들어올 단추 하나만 Tab 순서에 둔다
  useLayoutEffect(() => { items().forEach((el, i) => { el.tabIndex = i === 0 ? 0 : -1 }) })
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onEscape(); return }
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const next = e.key === 'ArrowRight' ? (i + 1) % list.length : e.key === 'ArrowLeft' ? (i - 1 + list.length) % list.length : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    list[next].focus()
  }
  return <div ref={ref} className="rt-tools" role="toolbar" aria-label={label} onKeyDown={onKeyDown}>{children}</div>
}

function Btn({ label, keys, hint, on, disabled, onClick, children }: { label: string; keys?: string; hint?: string; on?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    // 쓸 수 없는 단추도 이유(hint)를 보여 주도록 disabled 대신 aria-disabled로 둔다
    <button type="button" className={on ? 'on' : ''} aria-label={label} aria-pressed={disabled ? undefined : on} aria-disabled={disabled || undefined} title={hint ?? (keys ? `${label} (${keys})` : label)} onClick={disabled ? undefined : onClick}>
      {children}
    </button>
  )
}

function LinkForm({ initial, onApply, onRemove, onClose }: { initial: string; onApply: (href: string) => void; onRemove?: () => void; onClose: () => void }) {
  const [v, setV] = useState(initial)
  const [bad, setBad] = useState(false)
  const apply = () => { const u = safeHref(v); if (u) onApply(u); else setBad(true) }
  return (
    <form className="rt-link" onSubmit={(e) => { e.preventDefault(); apply() }}>
      <input
        autoFocus
        type="text"
        inputMode="url"
        placeholder="https://"
        aria-label="링크 주소"
        aria-invalid={bad}
        value={v}
        onChange={(e) => { setV(e.target.value); setBad(false) }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
      />
      <button type="submit" aria-label="링크 넣기" title="링크 넣기 (Enter)"><LuCheck /></button>
      {onRemove && <button type="button" aria-label="링크 떼기" title="링크 떼기" onClick={onRemove}><LuUnlink /></button>}
      {bad && <span className="rt-link-err" role="alert">http(s) 주소나 메일 주소만 넣을 수 있어요</span>}
    </form>
  )
}
