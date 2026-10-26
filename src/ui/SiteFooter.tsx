// 사이트 푸터 (랜딩 · 프로젝트 정보 공용). 검정 바탕에 브랜드 · 서비스 · 프로젝트 세 열 + 아래 저작권 줄.
// 같은 화면 안의 자리는 #링크로 둬서 랜딩의 부드러운 스크롤(useLandingScroll)이 받게 하고, 다른 화면이면 경로+#으로 옮겨 간다
import { Link, useLocation } from 'react-router'
import { Logo } from './Logo'

type Item = [label: string, path: string, hash: string]
const COLUMNS: { id: string; title: string; items: Item[] }[] = [
  { id: 'foot-service', title: '서비스', items: [['현황 진단', '/', '#diag'], ['예산안 비교', '/', '#plan'], ['레포트 · AI 질문', '/', '#report'], ['자주 묻는 질문', '/', '#faq']] },
  { id: 'foot-project', title: '프로젝트', items: [['2026 AI 라이프 솔루션 챌린지', '/about', '#challenge'], ['데이터 및 분석 기준', '/about', '#data'], ['라이선스 및 출처', '/about', '#licenses']] },
]

export function SiteFooter() {
  const here = useLocation().pathname
  return (
    <footer className="site-foot">
      <div className="wrap foot-main">
        <div className="foot-brand">
          <Logo />
          <p>우리 지역을 더 깊이 이해하는 방법.</p>
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.id} className="foot-nav" aria-labelledby={c.id}>
            <h2 id={c.id}>{c.title}</h2>
            <ul>
              {c.items.map(([label, path, hash]) => (
                <li key={label}>{path === here ? <a href={hash}>{label}</a> : <Link to={path + hash}>{label}</Link>}</li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="wrap">
        <div className="foot-bottom">
          <small>© 2026 LocalLens</small>
          <small>분석 결과는 참고용이며 공식 행정 평가를 대체하지 않습니다.</small>
        </div>
      </div>
    </footer>
  )
}
