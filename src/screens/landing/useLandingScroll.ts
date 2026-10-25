// 랜딩 스크롤 연출(GSAP ScrollTrigger · SplitText · DrawSVG + Lenis 관성 스크롤). 스크롤을 막지 않고, 스크롤한 만큼 장면이 움직인다(scrub).
// 히어로 · 3D · 쇼케이스 셋은 화면에 고정해 둔 채(pin) 장면이 다 바뀐 뒤에야 아래로 내려간다.
// 그림 대부분이 서버 결과로 그려져서, 결과가 온 뒤(ready) 위에서 아래 순서로 한 번에 건다. 고정 장면의 위치를 위에서부터 차례로 재야 아래 연출이 밀리지 않는다.
// 스크롤 영역은 랜딩 레이어(.landing)이고 내용은 .landing-inner다. 움직임 줄이기(prefers-reduced-motion) 설정과 상관없이 연출을 보여 준다.
import { useEffect, type RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin'
import { useGSAP } from '@gsap/react'
import Lenis from 'lenis'
import { criteria, setV3d } from './progress'

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, useGSAP)
// 윈도우 '애니메이션 효과'가 꺼진 PC는 브라우저가 움직임 줄이기(reduce)로 알려서 연출이 통째로 빠졌다. 랜딩은 그 설정과 상관없이 늘 연출을 보여 준다
const MOTION_OK = 'all'
const HERO_PIN = 140 // 히어로를 붙잡아 두는 스크롤 길이(화면 높이의 %). 앞 45%는 지도 펼침, 뒤는 빠져나가기
const STAGE_PIN = 320 // 쇼케이스 하나를 붙잡아 두는 길이

type TL = gsap.core.Timeline
// 칸 색: 시작 색(fills) → data-to 색. data-d(가운데나 핀에서 먼 정도) 순서로 번진다
function spread(svg: Element, tl: TL, at: number, span: number) {
  const cells = [...svg.querySelectorAll<SVGElement>('.ucell[data-to]')]
  const max = Math.max(1e-6, ...cells.map((c) => Number(c.dataset.d ?? 0)))
  cells.forEach((c) => tl.to(c, { fill: c.dataset.to, duration: span * 0.4 }, at + (Number(c.dataset.d ?? 0) / max) * span * 0.6))
}
// 숫자: data-from(없으면 0) → data-count. data-digits 자리까지
function count(node: HTMLElement, tl: TL, at: number, dur: number) {
  const to = Number(node.dataset.count), from = Number(node.dataset.from ?? 0), digits = Number(node.dataset.digits ?? 0)
  const o = { v: from }
  const show = () => { node.textContent = digits ? o.v.toFixed(digits) : Math.round(o.v).toLocaleString('ko-KR') }
  show()
  tl.to(o, { v: to, duration: dur, onUpdate: show }, at)
}

export function useLandingScroll(root: RefObject<HTMLDivElement | null>, ready: unknown) {
  // 관성 스크롤: 휠을 막지 않고 부드럽게 이어 준다. 스크롤 위치가 바뀔 때마다 ScrollTrigger에 알린다
  useEffect(() => {
    const el = root.current
    if (!el || !window.matchMedia(MOTION_OK).matches) return
    const lenis = new Lenis({ wrapper: el, content: el.firstElementChild as HTMLElement, lerp: 0.09 })
    lenis.on('scroll', ScrollTrigger.update)
    const tick = (t: number) => lenis.raf(t * 1000)
    gsap.ticker.add(tick)
    gsap.ticker.lagSmoothing(0)
    // 메뉴 링크(#diag 등): 붙잡힌 장면은 움직이는 섹션 대신 그 자리(pin-spacer) 맨 위로 가야 장면 처음부터 보인다
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
      const target = a && el.querySelector<HTMLElement>(a.getAttribute('href')!)
      if (!target) return
      e.preventDefault()
      const spacer = target.parentElement?.classList.contains('pin-spacer') ? target.parentElement : target
      lenis.scrollTo(spacer, { offset: -64 })
    }
    el.addEventListener('click', onClick)
    return () => { el.removeEventListener('click', onClick); gsap.ticker.remove(tick); lenis.destroy() }
  }, [root])

  useGSAP(() => {
    const el = root.current
    if (!el || !ready) return
    const mm = gsap.matchMedia()

    mm.add(MOTION_OK, () => {
      ScrollTrigger.defaults({ scroller: el })
      const st = (trigger: gsap.DOMTarget, start = 'top 85%', end = 'top 40%') => ({ trigger, start, end, scrub: 0.6 })
      const pinned = (trigger: Element | string, len: number) => ({ trigger, start: 'top 64px', end: `+=${len}%`, scrub: 0.6, pin: true, invalidateOnRefresh: true })

      // 맨 위 진행 막대
      gsap.fromTo('.land-progress', { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.landing-inner', start: 'top top', end: 'bottom bottom', scrub: true } })

      // ---- 히어로: 붙잡아 둔 채 앞 45%는 지도가 펼쳐지고, 뒤 55%는 글과 지도가 빠져나간다 ----
      const tag = SplitText.create('.hero-tagline', { type: 'chars' })
      const h1 = SplitText.create('.land-hero h1', { type: 'words' })
      const lead = SplitText.create('.land-hero .lead', { type: 'lines' })
      const OUT = 0.45
      const hero = gsap.timeline({ scrollTrigger: pinned('.hero-bleed', HERO_PIN), defaults: { ease: 'none', duration: 0.4 } })
      hero.to({}, { duration: 1 }, 0)
      const heroSvg = el.querySelector('.hero-visual svg.scrub')
      if (heroSvg) spread(heroSvg, hero, 0, OUT * 0.85) // 군 평균 한 색 → 칸마다 제 색(가운데에서 바깥으로)
      hero.to('.hero-avg', { opacity: 0.45, duration: 0.1 }, 0.1)
        .fromTo('.hero-gap', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.1 }, 0.15)
      const heroGap = el.querySelector<HTMLElement>('.hero-gap [data-count]')
      if (heroGap) count(heroGap, hero, 0.15, 0.25)
      hero.to(h1.words, { y: (i) => -80 - (i % 3) * 50, x: (i) => (i % 2 ? 40 : -40), rotate: (i) => (i % 2 ? 8 : -8), opacity: 0, stagger: 0.015 }, OUT)
        .to(lead.lines, { x: (i) => (i % 2 ? 120 : -120), opacity: 0, stagger: 0.03 }, OUT + 0.03)
        .to('.land-hero .eyebrow, .land-hero .row, .hero-note', { y: -60, opacity: 0, stagger: 0.03 }, OUT + 0.06)
        .to(tag.chars, { y: () => gsap.utils.random(-120, -30), x: () => gsap.utils.random(-60, 60), rotate: () => gsap.utils.random(-90, 90), opacity: 0, stagger: { each: 0.005, from: 'random' } }, OUT)
        .to('.hero-tilt', { rotateX: 32, rotateY: -16, scale: 0.8, y: 100, opacity: 0.25, duration: 1 - OUT }, OUT)
        .to('.hero-blobs i', { yPercent: (i) => -60 - i * 50, xPercent: (i) => (i % 2 ? 30 : -30), scale: 1.4, duration: 1 - OUT }, OUT)

      // ---- 선언문: 단어가 하나씩 진해지고, 통계 카드는 뒤에서 일어서며 숫자가 0에서 올라간다 ----
      const say = SplitText.create('.statement .say', { type: 'words' })
      gsap.fromTo(say.words, { opacity: 0.12 }, { opacity: 1, stagger: 0.1, ease: 'none', scrollTrigger: st('.statement .say', 'top 80%', 'bottom 45%') })
      const stats = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: st('.stat-grid', 'top 95%', 'top 45%') })
      stats.from('.stat', { y: 120, rotateX: -35, opacity: 0, stagger: 0.15 }, 0)
      el.querySelectorAll<HTMLElement>('.stat [data-count]').forEach((n) => count(n, stats, 0.1, 0.9))

      // ---- 3D 막대 장면: 붙잡아 둔 채 막대가 솟고 색이 바뀌고 카메라가 돈다. 설명 글도 단계마다 바뀐다 ----
      const caps = gsap.utils.toArray<HTMLElement>('.v3d-cap')
      ScrollTrigger.create({
        ...pinned('.v3d', 220), scrub: true,
        onUpdate: (s) => { setV3d(s.progress); const k = Math.min(caps.length - 1, Math.floor(s.progress * caps.length)); caps.forEach((c, i) => c.classList.toggle('on', i === k)) },
      })

      // ---- 쇼케이스 셋: 섹션을 붙잡아 무대로 쓰고, 제목이 솟았다 물러난 뒤 카드 두 장이 차례로 들어와 안의 그림이 움직인다 ----
      // 카드 1 장면(0.32~0.62) · 카드 2 장면(0.74~0.96)은 섹션마다 다르다
      const stage = (sec: HTMLElement, first: (tl: TL, card: HTMLElement) => void, second: (tl: TL, card: HTMLElement) => void) => {
        const cards = [...sec.querySelectorAll<HTMLElement>('.scard')]
        const head = sec.querySelector<HTMLElement>('.show-head')
        if (cards.length < 2 || !head) return
        sec.classList.add('stage')
        const chars = SplitText.create(head.querySelector('h2')!, { type: 'chars', mask: 'chars' }).chars
        const [c1, c2] = cards
        gsap.set(cards, { xPercent: -50, yPercent: -50, transformPerspective: 1400 })
        const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: pinned(sec, STAGE_PIN) })
        tl.to({}, { duration: 1 }, 0)
          .from(head.querySelector('.show-icon'), { rotate: -270, scale: 0, duration: 0.1 }, 0)
          .from(chars, { yPercent: 120, rotate: 8, stagger: 0.012, duration: 0.08 }, 0)
          .from(head.querySelector('p'), { y: 40, opacity: 0, duration: 0.08 }, 0.06)
          .to(head, { scale: 0.6, opacity: 0.12, filter: 'blur(6px)', duration: 0.12 }, 0.16)
          .fromTo(c1, { y: () => el.clientHeight, x: () => el.clientWidth * 0.3, rotateY: -35, rotateX: 20 }, { y: 0, x: 0, rotateY: 0, rotateX: 0, duration: 0.16 }, 0.16)
        copy(tl, c1, 0.24)
        first(tl, c1)
        tl.to(c1, { scale: 0.9, y: -60, opacity: 0, duration: 0.14 }, 0.62) // 어둡게 칠하지 않고 뒤로 물러나며 사라진다(흰 카드가 회색으로 변해 오류처럼 보였다)
          .fromTo(c2, { y: () => el.clientHeight * 1.1, rotateX: -35 }, { y: 0, rotateX: 0, duration: 0.14 }, 0.62)
        copy(tl, c2, 0.7)
        second(tl, c2)
        return tl
      }
      // 카드 왼쪽 설명: 배지가 튀어나오고, 제목 단어가 아래에서 솟고, 설명은 줄마다 가려졌다 올라온다
      function copy(tl: TL, card: HTMLElement, at: number) {
        const side = card.firstElementChild as HTMLElement
        const badge = side.querySelector('.badge')
        if (badge) tl.from(badge, { scale: 0, opacity: 0, duration: 0.04, ease: 'back.out(3)' }, at)
        const words = SplitText.create(side.querySelector('h3')!, { type: 'words', mask: 'words' }).words
        tl.from(words, { yPercent: 110, stagger: 0.008, duration: 0.05 }, at + 0.01)
        const ls = SplitText.create(side.querySelector('p')!, { type: 'lines', mask: 'lines' }).lines
        tl.from(ls, { yPercent: 110, opacity: 0, stagger: 0.012, duration: 0.05 }, at + 0.04)
      }
      // 글 카드(공문 초안 · 단가 확인): 줄이 하나씩 올라오며 써진다
      const lines = (tl: TL, card: HTMLElement, at: number) => {
        card.querySelectorAll<HTMLElement>('.memo-demo > *').forEach((node, i) => {
          if (node.tagName === 'P' && (node.textContent?.length ?? 0) > 40) {
            const ls = SplitText.create(node, { type: 'lines', mask: 'lines' }).lines
            tl.from(ls, { yPercent: 110, stagger: 0.02, duration: 0.06 }, at + i * 0.04)
          } else tl.from(node, { y: 24, opacity: 0, duration: 0.06 }, at + i * 0.04)
        })
      }

      const diag = el.querySelector<HTMLElement>('#diag')
      if (diag) stage(diag,
        // 기준이 저절로 바뀐다: 걷는 시간 15분 → 5분(덜 닿음) → 30분(더 닿음) → 15분, 버스 3번 → 6번 → 1번 → 3번
        (tl) => {
          const crit = { walk: 15, runs: 3 }
          let last = ''
          const push = () => { const w = Math.round(crit.walk), r = Math.round(crit.runs), k = `${w}/${r}`; if (k !== last) { last = k; criteria.set?.(w, r) } }
          tl.to(crit, { walk: 5, runs: 6, duration: 0.1, onUpdate: push }, 0.34)
            .to(crit, { walk: 30, runs: 1, duration: 0.12, onUpdate: push }, 0.44)
            .to(crit, { walk: 15, runs: 3, duration: 0.06, onUpdate: push }, 0.56)
        },
        // 마을 점이 자기 칸으로 날아가 모이고 칸 색이 켜진다
        (tl, card) => {
          card.querySelectorAll<SVGElement>('.agg-pt').forEach((p) => tl.fromTo(p, { x: 0, y: 0 }, { x: Number(p.dataset.dx), y: Number(p.dataset.dy), duration: 0.16 }, 0.76))
          tl.fromTo(card.querySelectorAll('.agg-pt'), { opacity: 1 }, { opacity: 0, duration: 0.06 }, 0.9)
            .fromTo(card.querySelectorAll('.agg-cell'), { opacity: 0 }, { opacity: 1, duration: 0.1 }, 0.86)
        })

      const plan = el.querySelector<HTMLElement>('#plan')
      if (plan) {
        const tl = stage(plan,
          // 대안 세 개: 하나씩 옆에서 들어오고 달성률 막대가 차오른다
          (tl, card) => {
            card.querySelectorAll<HTMLElement>('.mini-plan').forEach((m, i) => tl.from(m, { x: 80, opacity: 0, duration: 0.06 }, 0.32 + i * 0.06))
            card.querySelectorAll<HTMLElement>('.plan-bar').forEach((b, i) => tl.fromTo(b, { width: 0 }, { width: `${b.dataset.w}%`, duration: 0.1 }, 0.36 + i * 0.07))
          },
          // 정책이 놓이는 지도: 핀이 하나씩 떨어지고, 핀에서 가까운 칸부터 초록으로 바뀌고, 남는 공백 숫자가 줄어든다
          (tl, card) => {
            tl.from(card.querySelectorAll('.drop-pin'), { attr: { r: 0 }, duration: 0.05, stagger: 0.015, ease: 'back.out(3)' }, 0.74)
            const svg = card.querySelector('svg.scrub')
            if (svg) spread(svg, tl, 0.78, 0.18)
            const n = card.querySelector<HTMLElement>('[data-count]')
            if (n) count(n, tl, 0.78, 0.18)
          })
        // 검정 쇼케이스는 둥근 창이 화면 가득 펼쳐지며 시작한다
        tl?.fromTo(plan, { clipPath: 'inset(6% 5% round 48px)' }, { clipPath: 'inset(0% 0% round 0px)', duration: 0.12 }, 0)
      }

      const report = el.querySelector<HTMLElement>('#report')
      if (report) stage(report, (tl, card) => lines(tl, card, 0.32), (tl, card) => lines(tl, card, 0.76))

      // ---- 데이터 출처: 제목 단어가 솟고, 띠 두 줄은 스크롤하는 만큼 서로 반대로 흐르며 빠르게 내리면 기울어진다. 아이콘 선이 그려진다 ----
      const src = SplitText.create('.sources-sec h2', { type: 'words', mask: 'words' })
      gsap.from(src.words, { yPercent: 110, stagger: 0.08, ease: 'none', scrollTrigger: st('.sources-sec h2') })
      gsap.utils.toArray<HTMLElement>('.marquee-row').forEach((row, i) => gsap.fromTo(row, { xPercent: i ? -30 : 0 }, { xPercent: i ? 0 : -30, ease: 'none', scrollTrigger: st('.marquee', 'top bottom', 'bottom top') }))
      const skew = gsap.quickTo('.marquee', 'skewX', { duration: 0.4, ease: 'power3' })
      ScrollTrigger.create({ trigger: '.marquee', start: 'top bottom', end: 'bottom top', onUpdate: (s) => skew(gsap.utils.clamp(-8, 8, s.getVelocity() / -300)), onLeave: () => skew(0), onLeaveBack: () => skew(0) })
      gsap.from('.essentials li', { y: 50, opacity: 0, stagger: 0.1, ease: 'none', scrollTrigger: st('.essentials') })
      gsap.from('.essentials svg *', { drawSVG: 0, stagger: 0.04, ease: 'none', scrollTrigger: st('.essentials', 'top 90%', 'top 50%') })

      // 자주 묻는 질문 · 마지막(푸터)은 움직이지 않는다

      ScrollTrigger.refresh()
      return () => el.querySelectorAll('.showcase.stage').forEach((s) => s.classList.remove('stage'))
    })
  }, { scope: root, dependencies: [ready] })
}
