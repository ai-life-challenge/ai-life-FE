import { useEffect, useState } from 'react'

// active일 때만 매 프레임 경과 ms를 돌려준다 (반복 애니메이션용)
export function useRafTime(active: boolean) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    let id = 0
    const start = performance.now()
    const tick = (now: number) => { setT(now - start); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active])
  return t
}
