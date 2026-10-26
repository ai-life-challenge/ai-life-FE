import { useEffect, useState } from 'react'

// active일 때 경과 ms를 돌려준다(반복 애니메이션용). 값이 바뀔 때마다 지도 전체가 다시 그려지므로 아낀다:
// fps만큼만 갱신하고(기본 30), until ms가 지나면 멈춘다. reset이 바뀌면 0부터 다시 잰다. 탭이 숨겨지면 브라우저가 rAF를 멈춘다
export function useRafTime(active: boolean, reset?: unknown, { fps = 30, until = Infinity }: { fps?: number; until?: number } = {}) {
  const [t, setT] = useState(0)
  useEffect(() => {
    if (!active) return
    let id = 0, last = -Infinity
    const start = performance.now(), gap = 1000 / fps
    const tick = (now: number) => {
      const e = now - start
      if (e >= until) { setT(until); return }
      if (now - last >= gap) { last = now; setT(e) }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active, reset, fps, until])
  return t
}
