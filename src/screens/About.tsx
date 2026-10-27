// 프로젝트 정보(/about): 챌린지 출품 안내 · 데이터와 분석 기준 · 데이터 활용과 출처를 한곳에 모은 문서 화면. 푸터의 '프로젝트' 링크가 여기 각 절(#challenge · #data · #sources)로 온다.
// 예전 주소 /about#licenses는 '데이터 활용 및 출처' 안의 라이선스 소절로 이어진다
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
  { id: 'sources', name: '데이터 활용 및 출처' },
]

const FLOW: [string, string][] = [
  ['현황 진단', '마을마다 병원과 버스에 닿을 수 있는지 기준대로 판정해요.'],
  ['목표 · 예산', '목표 달성률과 연 예산, 쓸 공급수단을 정해요.'],
  ['예산안 비교', '서버가 대안 세 가지를 만들어 비교하고 하나를 추천해요.'],
  ['레포트', '고른 안을 공문 형식으로 만들고 문단을 직접 고쳐요.'],
]

// 데이터 활용 현황. 서버가 지역 자료(GET /api/regions/{code})의 sources와 레포트 각주(출처 · 기관 · 주소)로 밝힌 자료만 적고,
// 쓰임새는 화면 코드와 레포트 각주가 그 자료를 어디에 붙이는지로 확인한 것만 적는다.
// src: [제공 기관, 원본 데이터, 링크]. 링크는 서버 각주나 기존 출처 표기에 있던 원본 주소만 단다
type Src = [org: string, set: string, url?: string]
const DATA_USE: { group: string; rows: { name: string; src: Src[]; use: string }[] }[] = [
  { group: '인구', rows: [
    { name: '마을별 주민 수', src: [['행정안전부', '법정동별 주민등록 인구', 'https://www.data.go.kr/data/15099158/fileData.do']],
      use: '마을(리)마다 전체 · 65세 이상 · 80세 이상 주민 수를 알려 줘요. 병원에 가기 어려운 주민이 몇 명인지, 목표 달성률이 얼마인지 셀 때 바탕이 돼요.' },
    { name: '나이별 생존율', src: [['통계청', '생명표', 'https://kosis.kr/statHtml/statHtml.do?orgId=101&tblId=DT_1B42']],
      use: '지금 70세 이상 주민에 나이별 생존율을 곱해 10년 뒤 80세 이상 주민 수를 어림해요. 대안 비교와 레포트의 ‘10년 뒤 달성률’에 쓰여요.' },
  ] },
  { group: '의료', rows: [
    { name: '병의원 위치와 의사 수', src: [['건강보험심사평가원', '병원정보서비스', 'https://www.data.go.kr/data/15001698/openapi.do']],
      use: '병원 · 의원 · 보건소 · 보건진료소의 위치와 종류, 의사 수를 담고 있어요. 지도의 병의원 표시, 마을에서 가장 가까운 병의원까지 걸리는 시간, 인구 1천 명당 의사 수에 쓰여요.' },
    { name: '응급의료기관', src: [['국립중앙의료원', '전국 응급의료기관 정보']],
      use: '마을에서 응급의료센터까지 자가용으로 걸리는 시간을 구해요. ‘응급실 30분 밖 주민’ 비율과 의료 취약도, 진단 지도의 응급의료센터 보기에 쓰여요.' },
  ] },
  { group: '교통', rows: [
    { name: '버스 정류장 위치', src: [['국토교통부', '전국 버스정류장 위치정보', 'https://www.data.go.kr/data/15067528/fileData.do']],
      use: '마을에서 가장 가까운 정류장까지 걸어서 몇 분인지 구해요. 모든 지역의 대중교통 판정과 교통 취약도에 쓰여요.' },
    { name: '버스 노선과 시간표', src: [['한국교통안전공단', 'TS-BIS 버스 노선과 시간표'], ['국토교통부', 'TAGO 버스노선정보'], ['각 군', '농어촌버스 시간표 (지역마다 다름)']],
      use: '정밀 판정 지역에서 마을마다 하루 버스 운행 횟수와 읍내행 첫차 시각을 판정에 반영해요.' },
  ] },
  { group: '마을 시설과 지정 현황', rows: [
    { name: '경로당 · 마을회관', src: [['지방자치단체', '전국마을회관및경로당표준데이터'], ['지방자치단체', '경로당 현황 (지역마다 다름)']],
      use: '레포트에서 ‘경로당 원격진료’ 대안의 근거 자료로 함께 제시돼요.' },
    { name: '인구감소지역 · 응급의료 취약지', src: [['행정안전부', '인구감소지역 (2021 지정)'], ['보건복지부', '응급의료분야 의료취약지 (2021 고시)']],
      use: '진단 화면에 지정 여부를 표시해요. 판정에는 쓰지 않아요.' },
  ] },
  { group: '지도', rows: [
    { name: '행정 경계', src: [['통계청', 'SGIS 행정경계 (vuski/admdongkor 가공)', 'https://github.com/vuski/admdongkor']],
      use: '전국 지도에서 시군구를 고르고, 지역 지도에 읍 · 면 경계를 그려요.' },
    { name: '도로망', src: [['OpenStreetMap 기여자', 'OpenStreetMap 도로망', 'https://www.openstreetmap.org/copyright']],
      use: '마을에서 병의원 · 응급의료센터까지 자가용 시간을 도로를 따라 계산해요. 순회 진료 버스의 운행 경로 시간에도 쓰여요.' },
    { name: '바탕 지도', src: [['OpenFreeMap', 'OpenMapTiles 지도 타일 (OpenStreetMap 기반)']],
      use: '모든 지도 화면의 배경(도로 · 지명 · 물길)을 그려요.' },
  ] },
]

// 라이선스: [자료, 설명, 라이선스, 링크]
const DATA_SOURCES: [string, string, string, string][] = [
  ['행정 경계', 'vuski/admdongkor ver20260701 · 통계청 SGIS 기반 (원자료 공공누리 제1유형)', 'CC BY 4.0', 'https://github.com/vuski/admdongkor'],
  ['바탕 지도', 'OpenFreeMap · OpenMapTiles · © OpenStreetMap 기여자', 'ODbL', 'https://www.openstreetmap.org/copyright'],
  ['도로망', '이동 시간 계산 · © OpenStreetMap 기여자', 'ODbL', 'https://www.openstreetmap.org/copyright'],
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

// 바깥 링크: 새 창으로 열고, 스크린리더에도 새 창이라고 알린다. 화살표만 다음 줄로 떨어지지 않게 마지막 낱말과 붙여 둔다
const Ext = ({ href, children }: { href: string; children: string }) => {
  const i = children.lastIndexOf(' ') + 1
  return (
    <a className="ext" href={href} target="_blank" rel="noopener noreferrer">
      {children.slice(0, i)}<span className="nowrap">{children.slice(i)}<span aria-hidden>↗</span></span><span className="sr-only"> (새 창)</span>
    </a>
  )
}

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
          <p className="lead">어떤 대회에 낸 시제품인지, 어떤 기준으로 계산하는지, 어떤 공공데이터를 어디에 쓰는지와 그 출처 · 라이선스를 한곳에 모았어요.</p>
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

            <section id="sources" className="about-sec" aria-labelledby="sources-title">
              <h2 id="sources-title">데이터 활용 및 출처</h2>
              <p>LocalLens는 인구 · 의료 · 교통 공공데이터를 마을 단위로 모아 진단하고 대안을 계산해요. 지도에는 공개 지도 데이터(OpenStreetMap)를 함께 써요. 아래는 지금 서비스가 실제로 쓰는 자료와 쓰임새예요.</p>

              <h3>공공데이터 활용 현황</h3>
              <table className="use-table">
                <thead><tr><th scope="col">활용 데이터</th><th scope="col">데이터 출처</th><th scope="col">LocalLens에서 쓰는 곳</th></tr></thead>
                {DATA_USE.map(({ group, rows }) => (
                  <tbody key={group}>
                    <tr className="grp"><th scope="colgroup" colSpan={3}>{group}</th></tr>
                    {rows.map(({ name, src, use }) => (
                      <tr key={name}>
                        <th scope="row">{name}</th>
                        <td className="src" data-label="출처">
                          <div>{src.map(([org, set, url]) => (
                            <span key={set}>{org && <small>{org}</small>}{url ? <Ext href={url}>{set}</Ext> : set}</span>
                          ))}</div>
                        </td>
                        <td data-label="활용">{use}</td>
                      </tr>
                    ))}
                  </tbody>
                ))}
              </table>
              <ul className="about-list use-notes">
                <li>버스 시간표와 경로당 자료는 지역마다 달라요. 지역을 고른 뒤 상단의 ‘가정과 출처’에서 그 지역이 쓰는 자료 목록을 볼 수 있어요.</li>
                <li>공급수단 단가와 원격진료 효과는 공공데이터가 아니라 가정값이에요. ‘가정과 출처’에서 직접 고칠 수 있어요.</li>
              </ul>

              <h3>판정 기준과 계산 방식</h3>
              <p>이 절은 어떤 데이터를 어디에 쓰는지만 다뤄요. 마을을 ‘갈 수 있음’으로 보는 기준, 정밀 판정과 간이 판정의 차이, 계산 방식과 한계는 <a className="ext" href="#data">데이터 및 분석 기준</a>에서 볼 수 있어요.</p>

              <h3 id="licenses">라이선스 및 저작권</h3>
              <h4>데이터</h4>
              <ul className="src-list">
                {DATA_SOURCES.map(([name, desc, license, url]) => (
                  <li key={name}><b>{name}</b><span>{desc}</span><Ext href={url}>{license}</Ext></li>
                ))}
                <li><b>지역별 공공데이터</b><span>인구 · 버스 · 의료 시설 자료는 지역마다 출처가 달라요. 지역을 고른 뒤 상단의 ‘가정과 출처’에서 볼 수 있어요.</span></li>
              </ul>
              <h4>이미지</h4>
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
