// 프로젝트 정보(/about): 챌린지 출품 안내 · 데이터와 분석 기준 · 라이선스와 출처를 한곳에 모은 문서 화면. 푸터의 '프로젝트' 링크가 여기 각 절(#challenge · #data · #licenses)로 온다.
// 랜딩처럼 헤더 · 지도 없이 전체 화면 레이어(.landing)로 띄우고, 아래에 같은 푸터를 붙인다
import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { motion } from 'motion/react'
import { FIRST_BUS_LIMIT } from '../api/judge'
import { useTierCounts } from '../hooks'
import { Logo } from '../ui/Logo'
import { SiteFooter } from '../ui/SiteFooter'

const SECTIONS = [
  { id: 'challenge', name: '2026 AI 라이프 솔루션 챌린지' },
  { id: 'data', name: '데이터 및 분석 기준' },
  { id: 'licenses', name: '라이선스 및 출처' },
]

const FLOW: [string, string][] = [
  ['현황 진단', '마을마다 병원과 버스에 닿을 수 있는지 기준대로 판정해요.'],
  ['목표 · 예산', '목표 달성률과 연 예산, 쓸 공급수단을 정해요.'],
  ['예산안 비교', '서버가 대안 세 가지를 만들어 비교하고 하나를 추천해요.'],
  ['레포트', '고른 안을 공문 형식으로 만들고 문단을 직접 고쳐요.'],
]

// 데이터 출처: [자료, 설명, 라이선스, 링크]
const DATA_SOURCES: [string, string, string, string][] = [
  ['행정 경계', 'vuski/admdongkor ver20260701 · 통계청 SGIS 기반', 'CC BY 4.0', 'https://github.com/vuski/admdongkor'],
  ['바탕 지도', 'OpenFreeMap · OpenMapTiles · © OpenStreetMap 기여자', 'ODbL', 'https://www.openstreetmap.org/copyright'],
]

// 랜딩에 쓴 이미지 출처. CC BY·BY-SA 이미지는 출처 표시가 필요해서 모두 적는다: [쓰인 곳, 제목, 저작자, 라이선스, 링크]
const CREDITS: [string, string, string, string, string][] = [
  ["첫 화면 배경 · 창녕 우포늪", "우포늪 ( 10 )", "최옥석", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:%EC%9A%B0%ED%8F%AC%EB%8A%AA_(_10_).jpg"],
  ["초중등학교", "Okcheon County Samyang Elementary School 20240730 (01)", "LandAndTree", "CC0", "https://commons.wikimedia.org/wiki/File:Okcheon_County_Samyang_Elementary_School_20240730_(01).jpg"],
  ["약국", "2020-03-26 15.32.24 pharmacy in Hoengseong", "Choi Kwang-mo", "CC0", "https://commons.wikimedia.org/wiki/File:2020-03-26_15.32.24_pharmacy_in_Hoengseong.jpg"],
  ["병원", "National Police Hospital of Korea", "IRTC1015", "Public domain", "https://commons.wikimedia.org/wiki/File:National_Police_Hospital_of_Korea.JPG"],
  ["행정경계 그림", "Changnyeong-map", "장길산", "Public domain", "https://commons.wikimedia.org/wiki/File:Changnyeong-map.png"],
  ["마을회관·경로당", "Wati village hall in Gonyang-myeon", "Choi2451", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:Wati_village_hall_in_Gonyang-myeon.jpg"],
  ["버스정류장", "Palyongdong Residents Center bus stop on April 22nd, 2016", "Choi2451", "CC BY-SA 3.0", "https://commons.wikimedia.org/wiki/File:Palyongdong_Residents_Center_bus_stop_on_April_22nd,_2016.jpg"],
  ["농어촌버스", "A bus stop on the coastal road of Yokjido Island", "Pranay chakraborty 2004", "CC BY 4.0", "https://commons.wikimedia.org/wiki/File:A_bus_stop_on_the_coastal_road_of_Yokjido_Island.jpg"],
  ["도서관", "National Library of Korea, front", "Christian Bolz", "CC BY-SA 4.0", "https://commons.wikimedia.org/wiki/File:National_Library_of_Korea,_front.jpg"],
  ["인구·생명표 (인구 피라미드)", "South Korea population pyramid (2018)", "CIA Factbook", "Public domain", "https://commons.wikimedia.org/wiki/File:South_Korea_population_pyramid_(2018).jpg"],
  ['지도 배경 (OpenStreetMap 도로망)', '우리 앱의 지도 화면', 'OpenFreeMap · OpenMapTiles', '© OpenStreetMap contributors (ODbL)', 'https://www.openstreetmap.org/copyright'],
]

// 바깥 링크: 새 창으로 열고, 스크린리더에도 새 창이라고 알린다
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a className="ext" href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden>↗</span><span className="sr-only"> (새 창)</span></a>
)

export function About() {
  const nav = useNavigate()
  const tiers = useTierCounts()
  // 다른 화면 푸터에서 /about#data처럼 들어오면 그 절에서 시작한다. 같은 화면 안의 # 링크(목차 · 푸터)는 브라우저가 옮긴다
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' })
  }, [])

  return (
    <motion.div className="landing about-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <header className="land-nav">
        <Link className="logo" to="/" aria-label="LocalLens 처음 화면으로"><Logo /></Link>
        <nav>
          <Link to="/">서비스 소개</Link>
          <button className="dark-btn small-btn" onClick={() => nav('/start')}>서비스 시작하기</button>
        </nav>
      </header>

      <main>
        <div className="wrap about-head">
          <p className="eyebrow">프로젝트 정보</p>
          <h1>LocalLens가 쓰는 데이터와 기준</h1>
          <p className="lead">어떤 대회에 낸 시제품인지, 어떤 기준으로 계산하는지, 쓴 자료의 출처와 라이선스를 한곳에 모았어요.</p>
        </div>

        <div className="wrap about-body">
          <nav className="about-toc" aria-label="이 페이지 목차">
            {SECTIONS.map((s) => <a key={s.id} href={`#${s.id}`}>{s.name}</a>)}
          </nav>

          <div className="about-content">
            <section id="challenge" className="about-sec" aria-labelledby="challenge-title">
              <h2 id="challenge-title">2026 AI 라이프 솔루션 챌린지</h2>
              <p>LocalLens는 2026 AI 라이프 솔루션 챌린지에 출품한 시제품이에요. {tiers ? `전국 ${tiers.total}개 시군구에서` : '전국 시군구에서'} 마을마다 병원과 버스에 닿을 수 있는지 진단하고, 목표 달성률과 연 예산에 맞는 대안 세 가지를 비교해 근거가 담긴 레포트까지 만들어요.</p>
              <ol className="about-flow">
                {FLOW.map(([t, d], i) => (
                  <li key={t}><span className="num">{String(i + 1).padStart(2, '0')}</span><b>{t}</b><span>{d}</span></li>
                ))}
              </ol>
            </section>

            <section id="data" className="about-sec" aria-labelledby="data-title">
              <h2 id="data-title">데이터 및 분석 기준</h2>
              <p>기준은 현황 진단 화면에서 직접 바꿀 수 있어요. 아래는 처음 열었을 때의 기본값과 판정 규칙이에요.</p>
              <dl className="kv">
                <dt>기본 기준</dt><dd>자가용 30분 · 정류장까지 걸어서 15분 · 버스 하루 3번</dd>
                <dt>정밀 판정{tiers && <span className="muted"> · {tiers.precise}곳</span>}</dt><dd>버스 하루 운행 횟수와 읍내행 첫차({FIRST_BUS_LIMIT / 60}시 전)까지 봐요.</dd>
                <dt>간이 판정{tiers && <span className="muted"> · {tiers.total - tiers.precise}곳</span>}</dt><dd>버스 운행 정보가 없어 정류장까지 걷는 거리만 봐요.</dd>
                <dt>정류장 탐색 범위</dt><dd>2km 안에 정류장이 없으면 걸음 60분으로 보고 ‘정류장 없음’으로 판정해요.</dd>
                <dt>마을 안 병의원</dt><dd>마을 안에 병의원이 있으면 갈 수 있음으로 봐요.</dd>
              </dl>
              <h3>계산 방식</h3>
              <ul className="about-list">
                <li>판정 · 대안 · 레포트의 숫자는 모두 서버가 계산해요. 기준을 바꾸면 브라우저가 먼저 판정해 지도를 바로 바꾸고, 서버 판정과 대조해서 다르면 서버 결과로 보여 줘요.</li>
                <li>공공데이터와 가정값을 나눠 표시해요. 공급수단 단가와 효과는 가정값이라 ‘가정과 출처’에서 고칠 수 있고, 단가가 ±20% 달라져도 추천이 그대로인지 함께 확인해요.</li>
                <li>첫 화면 지도의 칸은 실제 500m 격자가 아니라, 마을을 일정한 크기의 칸으로 묶어 집계한 그림이에요.</li>
              </ul>
              <p className="about-note"><b>참고용 분석이에요.</b> 분석 결과는 참고용이며 공식 행정 평가를 대체하지 않습니다.</p>
            </section>

            <section id="licenses" className="about-sec" aria-labelledby="licenses-title">
              <h2 id="licenses-title">라이선스 및 출처</h2>
              <h3>데이터</h3>
              <ul className="src-list">
                {DATA_SOURCES.map(([name, desc, license, url]) => (
                  <li key={name}><b>{name}</b><span>{desc}</span><Ext href={url}>{license}</Ext></li>
                ))}
                <li><b>지역별 공공데이터</b><span>인구 · 버스 · 의료 시설 자료는 지역마다 출처가 달라요. 지역을 고른 뒤 상단의 ‘가정과 출처’에서 볼 수 있어요.</span></li>
              </ul>
              <h3>이미지</h3>
              <p className="small muted">첫 화면에 쓴 이미지예요. 제목을 누르면 원본과 라이선스를 볼 수 있어요.</p>
              <table className="credit-table">
                <thead><tr><th scope="col">쓰인 곳</th><th scope="col">원본 · 저작자</th><th scope="col">라이선스</th></tr></thead>
                <tbody>
                  {CREDITS.map(([where, title, author, license, url]) => (
                    <tr key={where}>
                      <th scope="row">{where}</th>
                      <td><Ext href={url}>{title}</Ext><span className="muted"> · {author}</span></td>
                      <td><span className="lic">{license}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </div>
      </main>

      <SiteFooter />
    </motion.div>
  )
}
