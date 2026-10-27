// 레포트 문단 편집기(TipTap)의 문서 규칙. 화면 편집기와 테스트가 같이 쓴다.
// 서버는 문단을 마크다운으로 주고받는다: 마크다운 → 편집 문서 → 마크다운으로 바꿔 같은 형식으로 돌려보낸다.
import { Editor, Node, mergeAttributes, type AnyExtension, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Markdown } from '@tiptap/markdown'

// 링크는 웹 주소와 메일만 둔다(javascript: 같은 주소는 막는다)
export const safeHref = (raw: string): string | null => {
  const s = raw.trim()
  if (!s) return null
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[\w-]+(\.[\w-]+)+/.test(s) ? `https://${s}` : null
  if (!withProto) return null
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(withProto).protocol) ? withProto : null
  } catch { return null }
}

// 본문 속 [n](n은 숫자)은 '출처와 근거' n번 각주다. 한 덩어리(지우면 통째로)로 두고, 위첨자 링크로 그린다.
// 링크는 Tab으로 멈추지 않게 한다(Tab은 문단 사이를 오간다. 각주는 눌러서 가거나 '출처와 근거' 목록에서 본다)
const NOTE_RE = /^\[(\d{1,3})\](?![(:])/
export const NoteRef = Node.create({
  name: 'noteRef',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes: () => ({ n: { default: 1, parseHTML: (el) => Number(el.getAttribute('data-note')), renderHTML: () => ({}) } }),
  parseHTML: () => [{ tag: 'sup[data-note]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes, { 'data-note': node.attrs.n, class: 'note-ref' }), ['a', { href: `#note-${node.attrs.n}`, tabindex: '-1' }, `[${node.attrs.n}]`]],
  renderText: ({ node }) => `[${node.attrs.n}]`,
  markdownTokenizer: {
    name: 'noteRef',
    level: 'inline',
    start: (src) => src.search(/\[\d{1,3}\](?![(:])/),
    tokenize: (src) => {
      const m = NOTE_RE.exec(src)
      return m ? { type: 'noteRef', raw: m[0], n: Number(m[1]) } : undefined
    },
  },
  parseMarkdown: (token) => ({ type: 'noteRef', attrs: { n: token.n } }),
  renderMarkdown: (node) => `[${node.attrs?.n}]`,
})

// 저장된 글에 안전하지 않은 주소의 링크가 있으면 링크를 떼고 글자만 남긴다
const SafeLink = Link.extend({
  parseMarkdown: (token, h) => {
    const inner = h.parseInline(token.tokens || [])
    const href = safeHref(String(token.href ?? ''))
    return href ? h.applyMark('link', inner, { href, title: token.title || null }) : inner
  },
})

export const richTextExtensions = (): AnyExtension[] => [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    codeBlock: false, // 서버 글에 코드 블록은 없다. 짧은 `기준값` 표시(인라인 코드)는 남긴다
    horizontalRule: false,
    underline: false, // 마크다운에 밑줄이 없다
    trailingNode: false, // 끝에 빈 문단을 붙이면 저장 글에 빈 줄이 생긴다
    link: false,
  }),
  SafeLink.configure({
    openOnClick: false, // 고치는 중에 링크 글자를 눌러도 이동하지 않는다(⌘/Ctrl+클릭이나 링크 메뉴로 연다)
    autolink: true,
    linkOnPaste: true,
    defaultProtocol: 'https',
    protocols: ['mailto'],
    isAllowedUri: (url) => safeHref(url) != null,
    HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
  }),
  NoteRef,
  Markdown.configure({ indentation: { style: 'space', size: 2 } }),
]

// 편집기 글 → 서버에 보낼 마크다운.
// 각주 번호는 글자가 아닌 덩어리라 그대로 두면 굵게 같은 서식이 그 앞뒤에서 끊겨 '**가**[1]** 나**'처럼 깨진다.
// 그래서 같은 서식을 단 자리 표시 글자로 바꿔 한 줄기로 쓴 뒤 [n]으로 되돌린다
const notePh = (n: unknown) => `\uE000${n}\uE001`
const inlineNotes = (node: JSONContent): JSONContent =>
  node.type === 'noteRef' ? { type: 'text', text: notePh(node.attrs?.n), marks: node.marks }
    : node.content ? { ...node, content: node.content.map(inlineNotes) } : node
export const toMarkdown = (editor: Editor) =>
  tidyMarkdown(editor.markdown!.serialize(inlineNotes(editor.getJSON())).replace(/\uE000(\d+)\uE001/g, '[$1]'))

// 마크다운을 편집기로 읽었다가 다시 쓴 꼴. 서버 초안과 편집기 글을 같은 기준으로 비교할 때 쓴다(표기 차이만 맞추고 글자는 바꾸지 않는다)
export function normalizeMarkdown(md: string) {
  const ed = new Editor({ extensions: richTextExtensions(), content: md, contentType: 'markdown' })
  try { return toMarkdown(ed) } finally { ed.destroy() }
}

// 편집기가 내놓은 마크다운을 서버에 보낼 꼴로 다듬는다: 빈 문단 표시(&nbsp;)와 겹친 빈 줄을 없앤다
export const tidyMarkdown = (md: string) =>
  md
    .split('\n')
    .filter((l) => !/^\s*(&nbsp;| )\s*$/.test(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
