# VillageCoverage-ai

> "우리 군에 예산이 있다면, 어디에 써야 할까?"

2026 AI 라이프 솔루션 챌린지 출품 시제품이에요. 전국 72개 시군구에서 마을마다 병원과 버스에 닿을 수 있는지 진단하고, 목표 달성률과 연 예산에 맞는 대안 3개를 비교해 레포트까지 만들어요. **계산은 모두 서버가 하고 화면은 결과만 그려요.**

- 백엔드: `https://api.village-coverage.kro.kr` (API 문서: `/api/docs`, 팀 내부용)
- 배포: Cloudflare Workers 정적 배포 (`npm run deploy`)

## 실행

```bash
npm install
npm run dev      # http://localhost:5173 (운영 API를 바로 부른다)
npm test         # 브라우저 판정 규칙 · 서버 판정 대조
npm run build
npm run deploy   # 빌드 + wrangler deploy
```

API 주소는 `src/api/client.ts`의 기본값(운영 서버)이고, 다른 서버를 쓰려면 빌드할 때 `VITE_API_URL`을 넣어요. 값은 빌드 시점에 코드에 박히므로 바꾸면 다시 빌드·배포해야 해요.
운영 서버는 `http://localhost:*`, `https://*.workers.dev`, `https://*.pages.dev`, `https://*.vercel.app`, `https://village-coverage.kro.kr`, `https://*.village-coverage.kro.kr`만 CORS로 받아요.

## 화면 흐름

랜딩 → S0 인트로 → **지도 한 화면에서 S1~S5** → What-if / 레포트

| 화면 | 경로 | 내용 | 서버 호출 |
|---|---|---|---|
| 랜딩 | `/` | 풀페이지 스크롤. 창녕군 서버 계산 결과를 마을 집계 격자로 그린 그림 6장(기준 슬라이더, 정책 핀 등) | regions, judge, plans, sensitivity, report |
| S0 인트로 | `/intro` | 문제 체감 문구 3줄 (창녕군 서버 계산 값) | judge |
| S1 지역 선택 | `/start` | 전국 지도에서 72곳 중 선택, 호버 카드 | `GET /api/regions` |
| S2 현황 진단 | `/r/:code` | 마을별 판정 지도, 기준(자가용·걷기·운행 횟수) 바꾸기, 마을 상세 | `GET /api/regions/{code}`, `…/map`, `POST /api/judge`, `/api/village` |
| S3 목표·예산 | `/r/:code/goal` | 연 예산, 목표 달성률, 쓸 공급수단 | – |
| S4 안 만들기 | `/r/:code/sim` | 도구 호출 칩, 끝나면 결과로 | `POST /api/plans` |
| S5 결과 | `/r/:code/result` | 대안 3개 카드, 추천, 지도에 고른 안, 단가 민감도 | `POST /api/plans`, `/api/sensitivity` |
| S6 What-if | `/r/:code/whatif` | 예산을 바꿔 본 대안, 예산별 최대 달성률 곡선 | `POST /api/plans` (예산별) |
| S7 가정과 출처 | 어디서든 (사이드 시트) | 지역 자료 출처, 단가·효과 가정 직접 수정 | – |
| S8 레포트 | `/r/:code/report` | 공문/주민 안내문 초안, 문단 직접 고치기, PDF·링크 | `POST /api/report` |
| AI 질문 | S2 이후 모든 화면 | 서버 에이전트에게 묻기 | `GET /api/examples`, `POST /api/ask` |

## 판정과 서버 대조

기준(자가용 시간·정류장까지 걷는 시간·버스 운행 횟수)을 바꿀 때마다 서버를 부르면 느려서, `src/api/judge.ts`가 브라우저에서 바로 판정해 지도를 칠해요. 서버 판정(`POST /api/judge`)이 기준이라, 응답이 오면 마을별 판정과 합계를 대조해서 **다르면 서버 결과로 바꿔 보여 주고** 화면에 알려요.

- 정밀 지역(5곳)은 하루 운행 횟수와 읍내행 첫차(낮 12시 전)까지, 나머지(간이 판정)는 정류장까지 걷는 거리만 봐요.
- 마을 안에 병의원이 있으면 갈 수 있음, 자가용 기준 안에 병의원이 없으면 `병원이 너무 멀어 못 감`이에요.
- 이 규칙은 API 문서에 없어서 서버 결과에 맞춰 알아낸 거예요(5개 시군구 · 여러 기준에서 일치 확인). 서버 규칙이 바뀌면 화면에 "서버와 N곳이 달라요"로 드러나요.

## 폴더 구조

```
src/
  api/types.ts        API 요청·응답 타입
  api/client.ts       fetch 래퍼 · 오류(ApiError) · 지역 자료 캐시
  api/judge.ts        브라우저 판정 + 서버 판정 대조 (judge.test.ts)
  api/meta.ts         이름·색·숫자 표기
  api/cells.ts        마을을 칸으로 묶어 집계 (랜딩 그림용, cells.test.ts)
  store.ts            zustand 전역 상태 (state · 지역 자료 · 서버 계산 결과와 로딩·오류)
  hooks.ts            useShownJudge · useAutoFetch (조건이 바뀌면 서버 계산을 다시 부름)
  map/                MapView(MapLibre + deck.gl) · geo
  chat/ChatDock.tsx   AI에게 물어보기
  screens/            Landing · Intro · Select · Diagnose · Goal · Simulate · Results · WhatIf · Report · Sources
  ui/                 단계 메뉴 · 배지 · 지역 카드 · 도구 칩 · 카운트업
```

## 알아둘 점

- **AI 질문**: 서버 에이전트가 꺼져 있으면(`/api/health`의 `agent: false`) 입력창을 막고 안내만 보여요. 질문은 IP별 하루 횟수 제한이 있어요(429).
- **state**: `GET /api/regions`의 `defaultState`에서 시작해, 바꾼 값만 바꿔 보내요. 서버는 범위를 벗어난 값을 400으로 거절해요(예: 예산 0~30억, 목표 50~100%).
- **단가·효과**는 가정값이에요. S7에서 고치면 대안이 다시 계산돼요.

## 기술 스택

React 19 · TypeScript · Vite · Motion · zustand · react-router · MapLibre GL + react-map-gl · deck.gl · Vitest · oxlint · Cloudflare Workers(wrangler)

## 출처

- 행정 경계: [vuski/admdongkor](https://github.com/vuski/admdongkor) ver20260701 (통계청 SGIS 기반, CC BY 4.0)
- 바탕 지도: OpenFreeMap (© OpenStreetMap 기여자)
- 지역별 자료 출처는 서비스 안의 ‘가정과 출처’(S7)에 지역마다 나와요
