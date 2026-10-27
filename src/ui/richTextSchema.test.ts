// @vitest-environment jsdom
// 레포트 문단 편집기: 서버 마크다운 → 편집 문서 → 마크다운이 글을 바꾸지 않는지, 서식이 올바른 마크다운이 되는지 본다
import { afterEach, expect, test } from 'vitest'
import { Editor } from '@tiptap/core'
import { normalizeMarkdown, richTextExtensions, safeHref, toMarkdown } from './richTextSchema'

let ed: Editor | null = null
afterEach(() => { ed?.destroy(); ed = null })
const open = (md: string) => (ed = new Editor({ extensions: richTextExtensions(), content: md, contentType: 'markdown' }))
const roundTrip = (md: string) => toMarkdown(open(md))

test('서버가 만든 문단은 읽고 다시 써도 그대로다(각주 번호 · 인라인 코드 · 목록)', () => {
  const samples = [
    '80세 이상 3,958명[1] 중 386명(9.8%)[2]은 병원에 갈 수 없다. 모두 `자가용 30분`[3] 안에 병원이 있지만[4][5] 마을이다.',
    '공급수단은 나뉜다.\n\n- 비용 절감안은 원격진료로만 닿는 곳이 17곳이다[10].\n- 균형안은 97.5%, 연 2.3억이다[11].',
    '- 공급수단 단가는 가정값이다[15]. 원격 서비스 효과는 `0.5`로 가정했다[15].\n- 대중교통 사각지대는 `걸어서 15분`, `하루 3번`으로 판정했다[8].',
  ]
  for (const s of samples) expect(roundTrip(s)).toBe(s)
})

test('서식(제목 · 굵게 · 기울임 · 취소선 · 링크 · 목록 · 인용)이 마크다운으로 오간다', () => {
  const md = '# 제목\n\n## 소제목\n\n### 작은 제목\n\n**굵게** *기울임* ~~취소~~ [링크](https://example.com)\n\n- 가\n- 나\n\n1. 하나\n2. 둘\n\n> 인용 [1]\n\n첫 줄  \n둘째 줄'
  expect(roundTrip(md)).toBe(md)
})

test('각주 번호는 위첨자 링크 한 덩어리로 그린다', () => {
  const e = open('달성률[12]이다')
  expect(e.getHTML()).toBe('<p>달성률<sup data-note="12" class="note-ref"><a href="#note-12" tabindex="-1">[12]</a></sup>이다</p>')
  // [n](주소) · [^n] · [n]: 은 각주가 아니다
  expect(roundTrip('[7](https://y.kr) 와 [^1]')).toBe('[7](https://y.kr) 와 \\[^1\\]')
})

test('각주 번호를 걸쳐 굵게 해도 서식이 끊기지 않는다', () => {
  const e = open('가나 386명[1] 중 일부[2]는 못 간다')
  e.chain().selectAll().toggleBold().run()
  expect(toMarkdown(e)).toBe('**가나 386명[1] 중 일부[2]는 못 간다**')
  e.chain().selectAll().unsetBold().setTextSelection({ from: 1, to: 8 }).toggleItalic().run()
  expect(toMarkdown(e)).toBe('*가나 386명*[1] 중 일부[2]는 못 간다')
})

test('편집 명령: 목록 · 제목 · 인용 · 링크 넣고 떼기', () => {
  const e = open('문단')
  e.chain().selectAll().toggleBulletList().run()
  expect(toMarkdown(e)).toBe('- 문단')
  e.chain().selectAll().toggleBulletList().toggleHeading({ level: 2 }).run()
  expect(toMarkdown(e)).toBe('## 문단')
  e.chain().selectAll().setParagraph().toggleBlockquote().run()
  expect(toMarkdown(e)).toBe('> 문단')
  e.chain().setTextSelection(3).toggleBlockquote().selectAll().setLink({ href: 'https://a.kr' }).run()
  expect(toMarkdown(e)).toBe('[문단](https://a.kr)')
  e.chain().selectAll().unsetLink().run()
  expect(toMarkdown(e)).toBe('문단')
})

test('실행 취소 · 다시 실행', () => {
  const e = open('처음')
  e.commands.focus('end')
  e.commands.insertContent(' 더함')
  expect(toMarkdown(e)).toBe('처음 더함')
  e.commands.undo()
  expect(toMarkdown(e)).toBe('처음')
  e.commands.redo()
  expect(toMarkdown(e)).toBe('처음 더함')
})

test('빈 문단 줄은 저장 글에 남지 않는다', () => {
  const e = open('첫째')
  e.commands.focus('end'); e.commands.splitBlock(); e.commands.splitBlock(); e.commands.insertContent('둘째')
  expect(toMarkdown(e)).toBe('첫째\n\n둘째')
})

test('위험한 주소는 링크로 두지 않는다', () => {
  expect(roundTrip('[눌러](javascript:alert(1))')).toBe('눌러')
  expect(open('<script>alert(1)</script><img src=x onerror=alert(1)>글').getHTML()).not.toMatch(/script|onerror|<img/)
  const e = open('글')
  e.chain().selectAll().setLink({ href: 'javascript:alert(1)' }).run()
  expect(toMarkdown(e)).toBe('글')
  expect(safeHref('example.com')).toBe('https://example.com')
  expect(safeHref('mailto:a@b.kr')).toBe('mailto:a@b.kr')
  expect(safeHref('data:text/html,x')).toBeNull()
  expect(safeHref('그냥 글')).toBeNull()
})

test('원래 글 비교: 표기 차이는 같게, 글자 · 띄어쓰기 · 줄바꿈 차이는 다르게 본다', () => {
  const original = '80세 이상 3,958명[1] 중 386명은 갈 수 없다.\n\n- 비용 절감안은 `연 1.0억`이다[10].\n- 균형안이다[11].'
  const n = normalizeMarkdown(original)
  expect(n).toBe(original)
  expect(normalizeMarkdown('가\n\n* 하나\n* 둘')).toBe(normalizeMarkdown('가\n\n- 하나\n- 둘')) // 목록 기호 표기만 다름
  expect(normalizeMarkdown(original + '.')).not.toBe(n)
  expect(normalizeMarkdown(original.replace('갈 수', '갈  수'))).not.toBe(n)
  expect(normalizeMarkdown(original.replace('갈 수', '갈수'))).not.toBe(n)
  expect(normalizeMarkdown(original.replace('없다.\n\n', '없다.\n\n추가\n\n'))).not.toBe(n)
})
