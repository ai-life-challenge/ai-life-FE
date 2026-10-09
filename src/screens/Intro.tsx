// S0 인트로: 3초 안에 문제를 체감시키는 첫 장면. 3군 중 가장 극적인 지표 3개를 쓴다.
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { REGIONS } from '../data/regions'
import { STD } from '../sim/model'
import { Count } from '../ui/Count'
import { SrcBadge } from '../ui/Badges'

const maxBy = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a))
const er = maxBy(REGIONS, (r) => r.erMinutes)
const bus = maxBy(REGIONS, (r) => -r.minBusRuns)
const ar = maxBy(REGIONS, (r) => r.ar)

const FACTS = [
  { pre: '응급실까지', value: er.erMinutes, unit: '분', digits: 0, where: er.name, src: 'e30' },
  { pre: '하루 버스', value: bus.minBusRuns, unit: '대', digits: 0, where: bus.name, src: 'ms' },
  { pre: '교통사고 사망 전국 평균의', value: ar.ar / STD.natAR, unit: '배', digits: 1, where: ar.name, src: 'ar' },
]

export function Intro() {
  const nav = useNavigate()
  return (
    <motion.main className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ y: '-100%', opacity: 0, transition: { duration: 0.5, ease: [0.7, 0, 0.3, 1] } }}>
      <div>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          우리 군에 <span className="grad">100억</span>이 있다면,<br />어디에 써야 할까요?
        </motion.h1>
        <div className="facts">
          {FACTS.map((f, i) => (
            <motion.p key={f.pre} className="fact" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + i * 0.4 }}>
              <span className="dash" aria-hidden />
              {f.pre} <b><Count value={f.value} delay={600 + i * 400} format={(n) => n.toFixed(f.digits)} />{f.unit}</b>
              <span className="muted small">{f.where}</span>
              <SrcBadge kind="public" id={f.src} note="예시" />
              <span className="dash" aria-hidden />
            </motion.p>
          ))}
        </div>
        <motion.button className="primary big-btn" onClick={() => nav('/start')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 }} whileTap={{ scale: 0.97 }}>
          시뮬레이션 시작하기 →
        </motion.button>
        <p className="foot">공공데이터 기반 · AI 예산 편성 도우미 · 경남 창녕·의령·함안</p>
      </div>
    </motion.main>
  )
}
