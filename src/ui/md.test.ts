import { expect, test } from 'vitest'
import { hidePendingRefs, linkNotes } from './mdText'

test('글이 흘러오는 중: 정의가 아직 안 온 각주 표시와 끊긴 표시는 감춘다', () => {
  expect(hidePendingRefs('달성률이에요.[^b3] 그리고[^b')).toBe('달성률이에요. 그리고')
  expect(hidePendingRefs('답이에요.[^b3]\n\n[^b3]: 계산: 균형안')).toBe('답이에요.[^b3]\n\n[^b3]: 계산: 균형안') // 정의가 오면 그대로
  expect(hidePendingRefs('두 개[^a][^b]\n\n[^a]: 하나')).toBe('두 개[^a]\n\n[^a]: 하나') // 정의가 없는 것만 감춘다
})

test('레포트 본문의 [n]만 각주 링크로 바꾼다', () => {
  expect(linkNotes('3,926명[1] 중 672명(17.1%)[2]은 `자가용 30분`[3] 안에[4][5]')).toBe('3,926명[[1]](#note-1) 중 672명(17.1%)[[2]](#note-2)은 `자가용 30분`[[3]](#note-3) 안에[[4]](#note-4)[[5]](#note-5)')
  expect(linkNotes('[링크](http://x) [^1]: 정의 [7](http://y)')).toBe('[링크](http://x) [^1]: 정의 [7](http://y)')
})
