import { expect, test } from 'vitest'
import { pagerTarget } from './sectionScroll'

// 섹션 시작 0 · 800(짧음, 높이 800) · 1600부터 2800까지(긴 섹션, 높이 1200). 보이는 높이 800, 문서 끝 2800
const tops = [0, 800, 1600]
const go = (dir: 1 | -1, y: number) => pagerTarget(dir, y, tops, 800, 2800)

test('짧은 섹션에서는 한 번에 다음 섹션 시작으로', () => {
  expect(go(1, 0)).toBe(800)
  expect(go(1, 800)).toBe(1600)
})
test('긴 섹션은 아래 끝에 닿기 전까지 기본 스크롤, 닿으면 멈춤(마지막이라 갈 곳 없음)', () => {
  expect(go(1, 1600)).toBeNull()
  expect(go(1, 1900)).toBeNull()
  expect(go(1, 2000)).toBeNull() // 끝(2000+800=2800)에 닿았고 마지막 섹션이라 null
})
test('위로: 섹션 시작에 있으면 이전 섹션으로, 이전이 길면 그 맨 아래 쪽으로', () => {
  expect(go(-1, 800)).toBe(0)
  expect(go(-1, 1600)).toBe(800) // 이전(800~1600) 섹션은 보이는 높이와 같아서 시작점
  expect(go(-1, 0)).toBeNull()
})
test('섹션 중간에서 위로: 긴 섹션은 기본 스크롤, 짧은 섹션은 시작점으로', () => {
  expect(go(-1, 1900)).toBeNull()
  expect(go(-1, 850)).toBe(800)
})

test('보이는 높이보다 몇 px 긴 섹션도 한 번에 넘어간다(여백 때문에 기본 스크롤로 새지 않게)', () => {
  const t = [0, 879, 1758] // 섹션 높이 879, 보이는 높이 871
  expect(pagerTarget(1, 879, t, 871, 5000)).toBe(1758)
  expect(pagerTarget(-1, 879, t, 871, 5000)).toBe(8) // 이전(0~879)도 한 화면짜리라 그 맨 아래 쪽(879-871)
})
