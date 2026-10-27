import { describe, expect, test } from 'vitest'
import { stateName } from './meta'

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
