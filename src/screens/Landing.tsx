// 첫 화면(랜딩). 스크롤은 막지 않고, 스크롤한 만큼 장면이 움직인다(GSAP ScrollTrigger + Lenis, landing/useLandingScroll.ts). 3D 막대 장면은 react-three-fiber: 히어로 → 선언문 → 쇼케이스(회색/검정 번갈아) → 데이터 출처 마키 → FAQ → 검정 푸터.
// 그림은 서버가 실제로 계산한 창녕군 결과로 그린다. 서버에는 칸 단위 자료가 없어서, 마을을 칸으로 묶어 집계한 '마을 집계 격자'다(src/api/cells.ts).
// 서버에 닿지 못하면 그림 자리는 비워 둔다. 글 · 카드 · 3D 장면은 스크롤 위치에 따라 움직이고, 지도 그림의 펼침 같은 장면은 화면에 들어올 때 한 번 재생한다.
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'motion/react'
import { api, cached, regionData, regionMap } from '../api/client'
import { cellRate, gridOf, rateColor, type CellGrid } from '../api/cells'
import { judgeLocal, type LocalJudge } from '../api/judge'
import type { Judge, Plans, RegionData, Report, Sensitivity, State } from '../api/types'
import { STATE_CSS, SUPPLY, eok, fmt, pct } from '../api/meta'
import { AiBadge } from '../ui/Badges'
import { Phrases } from '../ui/Phrases'
import { Chevron } from '../ui/Chevron'
import { useLandingScroll } from './landing/useLandingScroll'
import type { Bar } from './landing/Village3D'
import { criteria } from './landing/progress'


// 선 아이콘 (글자 기호 대신). 모두 24칸 좌표에 currentColor 선으로 그린다
const ICONS = {
  target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>,
  compare: <><path d="M5 20V11" /><path d="M12 20V4" /><path d="M19 20v-6" /><path d="M3 20h18" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>,
  server: <><rect x="4" y="4" width="16" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="16" height="6.5" rx="1.5" /><path d="M8 7.25h.01M8 16.75h.01" /></>,
  split: <><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>,
  pencil: <><path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z" /><path d="M14.5 6.5l3 3" /></>,
  download: <><path d="M12 4v11" /><path d="M7.5 11 12 15.5 16.5 11" /><path d="M5 20h14" /></>,
  shield: <><path d="M12 3l7 3v5.5c0 4.5-3 8-7 9.5-4-1.5-7-5-7-9.5V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></>,
} as const
type IconName = keyof typeof ICONS
const Icon = ({ name, size = 22 }: { name: IconName; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICONS[name]}</svg>
)

const Village3D = lazy(() => import('./landing/Village3D')) // three.js는 무거워서 따로 불러온다
// three.js는 WebGL2가 있어야 한다. 그래픽 가속이 꺼진 PC · 원격 데스크톱 · 오래된 그래픽 드라이버에서는 없을 수 있다
const hasWebGL2 = () => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } }
// 3D 장면이 실패해도(그래픽 오류 · 파일 못 받음) 랜딩 전체가 하얗게 깨지지 않게 그 자리만 비운다
class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

const SHOWCASES = [
  { id: 'diag', name: '현황 진단' },
  { id: 'plan', name: '예산안 비교' },
  { id: 'report', name: '레포트' },
]

// 랜딩에 보여 줄 창녕군(정밀 지역) 실제 계산 결과. 서버에 한 번만 묻는다
const DEMO = '48740'
interface Demo { data: RegionData; map: GeoJSON.FeatureCollection; state: State; judge: Judge; plans: Plans; sens: Sensitivity; report: Report }
const loadDemo = () => cached('landing-demo', async (): Promise<Demo> => {
  const { defaultState: state } = await api.regions()
  const body = { region: DEMO, state }
  const [data, map, judge, plans, sens, report] = await Promise.all([regionData(DEMO), regionMap(DEMO), api.judge(body), api.plans(body), api.sensitivity(body), api.report(body)])
  return { data, map, state, judge, plans, sens, report }
})
function useDemo() {
  const [d, setD] = useState<Demo | null>(null)
  useEffect(() => { let live = true; loadDemo().then((x) => live && setD(x), () => {}); return () => { live = false } }, [])
  return d
}

// 마을을 칸으로 묶은 격자 + 기본 기준 판정 (그림 여러 곳이 같이 쓴다)
function useGrid(demo: Demo | null) {
  return useMemo(() => {
    if (!demo) return null
    const grid = gridOf(demo.data.villages, 22, demo.map)
    return { grid, local: judgeLocal(demo.data, demo.state) }
  }, [demo])
}
// 칸마다 닿지 못하는 사람 비율 (판정 결과 → 마을별 인구·공백 → 칸 집계)
const rates = (grid: CellGrid, people: number[], gap: number[]) => grid.cells.map((c) => cellRate(c.members, people, gap))
const gapOf = (local: LocalJudge) => ({ people: local.villages.map((v) => v.people), gap: local.villages.map((v) => (v.state === 0 ? 0 : v.people)) })

export function Landing() {
  const nav = useNavigate()
  const start = () => nav('/intro')
  const rootRef = useRef<HTMLDivElement>(null)
  const demo = useDemo()
  const g = useGrid(demo)
  useLandingScroll(rootRef, g)

  return (
    <motion.div ref={rootRef} className="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }}>
      <div className="landing-inner">
      <div className="land-progress" aria-hidden />
      <header className="land-nav">
        <span className="logo"><span className="logo-mark">V</span>VillageCoverage</span>
        <nav>
          <a href="#diag">현황 진단</a>
          <a href="#plan">예산안 비교</a>
          <a href="#report">레포트</a>
          <a href="#faq">자주 묻는 질문</a>
          <button className="dark-btn small-btn" onClick={start}>서비스 시작하기</button>
        </nav>
      </header>

      <div className="hero-bleed">
      <div className="hero-blobs" aria-hidden><i /><i /><i /></div>
      <section className="wrap land-hero">
        <p className="hero-tagline">클릭 몇 번으로, 근거 있는 예산안.</p>
        {/* 히어로 연출은 스크롤에만 반응한다(useLandingScroll) */}
        <div className="hero-copy">
          <p className="eyebrow">2026 AI 라이프 솔루션 챌린지</p>
          <h1><span className="phrase">우리 군에 한 해 6억이 있다면,</span> <span className="phrase">어디에 써야 할까요?</span></h1>
          <p className="lead"><Phrases text="마을마다 병원과 버스에 닿을 수 있는지 진단하고, 목표와 예산에 맞는 대안 세 가지를 만들어 비교·추천합니다. 계산은 모두 서버가 하고, 근거가 담긴 레포트까지 한 번에 만들어요." /></p>
          <div className="row">
            <button className="primary big-btn" onClick={start}>서비스 시작하기</button>
            <a className="ghost big-btn" href="#diag">기능 둘러보기</a>
          </div>
          <p className="muted small hero-note">시제품 · 전국 72개 시군구 · 5곳은 정밀 판정, 나머지는 간이 판정 · 지도의 칸은 마을을 묶어 집계한 거예요</p>
        </div>
        <div className="hero-tilt"><UnfoldMap demo={demo} g={g} /></div>
      </section>
      </div>

      <section className="wrap statement">
        <p className="say center"><span className="phrase">평균으로는 안 보이는 마을까지,</span> <span className="grad phrase">기준을 정해 숫자로 설명합니다.</span></p>
        <div className="stat-grid">
          <Stat value={demo?.judge.summary.gap} unit="명" label="병원에 갈 수 없는 80세 이상" note={demo ? `${demo.data.name} · 자가용 30분, 정류장 걸어서 15분, 버스 하루 3번 기준` : '창녕군 · 기본 기준'} />
          <Stat value={demo ? demo.judge.summary.rate * 100 : undefined} unit="%" digits={1} label="80세 이상 가운데 비율" note={demo ? `${fmt(demo.judge.summary.total)}명 중` : '창녕군 · 기본 기준'} />
          <Stat value={demo?.judge.summary.gapVillages} unit="곳" label="닿지 못하는 마을" note={demo ? `마을 ${demo.data.villages.length}곳 중` : '창녕군 · 기본 기준'} />
        </div>
      </section>

      <Village3DSection g={g} />

      {/* 바로 가기 탭은 세 쇼케이스 안에서만 붙어 다닌다 */}
      <div className="showcases">
        <SecNav root={rootRef} />

        <Showcase id="diag" tone="light" icon="target" title="현황 진단" lead="마을 한 곳마다 병원과 버스에 닿을 수 있는지 기준대로 판정하고, 기준을 바꾸면 지도가 바로 바뀌어요.">
          <SCard title="기준을 바꾸면 칸 색이 바로 바뀌어요" text="정류장까지 걷는 시간이나 버스 운행 횟수를 직접 움직여 보세요. 브라우저가 바로 다시 판정해서 칸 색이 바뀌어요. 서버 판정이 기준이라, 결과를 대조해서 다르면 서버 결과로 보여 줘요." visual={<CriteriaDemo demo={demo} g={g} />} tone="pa" />
          <SCard black title="마을을 칸으로 묶어 한눈에" text="마을 점을 일정한 크기의 칸으로 묶고, 칸 안에서 닿지 못하는 사람의 비율로 색을 칠해요. 실제 500m 격자나 이동시간이 아니라 마을을 묶어 집계한 그림이에요." visual={<AggregateDemo demo={demo} g={g} />} tone="gr" />
        </Showcase>

        <Showcase id="plan" tone="dark" icon="compare" title="예산안 비교" lead="목표 달성률과 연 예산을 정하면 서버가 공급수단 조합을 찾아 대안 세 가지를 만들고, 하나를 추천해요.">
          <SCard title="비용 절감 · 균형 · 적극 투자, 세 가지 안" text="목표를 채우는 가장 싼 조합, 원격진료 없이 목표를 채우는 가장 싼 조합, 예산 안에서 가장 많이 닿는 조합을 비교해요. 공급수단은 순회 진료 버스, 수요응답형 버스, 경로당 원격진료, 거점 의료기관이에요." visual={<MiniPlans demo={demo} />} tone="pb" />
          <SCard black title="정책이 놓이는 모습을 지도에" text="추천안의 공급수단이 하나씩 놓이면, 새로 닿는 칸이 빨강에서 초록으로 바뀌어요. 남는 공백도 함께 보여 줘요." visual={<DropDemo demo={demo} g={g} />} tone="gr" />
        </Showcase>

        <Showcase id="report" tone="light" icon="doc" title="레포트" lead="고른 안은 공문 형식으로 바로 만들어요. 문단은 직접 고칠 수 있어요.">
          <SCard title="계산 결과로 채운 공문 초안" text="현황과 권고를 쓰고 대안 비교표를 붙여요. 고친 문단은 서버에 다시 보내 그대로 실려요. PDF로 저장하거나 링크로 같은 조건을 공유할 수 있어요." visual={<ReportDemo demo={demo} />} tone="pb" ai />
          <SCard black title="단가가 20% 달라져도 추천이 그대로일까" text="가정한 단가를 20% 내리고 올렸을 때 추천이 바뀌는지 확인해요. 단가는 화면에서 직접 고칠 수 있어요." visual={<SensDemo demo={demo} />} tone="gr" />
        </Showcase>
      </div>

      <section className="sources-sec">
        <div className="wrap">
          <h2><span className="phrase">흩어진 인구·버스·의료 데이터를,</span> <span className="grad phrase">군 예산 하나로.</span></h2>
        </div>
        <Marquee demo={demo} />
        <div className="wrap">
          <ul className="essentials">
            {([['server', '숫자는 모두 서버가 계산'], ['split', '공공데이터 · 가정값 구분'], ['pencil', '단가·효과 가정은 화면에서 고칠 수 있게'], ['download', 'PDF로 저장 · 링크로 공유'], ['shield', '서버 판정과 화면 판정을 대조'], ['target', '정밀 지역과 간이 판정 지역을 구분']] as [IconName, string][]).map(([i, t]) => (
              <li key={t}><i><Icon name={i} size={20} /></i>{t}</li>
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
          <h2>우리 군의 예산부터 짜 보세요</h2>
          <motion.button className="primary big-btn" onClick={start} whileTap={{ scale: 0.97 }}>서비스 시작하기</motion.button>
          <div className="foot-grid">
            <div><h4>서비스</h4><p>현황 진단</p><p>예산안 비교 · What-if</p><p>레포트 · AI 질문</p></div>
            <div><h4>데이터</h4><p>지역별 출처는 서비스 안의 ‘가정과 출처’에서 볼 수 있어요</p><p>경계: 통계청 SGIS 기반 admdongkor 2026.7 (CC BY 4.0)</p><p>지도: OpenFreeMap, © OpenStreetMap 기여자</p></div>
            <div><h4>시제품 안내</h4><p><Phrases text="정밀 판정은 5곳이고, 나머지 67곳은 정류장까지 걷는 거리만 보는 간이 판정이에요. 랜딩의 칸은 마을을 묶어 집계한 그림이에요." /></p><p>2026 AI 라이프 솔루션 챌린지 출품작</p></div>
          </div>
          <details className="credits">
            <summary>이미지 출처</summary>
            <ul>
              {CREDITS.map(([where, title, author, license, url]) => (
                <li key={where}>{where}: <a href={url} target="_blank" rel="noopener noreferrer">{title}</a> · {author} · {license}</li>
              ))}
            </ul>
          </details>
        </div>
      </footer>
      </div>
    </motion.div>
  )
}

// 3D 막대 장면: 화면에 고정된 채 스크롤하는 만큼 막대가 솟고 색이 바뀐다(움직임은 useLandingScroll이 진행도를 넘긴다)
function Village3DSection({ g }: { g: ReturnType<typeof useGrid> }) {
  const webgl = useMemo(hasWebGL2, [])
  const scene = useMemo(() => {
    if (!g) return null
    const { people, gap } = gapOf(g.local)
    const r = rates(g.grid, people, gap)
    const bars: Bar[] = g.grid.cells.map((c, i) => ({ x: c.ix + 0.5 - g.grid.W / 2, z: c.iy + 0.5 - g.grid.H / 2, rate: r[i] ?? 0, color: rateColor(r[i]) }))
    return { bars, size: Math.max(g.grid.W, g.grid.H), avg: rateColor(g.local.summary.rate) }
  }, [g])
  return (
    <section className="v3d">
      <div className="v3d-canvas" aria-hidden>{scene && webgl && <Quiet><Suspense fallback={null}><Village3D {...scene} /></Suspense></Quiet>}</div>
      <div className="v3d-caps wrap" role="note">
        <p className="v3d-cap on"><span className="eyebrow">창녕군 · 실제 계산 결과</span>마을을 칸으로 묶고</p>
        <p className="v3d-cap">칸마다 병원에 닿지 못하는 사람만큼 막대를 세우면</p>
        <p className="v3d-cap">평균으로 안 보이던 <span className="grad">의료취약지역</span>이 한눈에 보여요</p>
      </div>
    </section>
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

function Showcase({ id, tone, icon, title, lead, children }: { id: string; tone: 'light' | 'dark'; icon: IconName; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`showcase ${tone}`}>
      <div className="wrap">
        <div className="show-head">
          <span className="show-icon" aria-hidden><Icon name={icon} size={26} /></span>
          <h2>{title}</h2>
          {/* 쉼표 단위로 묶어 문장 중간에서 줄이 끊기지 않게 */}
          <p><Phrases text={lead} /></p>
        </div>
      </div>
      {/* 카드는 위에 붙어 쌓인다(sticky). 아래 카드가 올라오며 앞 카드를 덮는다 */}
      <div className="wrap show-stack">{children}</div>
    </section>
  )
}

// 기능 카드 (흰/검정 번갈아). 스크롤 연출은 useLandingScroll이 건다
function SCard({ title, text, visual, black, tone, ai }: { title: string; text: string; visual: React.ReactNode; black?: boolean; tone: 'pa' | 'pb' | 'gr'; ai?: boolean }) {
  return (
    <article className={`scard ${black ? 'black' : ''}`}>
      <div>
        {ai && <AiBadge>서버 초안</AiBadge>}
        <h3 style={{ marginTop: ai ? 12 : 0 }}>{title}</h3>
        <p><Phrases text={text} /></p>
      </div>
      <div className={`scard-visual ${tone}`}>{visual}</div>
    </article>
  )
}

// 칸 그림: 칸마다 색 하나. to가 있으면 스크롤하는 만큼 fills → to 색으로 바뀐다(data-to · data-d 순서, useLandingScroll이 건다).
// to가 없으면 색이 바뀔 때 .ucell의 transition으로 번진다(기준 슬라이더 그림)
function CellSvg({ grid, fills, to, delays, label, big, children }: { grid: CellGrid; fills: string[]; to?: string[]; delays?: number[]; label: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <svg viewBox={`-0.5 -0.5 ${grid.W + 1} ${grid.H + 1}`} className={to ? 'scrub' : undefined} style={big ? undefined : { width: '100%', maxHeight: 260 }} role="img" aria-label={label}>
      {grid.cells.map((c, i) => <rect key={`${c.ix},${c.iy}`} x={c.ix + 0.05} y={c.iy + 0.05} width={0.9} height={0.9} rx={0.14} className="ucell" style={{ fill: fills[i] }} data-to={to?.[i]} data-d={delays?.[i]} />)}
      {children}
    </svg>
  )
}

// 군 평균 한 색 → 칸마다 제 색으로 펼쳐지는 장면. 스크롤을 내리는 만큼 가운데에서 바깥으로 물결처럼 번진다(useLandingScroll)
function UnfoldMap({ demo, g }: { demo: Demo | null; g: ReturnType<typeof useGrid> }) {
  const view = useMemo(() => {
    if (!g) return null
    const { people, gap } = gapOf(g.local)
    const r = rates(g.grid, people, gap)
    return {
      avg: rateColor(g.local.summary.rate), fills: r.map(rateColor),
      delays: g.grid.cells.map((c) => Math.hypot(c.ix + 0.5 - g.grid.W / 2, c.iy + 0.5 - g.grid.H / 2)),
    }
  }, [g])
  return (
    <div className="hero-visual">
      {g && view ? (
        <CellSvg grid={g.grid} fills={view.fills.map(() => view.avg)} to={view.fills} delays={view.delays} label="창녕군 마을을 칸으로 묶어, 군 평균 한 색에서 칸마다 닿지 못하는 비율의 색으로 펼친 지도" big />
      ) : <div className="hero-ph" />}
      {demo && g && (
        <div className="hero-tags">
          <span className="tag hero-avg">{demo.data.name} 80세 이상 중 닿지 못하는 사람 평균 <b>{Math.round(g.local.summary.rate * 100)}%</b></span>
          <span className="tag bad hero-gap">병원에 갈 수 없는 80세 이상 <b><span data-count={g.local.summary.gap}>{fmt(g.local.summary.gap)}</span>명</b></span>
        </div>
      )}
    </div>
  )
}

function CriteriaDemo({ demo, g }: { demo: Demo | null; g: ReturnType<typeof useGrid> }) {
  const [walk, setWalk] = useState(15)
  const [runs, setRuns] = useState(3)
  // 현황 진단 장면을 스크롤하는 동안 기준이 저절로 바뀐다(useLandingScroll). 손으로 슬라이더를 움직여도 된다
  useEffect(() => { criteria.set = (w, r) => { setWalk(w); setRuns(r) }; return () => { criteria.set = null } }, [])
  const view = useMemo(() => {
    if (!demo || !g) return null
    const local = judgeLocal(demo.data, { ...demo.state, criteria: { ...demo.state.criteria, stopWalkMinutes: walk, dailyRuns: runs } })
    const { people, gap } = gapOf(local)
    return { fills: rates(g.grid, people, gap).map(rateColor), summary: local.summary }
  }, [demo, g, walk, runs])
  if (!demo || !g || !view) return <div className="hero-ph" />
  return (
    <div style={{ width: '100%', display: 'grid', gap: 10, color: 'var(--ink)' }}>
      <CellSvg grid={g.grid} fills={view.fills} label="기준을 바꾸면 칸 색이 바뀌는 지도" />
      <label className="slider" style={{ margin: 0 }}><span>정류장까지 걸어서 <b className="num">{walk}분</b> 이내</span><input type="range" min={5} max={30} step={1} value={walk} onChange={(e) => setWalk(+e.target.value)} /></label>
      <label className="slider" style={{ margin: 0 }}><span>버스 하루 <b className="num">{runs}번</b> 이상</span><input type="range" min={1} max={10} step={1} value={runs} onChange={(e) => setRuns(+e.target.value)} /></label>
      <p style={{ margin: 0, textAlign: 'center' }}>닿지 못하는 80세 이상 <b className="num">{fmt(view.summary.gap)}명</b> ({pct(view.summary.rate)})</p>
      <Legend />
    </div>
  )
}

const Legend = () => (
  <div className="legend-row" style={{ justifyContent: 'center', margin: 0 }}>
    <span><i style={{ background: rateColor(0) }} />닿는 칸</span><span><i style={{ background: rateColor(0.3) }} />일부 못 닿음</span><span><i style={{ background: rateColor(0.6) }} />대부분 못 닿음</span>
  </div>
)

// 마을 점이 칸으로 모이는 그림: 스크롤하는 만큼 점이 자기 칸 가운데로 날아가고 칸 색이 켜진다(useLandingScroll)
function AggregateDemo({ demo, g }: { demo: Demo | null; g: ReturnType<typeof useGrid> }) {
  const view = useMemo(() => {
    if (!g) return null
    const { people, gap } = gapOf(g.local)
    const center = new Map<number, [number, number]>()
    g.grid.cells.forEach((c) => c.members.forEach((m) => center.set(m, [c.ix + 0.5, c.iy + 0.5])))
    return { fills: rates(g.grid, people, gap).map(rateColor), center }
  }, [g])
  if (!demo || !g || !view) return <div className="hero-ph" />
  const { grid, local } = g
  return (
    <div className="agg" style={{ width: '100%', display: 'grid', gap: 10, color: '#fff' }}>
      <svg viewBox={`-0.5 -0.5 ${grid.W + 1} ${grid.H + 1}`} style={{ width: '100%', maxHeight: 260 }} role="img" aria-label="마을 점이 칸으로 묶이는 그림">
        {grid.cells.map((c, i) => <rect key={`${c.ix},${c.iy}`} className="agg-cell" x={c.ix + 0.05} y={c.iy + 0.05} width={0.9} height={0.9} rx={0.14} style={{ fill: view.fills[i] }} />)}
        {grid.pts.map((p, i) => {
          const [cx, cy] = view.center.get(i)!
          return <circle key={local.villages[i].id} className="agg-pt" cx={p.x} cy={p.y} r={Math.min(0.3, 0.1 + Math.sqrt(local.villages[i].people) * 0.012)} data-dx={cx - p.x} data-dy={cy - p.y} style={{ fill: STATE_CSS[local.villages[i].state], stroke: '#fff', strokeWidth: 0.04 }} />
        })}
      </svg>
      <p style={{ margin: 0, textAlign: 'center' }}>마을 <b className="num">{grid.pts.length}곳</b> → 마을이 있는 칸 <b className="num">{grid.cells.filter((c) => c.members.length).length}개</b></p>
    </div>
  )
}

// 대안 세 가지: 서버가 만든 실제 결과
function MiniPlans({ demo }: { demo: Demo | null }) {
  if (!demo) return <div className="hero-ph" />
  return (
    <div className="mini-plans">
      {demo.plans.plans.map((p) => (
        <div key={p.k} className={`mini-plan ${p.recommended ? 'rec' : ''}`}>
          <div className="row"><b>{p.name}</b>{p.recommended && <span className="badge rec">⭐ 추천</span>}</div>
          <div className="progress-line" style={{ height: 8 }}><span className="plan-bar" data-w={p.rate * 100} style={{ width: `${p.rate * 100}%` }} /></div>
          <span className="muted">{p.summary}</span>
          <span>달성률 <b className="num">{pct(p.baseRate)} → {pct(p.rate)}</b> · 연 <b className="num">{eok(p.year)}</b></span>
        </div>
      ))}
    </div>
  )
}

// 정책이 놓이는 그림: 스크롤하는 만큼 추천안의 공급수단 핀이 하나씩 떨어지고, 새로 닿는 칸이 핀에서 가까운 곳부터 초록으로 바뀐다(useLandingScroll)
function DropDemo({ demo, g }: { demo: Demo | null; g: ReturnType<typeof useGrid> }) {
  const plan = demo?.plans.plans.find((p) => p.recommended) ?? demo?.plans.plans[0]
  const view = useMemo(() => {
    if (!demo || !g || !plan) return null
    const { grid, local } = g
    const idx = new Map(local.villages.map((v, i) => [v.id, i]))
    const cov = new Map(demo.judge.villages.map((v, i) => [v.id, plan.coverage[i]]))
    const people = local.villages.map((v) => v.people)
    const before = local.villages.map((v) => (v.state === 0 ? 0 : v.people))
    const after = local.villages.map((v) => (v.state === 0 ? 0 : v.people * (1 - (cov.get(v.id) ?? 0))))
    const pins = plan.picks.flatMap((p) => p.villages.flatMap((id) => (idx.has(id) ? [{ ...grid.pts[idx.get(id)!], type: p.type }] : [])))
    const delays = grid.cells.map((c) => (pins.length ? Math.min(...pins.map((p) => Math.hypot(c.ix + 0.5 - p.x, c.iy + 0.5 - p.y))) : 0))
    return { b: rates(grid, people, before).map(rateColor), a: rates(grid, people, after).map(rateColor), delays, pins }
  }, [demo, g, plan])
  if (!demo || !g || !view || !plan) return <div className="hero-ph" />
  return (
    <div className="drop" style={{ width: '100%', display: 'grid', gap: 10, color: '#fff' }}>
      <CellSvg grid={g.grid} fills={view.b} to={view.a} delays={view.delays} label="추천안의 공급수단이 놓이고 새로 닿는 칸이 초록으로 바뀌는 지도">
        {view.pins.map((p, k) => <circle key={k} className="drop-pin" cx={p.x} cy={p.y} r={0.38} fill={SUPPLY[p.type].color} stroke="#fff" strokeWidth="0.12" />)}
      </CellSvg>
      <p style={{ margin: 0, textAlign: 'center' }}>{plan.name} · 남는 공백 <b className="num">{fmt(plan.gapBefore)}명 → <span data-count={plan.gapAfter} data-from={plan.gapBefore}>{fmt(plan.gapAfter)}</span>명</b></p>
      <div className="chips" style={{ justifyContent: 'center' }}>{[...new Set(view.pins.map((p) => p.type))].map((t) => <span key={t} className="mini" style={{ color: 'var(--ink)' }}><i style={{ background: SUPPLY[t].color }} />{SUPPLY[t].name}</span>)}</div>
    </div>
  )
}

function SensDemo({ demo }: { demo: Demo | null }) {
  if (!demo) return <div className="hero-ph" />
  const s = demo.sens
  return (
    <div className="memo-demo">
      <p className="muted small" style={{ margin: 0 }}>{demo.data.name} · 추천안 {s.base.name}</p>
      <p style={{ margin: '6px 0' }}>단가 −20% <b className="num">연 {eok(s.lo.year)}</b><br />기준 <b className="num">연 {eok(s.base.year)}</b><br />단가 +20% <b className="num">연 {eok(s.hi.year)}</b></p>
      <span className="badge" style={{ color: s.same ? 'var(--ok)' : 'var(--warn)' }}>{s.same ? '✓ 추천이 그대로예요' : '추천이 바뀔 수 있어요'}</span>
    </div>
  )
}

function ReportDemo({ demo }: { demo: Demo | null }) {
  const sec = demo?.report.sections.find((s) => s.key === '권고') ?? demo?.report.sections[0]
  if (!demo || !sec) return <div className="hero-ph" />
  return (
    <div className="memo-demo">
      <p className="muted small" style={{ margin: 0 }}>{demo.report.title} · {sec.title}</p>
      <p style={{ margin: '6px 0 12px' }}><Phrases text={sec.text} /></p>
    </div>
  )
}

// 랜딩에 쓴 이미지 출처 (Wikimedia Commons). CC BY·BY-SA 이미지는 출처 표시가 필요해서 푸터에 모두 적는다
const CREDITS: [string, string, string, string, string][] = [
  ["첫 화면 배경 · 창녕 우포늪", "우포늪 ( 10 )", "최옥석", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:%EC%9A%B0%ED%8F%AC%EB%8A%AA_(_10_).jpg"],
  ["초중등학교", "Okcheon County Samyang Elementary School 20240730 (01)", "LandAndTree", "CC0", "https://commons.wikimedia.org/wiki/File:Okcheon_County_Samyang_Elementary_School_20240730_(01).jpg"],
  ["약국", "2020-03-26 15.32.24 pharmacy in Hoengseong", "Choi Kwang-mo", "CC0", "https://commons.wikimedia.org/wiki/File:2020-03-26_15.32.24_pharmacy_in_Hoengseong.jpg"],
  ["병원", "National Police Hospital of Korea", "IRTC1015", "Public domain", "https://commons.wikimedia.org/wiki/File:National_Police_Hospital_of_Korea.JPG"],
  ["행정경계 (창녕군 행정구역도)", "Changnyeong-map", "장길산", "Public domain", "https://commons.wikimedia.org/wiki/File:Changnyeong-map.png"],
  ["마을회관·경로당", "Wati village hall in Gonyang-myeon", "Choi2451", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:Wati_village_hall_in_Gonyang-myeon.jpg"],
  ["버스정류장", "Palyongdong Residents Center bus stop on April 22nd, 2016", "Choi2451", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:Palyongdong_Residents_Center_bus_stop_on_April_22nd,_2016.jpg"],
  ["농어촌버스", "A bus stop on the coastal road of Yokjido Island", "Pranay chakraborty 2004", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:A_bus_stop_on_the_coastal_road_of_Yokjido_Island.jpg"],
  ["도서관", "National Library of Korea, front", "Christian Bolz", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:National_Library_of_Korea,_front.jpg"],
  ["인구·생명표 (인구 피라미드)", "South Korea population pyramid (2018)", "CIA Factbook", "Public domain", "https://commons.wikimedia.org/wiki/File:South_Korea_population_pyramid_(2018).jpg"],
  ['지도 배경 (OpenStreetMap 도로망)', '우리 앱의 창녕군 지도 화면', 'OpenFreeMap · OpenMapTiles', '© OpenStreetMap contributors (ODbL)', 'https://www.openstreetmap.org/copyright'],
]

// 박스 이름에 이 낱말이 들어 있으면 그 이미지를 뒤에 깐다 (지역마다 출처 이름이 달라서 낱말로 찾는다). 위에서부터 먼저 맞는 것
const TILE_IMG: [RegExp, string][] = [
  [/학교/, 'school'], [/약국/, 'pharmacy'], [/병원|병의원|보건/, 'hospital'], [/경계/, 'boundary'], [/마을회관|경로당|복지시설/, 'hall'],
  [/정류장/, 'busstop'], [/시간표|버스/, 'bus'], [/도서관/, 'library'], [/주민등록|인구|생명표/, 'population'], [/OpenStreetMap|도로망|지도/, 'osm'],
]
const imgOf = (name: string) => TILE_IMG.find(([re]) => re.test(name))?.[1]

// 데이터 출처 마키: 두 줄이 반대로 천천히 흐르고, 마우스를 올리면 멈춘다 (동작 줄이기면 멈춘 격자)
// 파스텔 색을 70% 덮어서 이미지가 은은하게 비치게 한다. 글자는 그대로 읽힌다
const tileStyle = (name: string, color: string): React.CSSProperties => {
  const img = imgOf(name)
  return img ? { backgroundImage: `linear-gradient(${color}b3, ${color}b3), url(/images/${img}.jpg)`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: color }
}
const BG = ['#cfe2fb', '#f6d8cf', '#c9f0da', '#dccbfa', '#fde7b0', '#f9d2e4']
function Marquee({ demo }: { demo: Demo | null }) {
  const tiles: [string, string][] = [
    ...(demo?.data.sources.map((s): [string, string] => [s, `${demo.data.name} 자료`]) ?? []),
    ['행정 경계', 'SGIS · admdongkor'], ['바탕 지도', 'OpenFreeMap · OpenStreetMap'], ['마을별 병의원', '시설 좌표와 의사 수'], ['공급수단 단가', '가정값 · 화면에서 수정'],
  ]
  const rows = [tiles.slice(0, Math.ceil(tiles.length / 2)), tiles.slice(Math.ceil(tiles.length / 2))]
  return (
    <div className="marquee" aria-label="쓰는 데이터">
      {rows.map((row, r) => (
        <div key={r} className={`marquee-row ${r ? 'rev' : ''}`}>
          {[0, 1, 2].map((copy) => row.map(([name, org], i) => (
            <div key={`${copy}-${name}`} className={`mtile ${copy ? 'dup' : ''}`} style={tileStyle(name, BG[(i + r * 3) % BG.length])} aria-hidden={copy ? true : undefined}>
              <span>{name}<small>{org}</small></span>
            </div>
          )))}
        </div>
      ))}
    </div>
  )
}


const FAQS: [string, string][] = [
  ['숫자는 어떻게 계산하나요?', '판정, 대안, 레포트 숫자는 모두 서버가 계산해요. 화면은 기준을 바꿀 때 바로 반응하도록 브라우저에서도 판정하는데, 서버 판정이 기준이라 결과를 대조해서 다르면 서버 결과로 보여 줘요.'],
  ['지도의 칸은 실제 격자인가요?', '아니에요. 서버가 마을 단위로만 자료를 주기 때문에, 마을을 일정한 크기의 칸으로 묶어 칸 안의 인구와 닿지 못하는 사람 비율을 합쳐서 칠한 거예요. 서비스 본 화면에서는 마을 한 곳이 점 하나예요.'],
  ['정밀 지역과 간이 판정은 뭐가 다른가요?', '창녕·영양·진도·청양·보은 5곳은 버스 하루 운행 횟수와 읍내행 첫차까지 보고, 나머지 67곳은 정류장까지 걷는 거리만 봐요.'],
  ['공급수단 단가는 믿어도 되나요?', '단가와 효과는 가정값이에요. ‘가정과 출처’ 화면에서 직접 고칠 수 있고, 고치면 대안이 다시 계산돼요. 단가가 ±20% 달라져도 추천이 그대로인지도 확인해 줘요.'],
  ['AI에게 물어볼 수 있나요?', '화면 오른쪽 아래 ‘AI에게 물어보기’로 물어볼 수 있어요. 서버 에이전트가 계산 도구로 답하는 구조인데, 에이전트를 쓸 수 없을 때는 안내가 나오고 나머지 화면은 그대로 쓸 수 있어요. 질문은 하루 횟수에 제한이 있어요.'],
]
function Faq() {
  const [open, setOpen] = useState<Set<number>>(() => new Set())
  const toggle = (i: number) => setOpen((prev) => { const next = new Set(prev); if (!next.delete(i)) next.add(i); return next })
  return (
    <div className="faq">
      {FAQS.map(([q, a], i) => (
        <div key={q} className="faq-item">
          <button className="faq-q" aria-expanded={open.has(i)} onClick={() => toggle(i)}>{q}<Chevron open={open.has(i)} /></button>
          <AnimatePresence initial={false}>
            {open.has(i) && (
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

function Stat({ value, unit, label, note, digits = 0 }: { value: number | undefined; unit: string; label: string; note: string; digits?: number }) {
  // 숫자는 스크롤하는 만큼 0에서 올라간다(data-count, useLandingScroll)
  return (
    <div className="stat">
      <p className="stat-num">{value == null ? '—' : <span data-count={value} data-digits={digits}>{value.toFixed(digits)}</span>}<small>{unit}</small></p>
      <p><b>{label}</b></p>
      <p className="muted small">{note}</p>
    </div>
  )
}
