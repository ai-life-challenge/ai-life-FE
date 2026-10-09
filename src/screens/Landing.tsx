// 첫 화면(랜딩). 한 번 스크롤하면 한 화면씩 넘어간다(scroll-snap). VillageCoverage 시제품 랜딩과 같은 구성: 히어로 → 선언문 → 쇼케이스(회색/검정 번갈아) → 데이터 출처 마키 → FAQ → 검정 푸터.
// 내용은 이 서비스(현황 진단 · 예산안 3개 · AI 레포트)에 맞췄고, 카드 그림의 숫자는 모두 실제 계산(창녕, 100억)에서 온다.
// 애니메이션은 화면에 들어올 때 한 번만 재생한다 (마키만 천천히 흐르고, 마우스를 올리면 멈춘다).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react'
import { regionOf } from '../data/regions'
import { DEFAULT_COSTS, LEVERS, planSet, preset, type Plan } from '../sim/model'
import { diagnoseGrid, loadGrid, travel, type Grid } from '../map/grid'
import { timeColor, cssColor } from '../map/colors'
import { useCountUp, fmt } from '../motion/useCountUp'
import { tween } from '../motion/tween'
import { AiBadge } from '../ui/Badges'
import { Phrases } from '../ui/Phrases'

const fade = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } } } as const
const stagger = { show: { transition: { staggerChildren: 0.1 } } }
const CN = regionOf('48740')!

const SHOWCASES = [
  { id: 'diag', name: '현황 진단' },
  { id: 'plan', name: '예산안 비교' },
  { id: 'report', name: 'AI 레포트' },
]

export function Landing() {
  const nav = useNavigate()
  const start = () => nav('/intro')
  const [g, setG] = useState<Grid | null>(null)
  useEffect(() => { loadGrid(CN).then(setG) }, [])
  // 창녕 100억으로 계산한 실제 세 안. 카드 그림의 숫자는 모두 여기서 온다
  const plans = useMemo(() => planSet(CN, 100, DEFAULT_COSTS, 'mid'), [])
  const rootRef = useRef<HTMLDivElement>(null)

  return (
    <motion.div ref={rootRef} className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <header className="land-nav">
        <span className="logo"><span className="logo-mark">V</span>VillageCoverage</span>
        <nav>
          <a href="#diag">현황 진단</a>
          <a href="#plan">예산안 비교</a>
          <a href="#report">AI 레포트</a>
          <a href="#faq">자주 묻는 질문</a>
          <button className="dark-btn small-btn" onClick={start}>서비스 시작하기</button>
        </nav>
      </header>

      <section className="wrap land-hero snap">
        <p className="hero-tagline">클릭 몇 번으로, 근거 있는 예산안.</p>
        <motion.div initial="hidden" animate="show" variants={stagger}>
          <motion.p className="eyebrow" variants={fade}>2026 AI 라이프 솔루션 챌린지</motion.p>
          <motion.h1 variants={fade}><span className="phrase">우리 군에 100억이 있다면,</span> <span className="phrase">어디에 써야 할까요?</span></motion.h1>
          <motion.p className="lead" variants={fade}><Phrases text="응급실·버스·교통사고 지표를 정부 공식 기준으로 진단하고, AI가 예산안 세 가지를 만들어 비교·추천합니다. 근거와 출처가 담긴 레포트까지 한 번에." /></motion.p>
          <motion.div className="row" variants={fade}>
            <motion.button className="primary big-btn" onClick={start} whileTap={{ scale: 0.97 }}>서비스 시작하기</motion.button>
            <a className="ghost big-btn" href="#diag">기능 둘러보기</a>
          </motion.div>
          <motion.p className="muted small" variants={fade}>시제품 · 경남 창녕·의령·함안 · 지표 숫자는 예시값, 격자는 가상 데이터</motion.p>
        </motion.div>
        <UnfoldMap g={g} />
      </section>

      <section className="wrap statement snap">
        <motion.p className="say center" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7 }}>
          <span className="phrase">예산표로는 안 보이는 곳까지,</span> <span className="grad phrase">공식 기준으로 진단하고 숫자로 설명합니다.</span>
        </motion.p>
        <motion.div className="stat-grid" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.4 }} variants={stagger}>
          <Stat value={102} unit="곳" label="응급의료 취약지" note="NMC 2025 모니터링 · 250개 시군구 중" />
          <Stat value={12.3} unit="%" digits={1} label="응급실 30분 밖 주민 (전국 평균)" note="NMC 응급의료 취약지 모니터링" />
          <Stat value={29.9} unit="%" digits={1} label="대중교통 부족 법정리" note="대중교통현황조사 2023" />
        </motion.div>
      </section>

      {/* 바로 가기 탭은 세 쇼케이스 안에서만 붙어 다닌다 */}
      <div className="showcases">
      <SecNav root={rootRef} />

      <Showcase id="diag" tone="light" icon="◎" title="현황 진단" lead="응급실·대중교통·교통사고 지표 6개를 공식 기준선과 함께 보여 주고, 500m 격자로 누가 멀리 사는지 펼쳐요.">
        <SCard title="시간 스윕으로 응급실까지 어디까지 닿는지" text="기준 시간을 0분부터 흘려 보내면 응급실에서 가까운 칸부터 켜져요. 끝까지 꺼져 있는 칸이 곧 응급의료 공백이에요." visual={<SweepDemo />} tone="pb" />
        <SCard black title="가려진 인구는 AI가 채워요" text="통계에서 5명 미만이라 가려진 격자 인구를 건물·도로 정보로 추정해요. 지도에서는 빗금으로 구분해 담당자가 알 수 있게 해요." visual={<HatchDemo />} tone="gr" ai />
      </Showcase>

      <Showcase id="plan" tone="dark" icon="◇" title="예산안 비교" lead="목표 세 가지로 예산을 1억씩 배분해 예산안 3개를 만들고, 같은 잣대로 재서 추천해요.">
        <SCard title="응급의료 · 균형 · 교통안전, 세 가지 안" text="1억씩 ‘그 순간 효과가 가장 큰 정책’에 배정하고, 종합 취약도 감소 × 수혜 인구가 가장 큰 안을 추천해요. 단가가 바뀌어도 결과 범위를 함께 보여 줘요." visual={<MiniPlans plans={plans} />} tone="pa" />
        <SCard black title="정책이 놓이는 모습을 지도에" text="고른 안의 응급 거점·버스 노선·DRT 권역이 하나씩 놓이고, 새로 응급실에 닿는 칸이 번져요." visual={<DropDemo />} tone="gr" />
      </Showcase>

      <Showcase id="report" tone="light" icon="▤" title="AI 레포트" lead="궁금한 건 말로 묻고, 고른 안은 근거와 출처가 담긴 레포트로 바로 만들어요.">
        <SCard title="말로 묻고, 계산 근거와 함께 답을 받아요" text="AI가 진단·배분 도구를 골라 부르고, 도구가 낸 숫자로만 답해요. 조건이 빠지면 먼저 되물어요." visual={<ChatDemo />} tone="pb" ai />
        <SCard black title="숫자 대조 체크가 있는 예산 편성안" text="현황·추천안·산출 근거·기대 효과·가정과 출처·3군 비교 순서로 쓰고, 모든 숫자가 계산 결과와 맞는지 확인해요." visual={<ReportDemo plans={plans} />} tone="gr" ai />
      </Showcase>
      </div>

      <section className="sources-sec snap">
        <div className="wrap">
          <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}><span className="phrase">흩어진 의료·교통·재정 데이터를,</span> <span className="grad phrase">군 예산 하나로.</span></motion.h2>
        </div>
        <Marquee />
        <div className="wrap">
          <ul className="essentials">
            {[['◷', '모든 숫자에 출처와 기준일'], ['◐', '공공데이터 · 가정값 구분'], ['✎', '가정값은 표시하고 고칠 수 있게'], ['⛨', '개인 단위 정보는 저장하지 않음'], ['⇩', 'PDF 레포트 내보내기'], ['Aa', '고령자도 읽기 쉬운 큰 글씨']].map(([i, t]) => (
              <li key={t}><i>{i}</i>{t}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="faq-sec snap" id="faq">
        <div className="wrap">
          <h2>자주 묻는 질문</h2>
          <Faq />
        </div>
      </section>

      <footer className="land-foot snap">
        <div className="wrap">
          <h2>우리 군의 예산부터 짜 보세요</h2>
          <motion.button className="primary big-btn" onClick={start} whileTap={{ scale: 0.97 }}>서비스 시작하기</motion.button>
          <div className="foot-grid">
            <div><h4>서비스</h4><p>현황 진단</p><p>예산안 비교 · What-if</p><p>AI 레포트 · AI 질문</p></div>
            <div><h4>데이터</h4><p>지표: KOSIS · NMC · 심평원 · TAGO · TAAS · 지방재정365</p><p>경계: 통계청 SGIS 기반 admdongkor 2026.7 (CC BY 4.0)</p><p>지도: OpenFreeMap, © OpenStreetMap 기여자</p></div>
            <div><h4>시제품 안내</h4><p><Phrases text="지표 숫자는 예시값이고, 격자의 마을·인구·버스는 가상 데이터예요." /></p><p>2026 AI 라이프 솔루션 챌린지 출품작</p></div>
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
      {/* 제목이 한 화면, 카드가 한 장씩 한 화면 */}
      <div className="wrap snap show-page">
        <motion.div className="show-head" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.7 }}>
          <span className="show-icon" aria-hidden>{icon}</span>
          <h2>{title}</h2>
          {/* 쉼표 단위로 묶어 문장 중간에서 줄이 끊기지 않게 */}
          <p><Phrases text={lead} /></p>
        </motion.div>
      </div>
      {children}
    </section>
  )
}

// 기능 카드 (흰/검정 번갈아). 카드 한 장이 한 화면이다
function SCard({ title, text, visual, black, tone, ai }: { title: string; text: string; visual: React.ReactNode; black?: boolean; tone: 'pa' | 'pb' | 'gr'; ai?: boolean }) {
  return (
    <div className="wrap snap show-page">
    <motion.article className={`scard ${black ? 'black' : ''}`} initial={{ opacity: 0, y: 40 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.3 }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
      <div>
        {ai && <AiBadge />}
        <h3 style={{ marginTop: ai ? 12 : 0 }}>{title}</h3>
        <p><Phrases text={text} /></p>
      </div>
      <div className={`scard-visual ${tone}`}>{visual}</div>
    </motion.article>
    </div>
  )
}

// 시간 스윕 미니 그림: 응급실 두 곳에서 가까운 칸부터 초록으로 켜지고, 기준(30분)을 넘는 칸은 빨강으로 남는다
function SweepDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const cells = useMemo(() => Array.from({ length: 14 * 8 }, (_, i) => {
    const x = i % 14, y = Math.floor(i / 14)
    const t = Math.min(Math.hypot(x - 3, y - 2), Math.hypot(x - 10, y - 5)) * 7 // 분
    return { t, fill: cssColor(t / 30) }
  }), [])
  return (
    <div ref={ref} className="sweep-demo" role="img" aria-label="응급실에서 가까운 칸부터 켜지는 시간 스윕">
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

// 세 안 미니 그림: 실제 계산 결과의 정책별 누적 막대가 화면에 들어오면 자란다
function MiniPlans({ plans }: { plans: Plan[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  return (
    <div ref={ref} className="mini-plans">
      {plans.map((p, k) => {
        const B = LEVERS.reduce((a, l) => a + p.opt.alloc[l.id], 0) || 1
        return (
          <div key={p.preset} className={`mini-plan ${p.recommended ? 'rec' : ''}`}>
            <div className="row"><b>{preset(p.preset).icon} {preset(p.preset).name}</b>{p.recommended && <span className="badge rec">⭐ AI 추천</span>}</div>
            <div className="stack" style={{ height: 14 }}>
              {LEVERS.filter((l) => p.opt.alloc[l.id] > 0).map((l) => (
                <motion.span key={l.id} style={{ background: l.color }} initial={{ width: 0 }} animate={{ width: inView ? `${(p.opt.alloc[l.id] / B) * 100}%` : 0 }} transition={{ duration: 0.9, delay: 0.2 + k * 0.15, ease: [0.16, 1, 0.3, 1] }} />
              ))}
            </div>
            <span className="muted">종합 취약도 {Math.round(p.neutral.before)}→{Math.round(p.neutral.after)}점 · 수혜 {fmt(p.benefit)}명</span>
          </div>
        )
      })}
    </div>
  )
}

// 정책이 놓이는 미니 그림: DRT 권역 원이 퍼지고 응급 거점·버스·DRT 핀이 하나씩 떨어진다 (한 번)
function DropDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  const col = (id: string) => LEVERS.find((l) => l.id === id)!.color
  const pins = [[90, 70, col('drt')], [170, 110, col('er')], [60, 150, col('bus')], [200, 50, col('er')]] as const
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox="0 0 260 200" style={{ width: '100%' }} role="img" aria-label="정책 위치가 하나씩 놓이는 지도 그림">
        <rect width="260" height="200" rx="10" fill="#1f1f1f" />
        {Array.from({ length: 13 * 10 }, (_, i) => <rect key={i} x={(i % 13) * 20 + 2} y={Math.floor(i / 13) * 20 + 2} width="16" height="16" rx="3" fill={inView && Math.hypot((i % 13) * 20 - 90, Math.floor(i / 13) * 20 - 70) < 70 ? '#2f5bd3' : '#3a2a2a'} style={{ transition: 'fill .6s', transitionDelay: `${0.6 + Math.hypot((i % 13) * 20 - 90, Math.floor(i / 13) * 20 - 70) * 0.008}s` }} />)}
        <motion.circle cx="90" cy="70" fill="rgba(20,149,143,.18)" stroke="#3cc0b9" strokeWidth="1.5" initial={{ r: 0 }} animate={{ r: inView ? 70 : 0 }} transition={{ duration: 1, delay: 0.3 }} />
        {pins.map(([x, y, c], k) => (
          <motion.circle key={k} cx={x} cy={y} fill={c} stroke="#fff" strokeWidth="3" initial={{ r: 0 }} animate={{ r: inView ? 8 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.4 + k * 0.35 }} />
        ))}
      </svg>
    </div>
  )
}

// 레포트 미니 그림: 실제 추천안 숫자로 쓴 추천 문단 + 숫자 대조 배지
function ReportDemo({ plans }: { plans: Plan[] }) {
  const rec = plans.find((p) => p.recommended)!
  const used = LEVERS.filter((l) => rec.opt.alloc[l.id] > 0).sort((a, b) => rec.opt.alloc[b.id] - rec.opt.alloc[a.id]).slice(0, 3)
  return (
    <div className="memo-demo">
      <p className="muted small" style={{ margin: 0 }}>창녕군 2027 의료·교통 예산 편성안 · 2. 추천 예산안</p>
      <p style={{ margin: '6px 0 12px' }}><b>{preset(rec.preset).name}안</b>을 추천한다. <Phrases text={`${used.map((l) => `${l.short} ${rec.opt.alloc[l.id]}억`).join(', ')} 등으로 종합 취약도가 ${Math.round(rec.neutral.before)}점에서 ${Math.round(rec.neutral.after)}점으로 내려가고, ${fmt(rec.benefit)}명이 혜택을 받는다.`} /></p>
      <span className="badge" style={{ color: 'var(--ok)' }}>✓ 숫자 대조 체크 통과</span>
    </div>
  )
}

// 데이터 출처 마키: 두 줄이 반대로 천천히 흐르고, 마우스를 올리면 멈춘다 (동작 줄이기면 멈춘 격자)
const SOURCES: [string, string, string][] = [
  ['주민등록 인구', 'KOSIS', '#cfe2fb'], ['응급의료 취약지', '국립중앙의료원', '#f6d8cf'], ['병원정보', '건강보험심사평가원', '#c9f0da'],
  ['응급의료기관', '국립중앙의료원', '#dccbfa'], ['버스정류소·노선', 'TAGO', '#fde7b0'], ['대중교통현황조사', '국토교통부', '#f9d2e4'],
  ['교통사고 통계', 'TAAS', '#d6f0f7'], ['사고다발지역', '도로교통공단', '#e3e3e3'], ['세출예산', '지방재정365', '#e6dcfa'],
  ['표준운송원가', '버스 준공영제', '#d9f2c2'], ['행정 경계', 'SGIS · admdongkor', '#ffd9c2'], ['도로망', 'OpenStreetMap', '#cde9e3'],
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
  ['AI가 숫자를 지어내지 않나요?', '계산은 진단·배분·비교 도구가 하고, AI는 어떤 도구를 어떤 조건으로 부를지 정하고 결과를 설명하는 일만 해요. 답과 레포트의 숫자는 도구 결과에 있는 값만 쓰고, 레포트는 숫자 대조 체크를 거쳐요.'],
  ['데이터는 어디서 오나요?', 'KOSIS 인구, 국립중앙의료원 응급의료 취약지 모니터링, 심평원 병원정보, TAGO 버스 노선·정류소, TAAS 교통사고 통계, 지방재정365 세출예산 같은 공공데이터를 군 단위로 합쳐요. 모든 숫자에 출처와 기준일을 붙여요.'],
  ['가중치는 왜 그 숫자인가요?', '‘응급의료 우선 · 균형 · 교통안전 우선’ 세 프리셋의 가중치는 팀 AHP(일관성 비율 0.1 미만)로 정하고 가정과 출처 화면에 공개해요. 시제품은 AHP 확정 전 예시값이에요.'],
  ['응급의료 취약지 해제는 공식 판정인가요?', '아니에요. 취약지 기준이 출처마다 27%/30%로 달라 27%를 설정값으로 썼고, 결과는 ‘이 기준 아래로 내려간다’는 시뮬레이션이지 공식 지정 예측이 아니에요.'],
  ['다른 군도 쓸 수 있나요?', '전국 공통 공공데이터를 쓰기 때문에 같은 방식으로 다른 군에도 넓힐 수 있어요. 시제품은 데이터 수준이 서로 다른 경남 창녕·의령·함안으로 만들었어요.'],
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
                <p><Phrases text={a} /></p>
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

// 창녕의 실제 모양 위에서, 군 평균 한 색 → 500m 격자로 펼쳐지는 장면 (응급실까지 자가용 30분 기준). 가운데에서 바깥으로 물결처럼 번진다
function UnfoldMap({ g }: { g: Grid | null }) {
  const [unfolded, setUnfolded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!g || !inView) return
    const t = setTimeout(() => setUnfolded(true), reduce ? 0 : 1300)
    return () => clearTimeout(t)
  }, [g, inView, reduce])
  const view = useMemo(() => {
    if (!g) return null
    const t = travel(g, 'car').t
    const d = diagnoseGrid(g, t, 'a80', 30)
    const W = Math.max(...g.cells.map((c) => c.cx)) + 0.5, H = Math.max(...g.cells.map((c) => c.cy)) + 0.5
    const avg = cssColor(d.avgMinutes / 30)
    const cells = g.cells.map((c) => {
      const [r, gg, b] = timeColor(t[c.i] / 30)
      return { x: c.cx - 0.25, y: c.cy - 0.25, fill: c.pop === 0 ? '#e7e4dc' : `rgb(${r | 0},${gg | 0},${b | 0})`, delay: Math.hypot(c.cx - W / 2, c.cy - H / 2) * 0.045 }
    })
    return { W, H, avg, cells, d }
  }, [g])
  const avgMin = useCountUp(view && inView ? view.d.avgMinutes : 0, 1000)
  const gap = useCountUp(view && unfolded ? view.d.gap : 0, 1200)
  return (
    <motion.div ref={ref} className="hero-visual" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3, duration: 0.7 }}>
      {view ? (
        <svg viewBox={`-1 -1 ${view.W + 2} ${view.H + 2}`} role="img" aria-label="창녕군을 군 평균 한 색에서 500m 격자로 펼친 응급실 접근 지도">
          {view.cells.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={0.5} height={0.5} className="ucell" style={{ fill: unfolded ? c.fill : view.avg, transitionDelay: unfolded ? `${c.delay}s` : '0s' }} />
          ))}
        </svg>
      ) : <div className="hero-ph" />}
      <div className="hero-tags">
        <motion.span className="tag" animate={{ opacity: unfolded ? 0.45 : 1 }}>창녕군 응급실까지 평균 <b>{Math.round(avgMin)}분</b></motion.span>
        <motion.span className="tag bad" initial={{ opacity: 0, y: 8 }} animate={{ opacity: unfolded ? 1 : 0, y: unfolded ? 0 : 8 }} transition={{ delay: 0.8 }}>
          30분 넘는 80세 이상 <b>{fmt(gap)}명</b>
        </motion.span>
      </div>
      <button className="link replay" onClick={() => { setUnfolded(false); setTimeout(() => setUnfolded(true), 900) }}>↻ 다시 보기</button>
    </motion.div>
  )
}

// AI 질문 예시: 질문 → 도구 호출(✓) → 답이 타이핑된다. 화면에 들어올 때 한 번. 답의 숫자는 실제 계산(창녕, 균형)에서 가져온다
function ChatDemo() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  const [step, setStep] = useState(0)
  const [n, setN] = useState(0)
  const answer = useMemo(() => {
    for (let B = 10; B <= 300; B += 5) {
      const p = planSet(CN, B, DEFAULT_COSTS, 'mid').find((x) => x.preset === 'bal')!
      if (!p.vulnerableAfter) return `균형 목표로 최소 ${B}억이면 돼요. 응급실 30분 밖 주민이 ${Math.round(p.opt.before.e30 * 100)}%에서 ${Math.round(p.opt.after.e30 * 100)}%로 내려가요. 응급 거점에 ${p.opt.alloc.er}억이 들어가요.`
    }
    return '300억까지 써도 응급의료 취약지 기준을 벗어나지 못해요.'
  }, [])
  useEffect(() => {
    if (!inView) return
    const ts = [setTimeout(() => setStep(1), 400), setTimeout(() => setStep(2), 1300), setTimeout(() => setStep(3), 2100), setTimeout(() => setStep(4), 2700)]
    return () => ts.forEach(clearTimeout)
  }, [inView])
  useEffect(() => { if (step >= 4) return tween(0, answer.length, 1800, (v) => setN(Math.round(v)), { ease: (x) => x }) }, [step, answer])
  return (
    <div ref={ref} className="chat-demo">
      <p className="muted small"><span className="spark">✦</span> 예산 질의 AI</p>
      {step >= 1 && <motion.p className="me" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>창녕군이 응급의료 취약지를 벗어나려면 예산이 최소 얼마예요?</motion.p>}
      {step >= 2 && (
        <motion.ul className="tools-demo" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <li><span className={step >= 3 ? 'ok' : 'spin'}>{step >= 3 ? '✓' : ''}</span><code>diagnose(창녕군)</code></li>
          {step >= 3 && <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}><span className={step >= 4 ? 'ok' : 'spin'}>{step >= 4 ? '✓' : ''}</span><code>optimize(min_budget, 응급취약 해제)</code></motion.li>}
        </motion.ul>
      )}
      {step >= 4 && <p className="ai-text">{answer.slice(0, n)}{n < answer.length && <span className="caret" />}</p>}
    </div>
  )
}
