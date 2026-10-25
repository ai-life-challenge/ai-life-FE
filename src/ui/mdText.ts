// 서버 마크다운 글을 그리기 전에 손보는 순수 글자 함수(화면 코드와 분리해 테스트한다)

// 글이 흘러오는 중에는 정의가 아직 안 온 각주 표시([^b3])와 끊긴 표시([^b)를 감춘다. 정의가 도착하면 번호 링크로 바뀐다
export function hidePendingRefs(text: string): string {
  const defined = new Set([...text.matchAll(/^\[\^([^\]\s]+)\]:/gm)].map((m) => m[1]))
  return text.replace(/\[\^([^\]\s]+)\](?!:)/g, (m, id) => (defined.has(id) ? m : '')).replace(/\[\^[^\]\n]*$/, '')
}

// 레포트 본문의 [n](n은 숫자)을 '출처와 근거' n번 각주로 가는 링크로 바꾼다. [n](주소)나 [n]: 정의는 건드리지 않는다
export const linkNotes = (text: string) => text.replace(/\[(\d+)\](?![(:])/g, '[[$1]](#note-$1)')
