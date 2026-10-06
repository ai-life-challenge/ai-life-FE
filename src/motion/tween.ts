// 숫자 하나를 시간에 따라 움직인다. 지도(deck.gl) 쪽 값은 Motion이 모르는 값이라 rAF로 직접 돌린다.
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3)
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

export function tween(from: number, to: number, ms: number, onUpdate: (v: number) => void, opts: { ease?: (x: number) => number; onDone?: () => void } = {}) {
  const ease = opts.ease ?? easeOut
  const t0 = performance.now()
  let id = requestAnimationFrame(function tick() {
    const k = Math.min(1, (performance.now() - t0) / ms)
    onUpdate(from + (to - from) * ease(k))
    if (k < 1) id = requestAnimationFrame(tick)
    else opts.onDone?.()
  })
  return () => cancelAnimationFrame(id)
}
