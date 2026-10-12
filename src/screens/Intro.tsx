// S0 인트로: 3초 안에 문제를 체감시키는 첫 장면. 숫자는 서버가 청양군(기본 기준)으로 실제 계산한 값이다.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { api, cached, regionData } from '../api/client'
import { fmt } from '../api/meta'
import type { Judge } from '../api/types'
import { Count } from '../ui/Count'

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
  const top = f?.judge.top[0]
  const facts = f ? [
    { pre: `${f.name} 80세 이상 ${fmt(f.judge.summary.total)}명 중 병원에 갈 수 없는 사람`, value: f.judge.summary.gap, unit: '명' },
    { pre: '버스도 병원도 닿지 못하는 마을', value: f.judge.summary.gapVillages, unit: '곳' },
    ...(top ? [{ pre: `가장 많은 사람이 닿지 못하는 ${top.name}`, value: top.people, unit: '명' }] : []),
  ] : []

  return (
    <motion.main className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ y: '-100%', opacity: 0, transition: { duration: 0.5, ease: [0.7, 0, 0.3, 1] } }}>
      <div>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          우리 군에 한 해 <span className="grad">6억</span>이 있다면,<br />어디에 써야 할까요?
        </motion.h1>
        <div className="facts" aria-live="polite">
          {facts.map((x, i) => (
            <motion.p key={x.pre} className="fact" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 + i * 0.4 }}>
              <span className="dash" aria-hidden />
              {x.pre} <b><Count value={x.value} delay={600 + i * 400} />{x.unit}</b>
              <span className="dash" aria-hidden />
            </motion.p>
          ))}
        </div>
        <motion.button className="primary big-btn" onClick={() => nav('/start')} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 }} whileTap={{ scale: 0.97 }}>
          시뮬레이션 시작하기 →
        </motion.button>
        <p className="foot">서버가 계산한 값 · 자가용 30분, 정류장 걸어서 15분, 버스 하루 3번 기준 · 전국 72개 시군구</p>
      </div>
    </motion.main>
  )
}
