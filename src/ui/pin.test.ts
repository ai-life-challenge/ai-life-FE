import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { PIN_COLOR, PIN_PATHS } from './pin'

// 파비콘(정적 SVG)이 로고 속 핀과 같은 모양 · 색인지
test('파비콘은 PinIcon과 같은 경로와 색을 쓴다', () => {
  const svg = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8')
  expect(svg).toContain(`d="${PIN_PATHS.fill}"`)
  expect(svg).toContain(`d="${PIN_PATHS.outline}"`)
  expect(svg).toContain('cx="12" cy="8.98" r="3.59"')
  expect(svg.match(/#[0-9a-f]{6}/gi)?.every((c) => c.toLowerCase() === PIN_COLOR)).toBe(true)
})
