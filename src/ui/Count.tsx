import { useCountUp } from '../motion/useCountUp'

// 숫자 하나를 카운트업해서 보여 준다
export function Count({ value, format = (n) => Math.round(n).toLocaleString('ko-KR'), ms, delay }: { value: number; format?: (n: number) => string; ms?: number; delay?: number }) {
  return <>{format(useCountUp(value, ms, delay))}</>
}
