// 서버가 문단 글에 거는 규칙: 빈 글은 초안으로 되돌리고, 1,500자를 넘으면 400으로 거절한다.
// 이런 글은 보내지 않고 이유를 보여 준다(고친 글은 화면과 브라우저에 그대로 남는다)
import type { SectionKey } from '../../api/types'
import type { SectionValue } from './autosave'

export const SECTION_MAX = 1500
const charCount = (s: string) => [...s].length // 서버는 글자(코드 포인트) 수로 센다

export const validateSection = (_key: SectionKey, v: SectionValue): string | null => {
  if (v == null) return null
  if (!v.trim()) return '빈 문단은 저장되지 않아요. 글을 쓰거나 원래 글로 되돌려 주세요'
  const n = charCount(v)
  return n > SECTION_MAX ? `한 문단은 ${SECTION_MAX.toLocaleString()}자까지 저장돼요 (지금 ${n.toLocaleString()}자)` : null
}
