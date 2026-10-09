# 우리 군 100억 (VillageCoverage-ai)

2026 AI 라이프 솔루션 챌린지 시제품. “우리 군에 100억이 있다면, 어디에 써야 할까?” — 의료·교통 공공데이터로 군의 취약도를 진단하고, AI가 예산안 3개를 만들어 비교·설명한 뒤 레포트로 정리한다.
기준 문서: 노션 `구현안`(D1–D9 체크안) + `스토리보드`(S0–S8). 지도와 'AI에게 물어보기'는 VillageCoverage 시제품과 같은 인터랙션으로 가져왔다.

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # 배분 엔진·AI mock·레포트 숫자 대조 검사
npm run build
```

## 화면 (스토리보드)

| 화면 | 경로 | 파일 |
|---|---|---|
| 랜딩 | `/` | `screens/Landing.tsx` |
| S0 인트로 | `/intro` | `screens/Intro.tsx` |
| S1 지역 선택 (지도) | `/start` | `screens/Select.tsx` |
| S2 현황 진단 (지도) | `/r/:code` | `screens/Diagnose.tsx` |
| S3 목표·예산 | `/r/:code/goal` | `screens/Goal.tsx` |
| S4 AI 시뮬레이션 | `/r/:code/sim` | `screens/Simulate.tsx` |
| S5 예산안 3개 비교 (지도) | `/r/:code/result` | `screens/Results.tsx` |
| S6 What-if | `/r/:code/whatif` | `screens/WhatIf.tsx` |
| S7 가정과 출처 | 어디서든 (사이드 시트) | `screens/Sources.tsx` |
| S8 AI 레포트 | `/r/:code/report?b=&p=&c=` | `screens/Report.tsx` |

## 구조

- `src/data/regions.ts` — 창녕·의령·함안 지표와 출처. **숫자는 모두 예시값**이고, 데이터 수집 후 이 파일만 바꾸면 된다.
- `src/sim/model.ts` — 엔진(구현안 4장). 점수(D2-C), 프리셋 3개(D3-C), 레버 6개와 체감 효과함수(D6), 교차효과(D7: 버스·DRT → 배차간격 → 병원 대중교통시간 → 실효 E30), 1억 단위 greedy 배분, 단가 저/중/고 결과 범위, What-if 곡선, AI 추천(균형 잣대 취약도 감소 × 수혜 인구).
- `src/api/agent.ts` — AI 에이전트 mock. 실서비스 SSE와 같은 이벤트(`tool_call / tool_result / text / clarify / apply / done`)를 흘려보낸다. 백엔드가 준비되면 같은 이벤트를 내는 http 구현으로 바꾼다.
- `src/map/` — 지도 하나(MapLibre + deck.gl interleaved)가 S1·S2·S5 뒤에 깔리고 카메라가 이어진다. S1 시군구·후보 맥동·군 위 호버 카드, S2 500m 격자(펼침·시간 스윕·3D·AI 빗금·칸 클릭 경로), S5 예산안 정책 배치(`planMap.ts`). 격자(`grid.ts`)의 마을·인구·버스는 가상 값이다.
- `src/chat/ChatDock.tsx` — 'AI에게 물어보기' 버튼과 창. 답에 따라 예산·목표·단가가 바뀌면 화면이 바로 다시 계산된다(`api/agent.ts`의 `ask`).
- `src/api/report.ts` — 레포트 초안. 문장 속 숫자는 모두 `{ n, tip }` 토큰이라 출처 툴팁과 숫자 대조 검사에 쓴다.

## 구현안과 다르게 둔 것

- 병원 대중교통시간 100점 기준을 60분 → **120분**으로 뒀다. 예시 지역 값(74·91분)이 60분을 넘어 버스 증차 효과가 점수에 안 잡혀서다. `STD.htFull`.
- 교차효과는 `실효 E30 = (1−τ)·E30 + τ·(대중교통 60분 밖 비율)`, τ = 고령비율×0.5로 연결했다(가정값, S7에 공개).
- 응급 거점·의료인력·구조개선 단가와 효과 계수는 출처가 없어 가정값으로 두고 S7에서 고칠 수 있게 했다.

## 지도 데이터와 출처

- 행정 경계: [vuski/admdongkor](https://github.com/vuski/admdongkor) ver20260701 (통계청 SGIS 기반, CC BY 4.0). `public/data/`는 VillageCoverage 시제품과 같은 파일.
- 바탕 지도: OpenFreeMap (© OpenStreetMap 기여자)
