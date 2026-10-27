import { describe, expect, test } from 'vitest'
import { pct1, stateName } from './meta'

describe('마을 판정 이름', () => {
  test('너무 멂(2)은 고른 시설 이름으로 적는다', () => {
    expect(stateName(2, 'med')).toBe('병의원이 너무 멀어 못 감')
    expect(stateName(2, 'er')).toBe('응급의료센터가 너무 멀어 못 감')
    expect(stateName(2, 'clinic')).toBe('동네 의원이 너무 멀어 못 감')
  })
  test('갈 수 있음 · 버스가 없어 못 감은 시설과 상관없이 그대로다', () => {
    expect(stateName(0, 'er')).toBe('갈 수 있음')
    expect(stateName(1, 'hospital')).toBe('버스가 없어 못 감')
  })
})

describe('달성률 표시', () => {
  test('소수 한 자리로 맞춘다', () => {
    expect(pct1(0.81)).toBe('81.0%')
    expect(pct1(0.8124)).toBe('81.2%')
    expect(pct1(0)).toBe('0.0%')
    expect(pct1(1)).toBe('100.0%')
  })
  test('숫자가 아니면 NaN% 대신 —', () => {
    expect(pct1(NaN)).toBe('—')
  })
})
