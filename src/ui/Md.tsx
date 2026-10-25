// 서버가 마크다운으로 주는 글(질문 답 · 레포트 문단)을 그린다. GFM(표 · 목록 · 각주)을 쓰고, 원본 HTML은 켜지 않는다(react-markdown 기본).
// 각주는 본문의 [^id]와 글 끝의 [^id]: 정의로 오고, 번호 링크와 '본문으로' 돌아가기가 생긴다. 같은 id가 여러 글에 나와도 겹치지 않게 prefix를 붙인다.
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'


export function Md({ text, prefix }: { text: string; prefix: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        remarkRehypeOptions={{ clobberPrefix: `${prefix}-`, footnoteLabel: '출처와 근거', footnoteBackLabel: '본문으로' }}
        components={{
          // 바깥 주소는 새 탭으로, 레포트 본문의 각주 번호([n] → #note-n)는 위첨자로, 나머지 문서 안 링크(질문 답의 각주)는 그대로. react-markdown이 주는 node는 DOM에 새지 않게 뺀다
          a: ({ node, href, children, ...rest }) => {
            void node
            if (/^https?:/.test(href ?? '')) return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            if (href?.startsWith('#note-')) return <sup><a href={href}>{children}</a></sup>
            return <a href={href} {...rest}>{children}</a>
          },
          // 표는 좁은 화면에서 옆으로 밀리게 감싼다
          table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
