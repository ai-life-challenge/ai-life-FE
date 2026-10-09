import { Fragment } from 'react'

// 문장을 쉼표·마침표 단위로 묶어서, 줄이 바뀌어도 구절 중간(예: '세 / 가지', 'DRT / 22억')에서 끊기지 않게 한다.
// 구절 사이 공백은 묶음 밖에 둔다 (inline-block 안 맨 앞 공백은 사라진다)
export const Phrases = ({ text }: { text: string }) => (
  <>{text.split(/(?<=[.,?!]) /).map((x, i) => <Fragment key={i}>{i ? ' ' : ''}<span className="phrase">{x}</span></Fragment>)}</>
)
