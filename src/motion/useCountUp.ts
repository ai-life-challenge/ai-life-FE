import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
import { tween } from './tween'

// 처음엔 0부터, 숫자가 바뀌면 이전 값에서 새 값까지 굴러가듯 움직인다. (Motion의 AnimateNumber는 유료라 직접 만든다)
export function useCountUp(value: number, ms = 900, delay = 0) {
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (reduce) {
      from.current = value
      setShown(value)
      return
    }
    let stop = () => {}
    const t = setTimeout(() => { stop = tween(from.current, value, ms, (v) => { from.current = v; setShown(v) }) }, delay)
    return () => { clearTimeout(t); stop() }
  }, [value, ms, delay, reduce])
  return shown
}

export const fmt = (n: number) => Math.round(n).toLocaleString('ko-KR')
export const pct = (x: number) => `${Math.round(x * 100)}%`
export const eok = (x: number) => `${Math.round(x).toLocaleString('ko-KR')}억`
export const sc = (x: number) => String(Math.round(x)) // 점수는 정수로 보여 준다
