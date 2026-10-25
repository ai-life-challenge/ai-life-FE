// 랜딩 스크롤: 휠을 한 번 굴릴 때마다 한 섹션씩 넘어간다. 화면보다 긴 섹션은 안쪽 끝에 닿을 때까지 그냥 스크롤한다.
// 휠을 많이 굴려도 막히지 않는다: 이동이 끝나면(LOCK_MS 뒤) 다음 휠이 바로 다음 섹션으로 넘긴다. 이동 중에 들어오는 휠(트랙패드 관성)만 무시한다.
import { useEffect, type RefObject } from 'react'

const LOCK_MS = 700 // 한 번 넘어가는 동안 새 휠을 무시하는 시간
const TOL = 24 // 섹션이 보이는 높이보다 이 정도(여백 몇 px)만 길어도 '한 화면짜리'로 본다
const NEED = 40 // 이만큼 굴려야 넘어간다(마우스 휠 한 칸은 100 안팎, 트랙패드는 조금씩 쌓인다)

// 어디로 갈지: 숫자면 그 위치로 스크롤, null이면 브라우저 기본 스크롤에 맡긴다.
// tops: 섹션 시작 위치들, y: 현재 위치, view: 보이는 높이(상단바 뺀), end: 맨 아래 위치(scrollHeight)
export function pagerTarget(dir: 1 | -1, y: number, tops: number[], view: number, end: number): number | null {
  let i = 0
  tops.forEach((t, k) => { if (t <= y + 4) i = k })
  const bottom = i + 1 < tops.length ? tops[i + 1] : end // 이 섹션이 끝나는 위치(다음 섹션 시작)
  if (dir > 0) {
    if (y + view < bottom - TOL) return null // 아직 이 섹션 아래가 남았다: 그냥 스크롤
    return i + 1 < tops.length ? tops[i + 1] : null
  }
  if (y > tops[i] + 2) return bottom - tops[i] > view + TOL ? null : tops[i] // 섹션 중간에서 올릴 때: 긴 섹션은 그냥 스크롤, 짧으면 시작점으로
  if (i === 0) return null
  return Math.max(tops[i - 1], tops[i] - view) // 이전 섹션이 길면 그 맨 아래 쪽으로
}

export function useSectionScroll(ref: RefObject<HTMLElement | null>, selector = '.snap', offset = 64) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let acc = 0, last = 0, lock = 0
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return // 핀치 확대
      const now = performance.now()
      if (now < lock) { e.preventDefault(); return }
      if (now - last > 150) acc = 0
      last = now
      acc += e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      const base = el.getBoundingClientRect().top
      const tops = [...el.querySelectorAll<HTMLElement>(selector)].map((s) => s.getBoundingClientRect().top - base + el.scrollTop - offset)
      const dir = acc > 0 ? 1 : -1
      const target = pagerTarget(dir, el.scrollTop, tops, el.clientHeight - offset, el.scrollHeight)
      if (target == null) { acc = 0; return } // 기본 스크롤
      e.preventDefault()
      if (Math.abs(acc) < NEED) return
      acc = 0
      lock = now + (reduce ? 0 : LOCK_MS)
      el.scrollTo({ top: target, behavior: reduce ? 'auto' : 'smooth' })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref, selector, offset])
}
