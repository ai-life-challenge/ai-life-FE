// S0 인트로: 3초 안에 문제를 체감시키는 첫 장면. 숫자는 서버가 창녕군(기본 기준)으로 실제 계산한 값이다.
// 열릴 때 GSAP 연출이 한 번 재생된다: 배경 빛이 번지고 → 제목 단어가 솟고 '6억'이 튀어나오고 → 숫자 줄이 하나씩 양옆 선이 그어지며 나타나 숫자가 올라가고 → 버튼(처음부터 보임)에 빛이 한 번 퍼진다
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { api, cached, regionData } from '../api/client'
import { fmt } from '../api/meta'
import type { Judge } from '../api/types'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(SplitText, useGSAP)
const MOTION_OK = 'all' // 움직임 줄이기 설정과 상관없이 연출을 보여 준다(윈도우 애니메이션 효과가 꺼진 PC에서도)

const REGION = '48740'
const load = () => cached('intro-facts', async () => {
  const { defaultState: state } = await api.regions()
  const [judge, data] = await Promise.all([api.judge({ region: REGION, state }), regionData(REGION)])
  return { judge, name: data.name }
})

export function Intro() {
  const nav = useNavigate()
  const [f, setF] = useState<{ judge: Judge; name: string } | null>(null)
  useEffect(() => { let live = true; load().then((x) => live && setF(x), () => {}); return () => { live = false } }, [])
  const root = useRef<HTMLElement>(null)
  const top = f?.judge.top[0]

  // 제목 · 배경: 열리자마자
  useGSAP(() => {
    gsap.matchMedia().add(MOTION_OK, () => {
      const words = SplitText.create('.intro h1', { type: 'words', mask: 'words' }).words
      gsap.timeline({ defaults: { ease: 'expo.out' } })
        .from('.intro .hero-blobs i', { scale: 0, opacity: 0, duration: 2, stagger: 0.15 }, 0)
        .from(words, { yPercent: 115, rotate: 5, stagger: 0.07, duration: 1.1 }, 0.15)
        .from('.intro h1 .grad', { scale: 1.6, duration: 0.9, ease: 'back.out(2.5)' }, 0.5)
      gsap.utils.toArray<HTMLElement>('.intro .hero-blobs i').forEach((b, i) => gsap.to(b, { x: 'random(-80, 80)', y: 'random(-50, 50)', duration: 7 + i * 2, ease: 'sine.inOut', repeat: -1, yoyo: true, repeatRefresh: true }))
    })
  }, { scope: root })

  // 숫자 줄 · 버튼: 서버 숫자가 온 뒤에
  useGSAP(() => {
    if (!f) return
    const show = (n: HTMLElement, v: number) => { n.textContent = Math.round(v).toLocaleString('ko-KR') }
    gsap.matchMedia()
      .add(MOTION_OK, () => {
        const tl = gsap.timeline({ delay: 0.9, defaults: { ease: 'expo.out' } })
        gsap.utils.toArray<HTMLElement>('.intro .fact').forEach((fact, i) => {
          const at = i * 0.45
          tl.from(fact.querySelectorAll('.dash'), { scaleX: 0, duration: 0.8 }, at)
            .from(fact.querySelector('.fact-text'), { y: 24, opacity: 0, filter: 'blur(6px)', duration: 0.8 }, at + 0.05)
            .from(fact.querySelector('b'), { scale: 0.4, opacity: 0, duration: 0.7, ease: 'back.out(2.2)' }, at + 0.2)
          const n = fact.querySelector<HTMLElement>('[data-count]')
          if (n) { const o = { v: 0 }; show(n, 0); tl.to(o, { v: Number(n.dataset.count), duration: 1.2, ease: 'power2.out', onUpdate: () => show(n, o.v) }, at + 0.2) }
        })
        // 버튼은 처음부터 보인다. 숫자가 다 나오면 보라색 빛이 한 번 퍼져 눈길을 끈다
        tl.fromTo('.intro .big-btn', { boxShadow: '0 0 0 0 rgba(155,63,232,.55)' }, { boxShadow: '0 0 0 18px rgba(155,63,232,0)', duration: 1.2, ease: 'power2.out' }, '-=0.4')
      })
  }, { scope: root, dependencies: [f] })
  const facts = f ? [
    { pre: `${f.name} 80세 이상 ${fmt(f.judge.summary.total)}명 중 병원에 갈 수 없는 사람`, value: f.judge.summary.gap, unit: '명' },
    { pre: '버스도 병원도 닿지 못하는 마을', value: f.judge.summary.gapVillages, unit: '곳' },
    ...(top ? [{ pre: `가장 많은 사람이 닿지 못하는 ${top.name}`, value: top.people, unit: '명' }] : []),
  ] : []

  return (
    <motion.main ref={root} className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ y: '-100%', opacity: 0, transition: { duration: 0.5, ease: [0.7, 0, 0.3, 1] } }}>
      <div className="hero-blobs" aria-hidden><i /><i /><i /></div>
      <div>
        <h1>
          우리 군에 한 해 <span className="grad">6억</span>이 있다면,<br />어디에 써야 할까요?
        </h1>
        <div className="facts" aria-live="polite">
          {facts.map((x) => (
            <p key={x.pre} className="fact">
              <span className="dash" aria-hidden />
              <span className="fact-text">{x.pre}</span> <b><span data-count={x.value}>{fmt(x.value)}</span>{x.unit}</b>
              <span className="dash" aria-hidden />
            </p>
          ))}
        </div>
        <button className="primary big-btn" onClick={() => nav('/start')}>
          시뮬레이션 시작하기 →
        </button>
        <p className="foot">서버가 계산한 값 · 자가용 30분, 정류장 걸어서 15분, 버스 하루 3번 기준 · 전국 72개 시군구</p>
      </div>
    </motion.main>
  )
}
