# VillageCoverage (프론트엔드)

2026 AI 라이프 솔루션 챌린지 시제품. 인구가 적은 군의 생활서비스 공백을 500m 격자로 진단하고 대안을 비교한다.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # mock 계산 검사
npm run build
```

## 구조

- `src/api/types.ts` — 백엔드(에이전트 도구 diagnose/optimize/compare/explain_area/get_assumptions)와 맞출 형식
- `src/api/mock.ts` — DEMO 시제품 계산을 옮긴 가상 데이터 모델. 백엔드가 준비되면 같은 형식의 http 구현으로 바꾼다
- `src/map/MapView.tsx` — 지도 하나(MapLibre + deck.gl interleaved). 화면이 바뀌어도 카메라가 이어진다
- `src/screens/` — 지역 선택, 공백 진단

## 데이터와 출처

- 행정 경계: [vuski/admdongkor](https://github.com/vuski/admdongkor) ver20260701 (통계청 SGIS 기반, CC BY 4.0). `public/data/`에 시군구(전국)와 읍면(창녕·의령·함안)을 mapshaper로 단순화해 넣었다.
- 바탕 지도: OpenFreeMap (© OpenStreetMap 기여자)
- 인구·시설·버스·이동시간은 모두 가상 값이다.
