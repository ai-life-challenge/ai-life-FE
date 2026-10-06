// 첫 화면(랜딩). Krepling 구성을 따른다: 히어로 → 선언문 → 쇼케이스(회색/검정 번갈아) → 데이터 출처 마키 → FAQ → 검정 푸터.
// 애니메이션은 화면에 들어올 때 한 번만 재생한다 (마키만 천천히 흐르고, 마우스를 올리면 멈춘다).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { COUNTIES, buildModel, diagnose, type Model } from '../api/mock'
import { loadMyeon } from '../store'
import { timeColor, cssColor } from '../map/colors'
import { useCountUp, fmt } from '../motion/useCountUp'
import { tween } from '../motion/tween'
import { defaultAssumptions, planSet, summarize, type Plan } from '../api/plans'
import { AiBadge } from '../ui/Badges'

const fade = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } } } as const
const stagger = { show: { transition: { staggerChildren: 0.1 } } }
const GOAL = { service: 'med', mode: 'bus', age: 'a80', T: 30, target: 0.9, budget: 6, allowed: { fix: true, tour: true, drt: true, taxi: true, tele: true } } as const

const SHOWCASES = [
  { id: 'diag', name: '공백 진단' },
  { id: 'plan', name: '대안 비교' },
  { id: 'memo', name: '검토 메모' },
]

export function Landing() {
  const nav = useNavigate()
  const start = () => nav('/start')
  const [m, setM] = useState<Model | null>(null)
  useEffect(() => { loadMyeon().then((g) => setM(buildModel(COUNTIES[0], g.features))) }, [])
  // 창녕 기본 목표(80세 이상 90%, 버스 30분, 연 6억)로 계산한 실제 세 안. 카드 그림의 숫자는 모두 여기서 온다
  const plans = useMemo(() => (m ? planSet(m, { ...GOAL, allowed: { ...GOAL.allowed } }, defaultAssumptions()) : null), [m])
  const rootRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div ref={rootRef} className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <header className="land-nav">
        <span className="logo"><span className="logo-mark">V</span>VillageCoverage</span>
        <nav>
          <a href="#diag">공백 진단</a>
          <a href="#plan">대안 비교</a>
          <a href="#memo">검토 메모</a>
          <a href="#faq">자주 묻는 질문</a>
          <button className="dark-btn small-btn" onClick={start}>서비스 시작하기</button>
        </nav>
      </header>

      <section className="wrap land-hero">
        <p className="hero-tagline">클릭 몇 번으로, 마을 단위 공급 계획.</p>
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p className="eyebrow" variants={fade}>2026 AI 라이프 솔루션 챌린지</motion.p>
          <motion.h1 variants={fade}>인구가 적은 지역을 위한 가장 친절한 생활서비스 계획 도구.</motion.h1>
          <motion.p className="lead" variants={fade}>병원·약국·가게까지 걸리는 시간을 500m 격자로 진단하고, 예산 안에서 세 가지 공급안을 비교해 추천합니다. 결재용 검토 메모까지 한 번에.</motion.p>
          <motion.div className="row" variants={fade}>
            <motion.button className="primary big-btn" onClick={start} whileTap={{ scale: 0.97 }}>서비스 시작하기</motion.button>
            <a className="ghost big-btn" href="#diag">기능 둘러보기</a>
          </motion.div>
          <motion.p className="muted small" variants={fade}>시제품 · 경남 창녕·의령·함안 · 인구·시설·버스는 가상 데이터</motion.p>
        </motion.div>
        <UnfoldMap m={m} />
      </section>

      <section className="wrap statement">
        <motion.p className="say center" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7 }}>
          군 평균은 괜찮아 보여도, <span className="grad">평균에 가려진 마을까지</span> 계획에 넣습니다.
        </motion.p>
        <motion.div className="stat-grid" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.4 }} variants={stagger}>
          <Stat value={89} unit="곳" label="인구감소지역" note="행정안전부 지정(2021)" />
          <Stat value={73.5} unit="%" digits={1} label="소매점이 없는 행정리" note="2020 농림어업총조사" />
          <Stat value={88.5} unit="분" digits={1} label="면 지역 평균 버스 배차간격" note="농촌진흥청 2024 복지실태조사" />
        </motion.div>
      </section>

      {/* 바로 가기 탭은 세 쇼케이스 안에서만 붙어 다닌다 */}
      <div className="showcases">
      <SecNav root={rootRef} />

      <Showcase id="diag" tone="light" icon="◎" title="공백 진단" lead="서비스·이동 수단·연령을 고르면, 500m 칸마다 걸리는 시간을 색으로 보여 줘요.">
        <SCard title="시간 스윕으로 어디까지 닿는지" text="기준 시간을 0분부터 흘려 보내면 시설에서 가까운 칸부터 켜져요. 끝까지 꺼져 있는 칸이 곧 공백이에요." visual={<SweepDemo />} tone="pb" />
        <SCard black title="가려진 인구는 AI가 채워요" text="통계에서 5명 미만이라 가려진 격자 인구를 건물·도로 정보로 추정해요. 지도에서는 빗금으로 구분해 담당자가 알 수 있게 해요." visual={<HatchDemo />} tone="gr" ai />
      </Showcase>

      <Showcase id="plan" tone="dark" icon="◇" title="대안 비교" lead="목표와 예산을 정하면 세 가지 안을 같은 기준으로 계산하고, 버티는 안을 추천해요.">
        <SCard title="시설 · 이동형 · 최소 비용, 세 가지 안" text="목표를 지키고 원격 효과가 낮아지거나 단가가 올라도 버티는 안 가운데 가장 싼 안을 추천해요." visual={<MiniPlans plans={plans} />} tone="pa" />
        <SCard black title="공급이 놓이는 모습을 지도에" text="고른 안의 보건진료소·순회 버스·수요응답형 권역이 하나씩 놓이고, 새로 닿는 칸이 번져요." visual={<DropDemo />} tone="gr" />
      </Showcase>

      <Showcase id="memo" tone="light" icon="▤" title="검토 메모" lead="궁금한 건 말로 묻고, 고른 안은 결재용 문서로 바로 만들어요.">
        <SCard title="말로 묻고, 계산 근거와 함께 답을 받아요" text="AI가 공백 진단·대안 계산 도구를 골라 부르고, 도구가 낸 숫자로만 답해요. 조건이 빠지면 먼저 되물어요." visual={<ChatDemo m={m} />} tone="pb" ai />
        <SCard black title="숫자 대조 검사가 있는 결재 메모" text="현황·대안·권고·한계를 공문 순서로 쓰고, 고친 문단의 숫자가 계산 결과와 맞는지 확인해요." visual={<MemoDemo plans={plans} />} tone="gr" ai />
      </Showcase>
      </div>

      <section className="sources-sec">
        <div className="wrap">
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>흩어진 공공데이터를, <span className="grad">마을 단위로 한곳에.</span></motion.h2>
        </div>
        <Marquee />
        <div className="wrap">
          <ul className="essentials">
            {[['◷', '모든 숫자에 출처와 기준일'], ['◐', '정밀 · 추정 데이터 구분'], ['✎', '가정값은 표시하고 고칠 수 있게'], ['⛨', '개인 단위 정보는 저장하지 않음'], ['⇩', 'PDF 검토 메모 내보내기'], ['Aa', '고령자도 읽기 쉬운 큰 글씨']].map(([i, t]) => (
              <li key={t}><i>{i}</i>{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="faq-sec" id="faq">
        <div className="wrap">
          <h2>자주 묻는 질문</h2>
          <Faq />
        </div>
      </section>

      <footer className="land-foot">
        <div className="wrap">
          <h2>우리 군의 공백부터 확인해 보세요</h2>
          <motion.button className="primary big-btn" onClick={start} whileTap={{ scale: 0.97 }}>서비스 시작하기</motion.button>
          <div className="foot-grid">
            <div><h4>서비스</h4><p>공백 진단</p><p>목표 · 대안 · 추천</p><p>검토 메모 · AI 질문</p></div>
            <div><h4>데이터</h4><p>행정 경계: 통계청 SGIS 기반 admdongkor 2026.7 (CC BY 4.0)</p><p>지도: OpenFreeMap, © OpenStreetMap 기여자</p></div>
            <div><h4>시제품 안내</h4><p>읍면 경계만 실제이고 인구·시설·버스·단가는 가상 데이터예요.</p><p>2026 AI 라이프 솔루션 챌린지 출품작</p></div>
          </div>
        </div>
      </footer>
    </motion.div>
  )
}

// 쇼케이스 바로 가기. 지금 보고 있는 쇼케이스를 검정으로 표시한다
function SecNav({ root }: { root: React.RefObject<HTMLDivElement | null> }) {
  const [on, setOn] = useState<string | null>(null)
  useEffect(() => {
    // 쇼케이스 위(선언문)로 돌아오면 아무 탭도 켜지 않는다
    const els = [...SHOWCASES.map((x) => document.getElementById(x.id)), document.querySelector('.statement')].filter(Boolean) as HTMLElement[]
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setOn(e.target.id || null)), { root: root.current, rootMargin: '-45% 0px -45% 0px' })
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [root])
  return (
    <nav className="sec-nav" aria-label="기능 바로 가기">
      <div>{SHOWCASES.map((x) => <a key={x.id} href={`#${x.id}`} className={on === x.id ? 'on' : ''}>{x.name}</a>)}</div>
    </nav>
  )
}

function Showcase({ id, tone, icon, title, lead, children }: { id: string; tone: 'light' | 'dark'; icon: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`showcase ${tone}`}>
      <div className="wrap">
        <motion.div className="show-head" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7 }}>
          <span className="show-icon" aria-hidden>{icon}</span>
          <h2>{title}</h2>
          <p>{lead}</p>
        </motion.div>
        <div className="stack">{children}</div>
      </div>
    </section>
  )
}

// 쌓이는 기능 카드 (흰/검정 번갈아). 스크롤하면 위쪽에 붙어 다음 카드가 덮는다
function SCard({ title, text, visual, black, tone, ai }: { title: string; text: string; visual: React.ReactNode; black?: boolean; tone: 'pa' | 'pb' | 'gr'; ai?: boolean }) {
  return (
    <motion.article className={`scard ${black ? 'black' : ''}`} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
      <div>
        {ai && <AiBadge />}
        <h3 style={{ marginTop: ai ? 12 : 0 }}>{title}</h3>
        <p>{text}</p>
      </div>
      <div className={`scard-visual ${tone}`}>{visual}</div>
    </motion.article>
  )
}

// 시간 스윕 미니 그림: 두 시설에서 가까운 칸부터 초록으로 켜지고, 기준(30분)을 넘는 칸은 빨강으로 남는다
function SweepDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const cells = useMemo(() => Array.from({ length: 14 * 8 }, (_, i) => {
    const x = i % 14, y = Math.floor(i / 14)
    const t = Math.min(Math.hypot(x - 3, y - 2), Math.hypot(x - 10, y - 5)) * 7 // 분
    return { t, fill: cssColor(t / 30) }
  }), [])
  return (
    <div ref={ref} className="sweep-demo" role="img" aria-label="시설에서 가까운 칸부터 켜지는 시간 스윕">
      {cells.map((c, i) => <i key={i} style={{ background: inView ? c.fill : undefined, transitionDelay: inView ? `${c.t * 0.04}s` : '0s' }} />)}
    </div>
  )
}

// AI가 채운 칸(빗금) 미니 그림
function HatchDemo() {
  const cells = useMemo(() => Array.from({ length: 10 * 6 }, (_, i) => ({ ai: (i * 37) % 7 === 0 || (i * 13) % 11 === 0, t: ((i * 29) % 50) / 30 })), [])
  return (
    <div className="sweep-demo" style={{ gridTemplateColumns: 'repeat(10, 1fr)' }} role="img" aria-label="빗금으로 표시한 AI 추정 칸">
      {cells.map((c, i) => <i key={i} style={{ background: c.ai ? `repeating-linear-gradient(45deg, #fff 0 1.5px, ${cssColor(c.t)} 1.5px 5px)` : cssColor(c.t), opacity: c.ai ? 1 : 0.55 }} />)}
    </div>
  )
}

// 세 안 미니 그림: 실제 계산 결과의 달성률 막대가 화면에 들어오면 자란다
function MiniPlans({ plans }: { plans: Plan[] | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  if (!plans) return <div ref={ref} />
  return (
    <div ref={ref} className="mini-plans">
      {plans.map((p, k) => (
        <div key={p.id} className={`mini-plan ${p.recommended ? 'rec' : ''}`}>
          <div className="row"><b>{p.id} · {p.name}</b>{p.recommended && <span className="badge rec-badge">★ 추천</span>}</div>
          <div className="bar">
            <span className="bar-base" style={{ width: `${p.base * 100}%` }} />
            <motion.span className="bar-gain" initial={{ width: `${p.base * 100}%` }} animate={{ width: inView ? `${p.rate * 100}%` : `${p.base * 100}%` }} transition={{ duration: 1, delay: 0.2 + k * 0.15, ease: [0.16, 1, 0.3, 1] }} />
            <span className="bar-target" style={{ left: '90%' }} />
          </div>
          <span className="muted">달성률 {(p.rate * 100).toFixed(1)}% · 연 {p.year.toFixed(1)}억</span>
        </div>
      ))}
    </div>
  )
}

// 공급이 놓이는 미니 그림: 권역 원이 퍼지고 핀이 하나씩 떨어진다 (한 번)
function DropDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const pins = [[90, 70, '#7c4dc4'], [170, 110, '#16968c'], [60, 150, '#e99714'], [200, 50, '#d64541']] as const
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox="0 0 260 200" style={{ width: '100%' }} role="img" aria-label="공급 위치가 하나씩 놓이는 지도 그림">
        <rect width="260" height="200" rx="10" fill="#1f1f1f" />
        {Array.from({ length: 13 * 10 }, (_, i) => <rect key={i} x={(i % 13) * 20 + 2} y={Math.floor(i / 13) * 20 + 2} width="16" height="16" rx="3" fill={inView && Math.hypot((i % 13) * 20 - 90, Math.floor(i / 13) * 20 - 70) < 70 ? '#2f5bd3' : '#3a2a2a'} style={{ transition: 'fill .6s', transitionDelay: `${0.6 + Math.hypot((i % 13) * 20 - 90, Math.floor(i / 13) * 20 - 70) * 0.008}s` }} />)}
        <motion.circle cx="90" cy="70" fill="rgba(124,77,196,.18)" stroke="#9c74e0" strokeWidth="1.5" initial={{ r: 0 }} animate={{ r: inView ? 70 : 0 }} transition={{ duration: 1, delay: 0.3 }} />
        {pins.map(([x, y, c], k) => (
          <motion.circle key={k} cx={x} cy={y} fill={c} stroke="#fff" strokeWidth="3" initial={{ r: 0 }} animate={{ r: inView ? 8 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.4 + k * 0.35 }} />
        ))}
      </svg>
    </div>
  )
}

// 검토 메모 미니 그림: 실제 추천안 숫자로 쓴 권고 문단 + 숫자 대조 배지
function MemoDemo({ plans }: { plans: Plan[] | null }) {
  const rec = plans?.find((p) => p.recommended)
  return (
    <div className="memo-demo">
      <p className="muted small" style={{ margin: 0 }}>검토 메모 · 3. 권고</p>
      {rec ? <p style={{ margin: '6px 0 12px' }}><b>{rec.name}</b>을 권고한다. {summarize(rec, 'med')}을 두면 80세 이상 달성률이 {(rec.base * 100).toFixed(1)}%에서 {(rec.rate * 100).toFixed(1)}%로 오른다. 연 비용은 {rec.year.toFixed(1)}억이다.</p> : <p>…</p>}
      <span className="badge" style={{ color: 'var(--ok)' }}>✓ 숫자 대조 검사 통과</span>
    </div>
  )
}

// 데이터 출처 마키: 두 줄이 반대로 천천히 흐르고, 마우스를 올리면 멈춘다 (동작 줄이기면 멈춘 격자)
const SOURCES: [string, string, string][] = [
  ['SGIS 격자 인구', '통계청', '#cfe2fb'], ['주민등록 인구', '행정안전부', '#f6d8cf'], ['병의원·약국', '건강보험심사평가원', '#c9f0da'],
  ['버스정류소·노선', 'TAGO', '#dccbfa'], ['농어촌버스 시각', '군청', '#fde7b0'], ['경로당·마을회관', '표준데이터', '#f9d2e4'],
  ['보건기관 목록', '도청', '#d6f0f7'], ['도로망', 'OpenStreetMap', '#e3e3e3'], ['국토통계지도', '국토지리정보원', '#e6dcfa'],
  ['장래인구추계', '국가데이터처', '#d9f2c2'], ['행정 경계', 'SGIS · admdongkor', '#ffd9c2'], ['농어촌서비스기준', '농림축산식품부', '#cde9e3'],
]
function Marquee() {
  const rows = [SOURCES.slice(0, 6), SOURCES.slice(6)]
  return (
    <div className="marquee" aria-label="쓰는 공공데이터">
      {rows.map((row, r) => (
        <div key={r} className={`marquee-row ${r ? 'rev' : ''}`}>
          {[0, 1].map((copy) => row.map(([name, org, bg]) => (
            <div key={`${copy}-${name}`} className={`mtile ${copy ? 'dup' : ''}`} style={{ background: bg }} aria-hidden={copy ? true : undefined}>
              <span>{name}<small>{org}</small></span>
            </div>
          )))}
        </div>
      ))}
    </div>
  )
}

const FAQS: [string, string][] = [
  ['AI가 숫자를 지어내지 않나요?', '계산은 공백 진단·대안 계산 같은 도구가 하고, AI는 어떤 도구를 어떤 조건으로 부를지 정하고 결과를 설명하는 일만 해요. 답과 메모의 숫자는 도구 결과에 있는 값만 쓰고, 메모는 숫자 대조 검사를 거쳐요.'],
  ['데이터는 어디서 오나요?', 'SGIS 격자 인구, 주민등록 인구, 심평원 병의원·약국, TAGO와 군청 버스 시각표, 경로당·마을회관 표준데이터, OpenStreetMap 도로망 같은 공공데이터를 마을 단위로 합쳐요. 모든 숫자에 출처와 기준일을 붙여요.'],
  ['개인정보는 어떻게 다루나요?', '개인 단위 정보는 저장하지 않아요. 담당자가 올린 파일은 브라우저 안에서 처리하고, 서버에는 마을 단위 합계만 보내요. 연락처 같은 개인정보 열은 먼저 빼요.'],
  ['기준 시간 30분은 공식 기준인가요?', '농어촌서비스기준의 분 단위 목표치가 아직 확인되지 않아 가정값으로 써요. 화면에 가정값이라고 표시하고, 가정과 단가 화면에서 고칠 수 있어요.'],
  ['다른 군도 쓸 수 있나요?', '전국 공통 공공데이터를 쓰기 때문에 같은 방식으로 다른 인구감소지역에도 넓힐 수 있어요. 시제품은 데이터 수준이 서로 다른 경남 창녕·의령·함안으로 만들었어요.'],
]
function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <div className="faq">
      {FAQS.map(([q, a], i) => (
        <div key={q} className="faq-item">
          <button className="faq-q" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{q}<span aria-hidden>⌄</span></button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }}>
                <p>{a}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

function Stat({ value, unit, label, note, digits = 0 }: { value: number; unit: string; label: string; note: string; digits?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const v = useCountUp(inView ? value : 0, 1400)
  return (
    <motion.div ref={ref} className="stat" variants={fade}>
      <p className="stat-num">{v.toFixed(digits)}<small>{unit}</small></p>
      <p><b>{label}</b></p>
      <p className="muted small">{note}</p>
    </motion.div>
  )
}

// 창녕의 실제 모양 위에서, 군 평균 한 색 → 500m 격자로 펼쳐지는 장면. 가운데에서 바깥으로 물결처럼 번진다
function UnfoldMap({ m }: { m: Model | null }) {
  const [unfolded, setUnfolded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!m || !inView) return
    const t = setTimeout(() => setUnfolded(true), reduce ? 0 : 1300)
    return () => clearTimeout(t)
  }, [m, inView, reduce])
  const view = useMemo(() => {
    if (!m) return null
    const d = diagnose(m, 'med', 'bus', 'a80', 30)
    const W = Math.max(...m.cells.map((c) => c.cx)) + 0.5, H = Math.max(...m.cells.map((c) => c.cy)) + 0.5
    const avg = cssColor(d.avgMinutes / 30)
    const cells = m.cells.map((c) => {
      const [r, g, b] = timeColor(d.times[c.i] / 30)
      return { x: c.cx - 0.25, y: c.cy - 0.25, fill: c.pop === 0 ? '#e7e4dc' : `rgb(${r | 0},${g | 0},${b | 0})`, delay: Math.hypot(c.cx - W / 2, c.cy - H / 2) * 0.045 }
    })
    return { W, H, avg, cells, d }
  }, [m])
  const avgMin = useCountUp(view && inView ? view.d.avgMinutes : 0, 1000)
  const gap = useCountUp(view && unfolded ? view.d.gap : 0, 1200)
  return (
    <motion.div ref={ref} className="hero-visual" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.7 }}>
      {view ? (
        <svg viewBox={`-1 -1 ${view.W + 2} ${view.H + 2}`} role="img" aria-label="창녕군을 군 평균 한 색에서 500m 격자로 펼친 지도">
          {view.cells.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={0.5} height={0.5} className="ucell"
              style={{ fill: unfolded ? c.fill : view.avg, transitionDelay: unfolded ? `${c.delay}s` : '0s' }} />
          ))}
        </svg>
      ) : <div className="hero-ph" />}
      <div className="hero-tags">
        <motion.span className="tag" animate={{ opacity: unfolded ? 0.45 : 1 }}>창녕군 평균 <b>{Math.round(avgMin)}분</b></motion.span>
        <motion.span className="tag bad" initial={{ opacity: 0, y: 8 }} animate={{ opacity: unfolded ? 1 : 0, y: unfolded ? 0 : 8 }} transition={{ delay: 0.8 }}>
          30분 넘는 80세 이상 <b>{fmt(gap)}명</b>
        </motion.span>
      </div>
      <button className="link replay" onClick={() => { setUnfolded(false); setTimeout(() => setUnfolded(true), 900) }}>↻ 다시 보기</button>
    </motion.div>
  )
}

// 정책 질의 예시: 질문 → 도구 호출(✓) → 답이 타이핑된다. 화면에 들어올 때 한 번
function ChatDemo({ m }: { m: Model | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const [step, setStep] = useState(0)
  const [n, setN] = useState(0)
  // 답의 숫자는 실제 서비스와 같은 계산(창녕, 기본 목표)에서 가져온다
  const answer = useMemo(() => {
    if (!m) return ''
    const c = planSet(m, { service: 'med', mode: 'bus', age: 'a80', T: 30, target: 0.9, budget: 30, allowed: { fix: true, tour: true, drt: true, taxi: true, tele: true } }, defaultAssumptions()).find((p) => p.id === 'C')!
    return `최소 예산은 연 ${c.year.toFixed(1)}억이에요. ${summarize(c, 'med')}으로 ${(c.base * 100).toFixed(1)}%에서 ${(c.rate * 100).toFixed(1)}%까지 올라가요.`
  }, [m])
  useEffect(() => {
    if (!inView || !answer) return
    const ts = [setTimeout(() => setStep(1), 400), setTimeout(() => setStep(2), 1300), setTimeout(() => setStep(3), 2100), setTimeout(() => setStep(4), 2700)]
    return () => ts.forEach(clearTimeout)
  }, [inView, answer])
  useEffect(() => { if (step >= 4) return tween(0, answer.length, 1800, (v) => setN(Math.round(v)), { ease: (x) => x }) }, [step, answer])
  return (
    <div ref={ref} className="chat-demo">
      <p className="muted small"><span className="spark">✦</span> 정책 질의 AI</p>
      {step >= 1 && <motion.p className="me" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>80세 이상 어르신 90%가 30분 안에 병원에 가려면 예산이 최소 얼마예요?</motion.p>}
      {step >= 2 && (
        <motion.ul className="tools-demo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <li><span className={step >= 3 ? 'ok' : 'spin'}>{step >= 3 ? '✓' : ''}</span><code>diagnose(의료, 버스, 80세 이상, 30분)</code></li>
          {step >= 3 && <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}><span className={step >= 4 ? 'ok' : 'spin'}>{step >= 4 ? '✓' : ''}</span><code>optimize(min_cost, 목표 90%)</code></motion.li>}
        </motion.ul>
      )}
      {step >= 4 && <p className="ai-text">{answer.slice(0, n)}{n < answer.length && <span className="caret" />}</p>}
    </div>
  )
}
