# LocalLens

> "우리 군에 예산이 있다면, 어디에 써야 할까?"

2026 AI 라이프 솔루션 챌린지 출품 시제품이에요. 전국 농어촌 72개 시군구에서 공공데이터로 마을마다 병원과 버스에 닿을 수 있는지 진단하고, 목표 달성률과 연 예산에 맞는 공급 대안 3개를 비교해 레포트까지 만들어요.

- **백엔드가 정상일 때**: 서버가 정식 최적화 계산을 하고, 화면은 그 결과를 그려요.
- **백엔드가 모두 멈췄을 때**: 미리 수집해 둔 지역 자료로 브라우저가 직접 추정 시뮬레이션을 해요. 지금 정적 자료가 준비된 지역은 59곳이고, 나머지 13곳은 서버가 정상일 때 지원해요.
- 추정으로 계산한 값은 화면에 항상 추정이라고 표시해요([서버 장애 때](#서버-장애-때)).

- 백엔드: `https://api.village-coverage.kro.kr` (API 문서: `/api/docs`, 팀 내부용)
- 배포: Cloudflare Workers 정적 배포 (`npm run deploy`)

## 실행

```bash
npm install
npm run dev      # http://localhost:5173 (운영 API를 바로 부른다)
npm test         # 브라우저 판정 규칙 · 서버 판정 대조 · 추정 계산 · 장애 대응
npm run build
npm run deploy   # 빌드 + wrangler deploy
npm run snapshot         # 정적 스냅샷 수집(비공개 폴더 snapshot.local/)
npm run snapshot:verify  # 비공개 수집본 검사 + 서버와 값 대조
npm run snapshot:public  # 공개 자료 생성(public/data/snapshot/, 59개 지역)
npm run snapshot:public:verify  # 공개 자료 검사 + 서버와 값 대조
```

API 주소는 `src/api/client.ts`의 기본값(운영 서버)이고, 다른 서버를 쓰려면 빌드할 때 `VITE_API_URL`을 넣어요. 값은 빌드 시점에 코드에 박히므로 바꾸면 다시 빌드·배포해야 해요.
운영 서버는 `http://localhost:*`, `https://*.workers.dev`, `https://*.pages.dev`, `https://*.vercel.app`, `https://village-coverage.kro.kr`, `https://*.village-coverage.kro.kr`만 CORS로 받아요.

## 화면 흐름

랜딩 → **지도 한 화면에서 S1~S5** → What-if / 레포트 (예전 `/intro` 주소는 지역 선택으로 넘어가요)

| 화면             | 경로                   | 내용                                                                                               | 서버 정상                                                             | 서버 장애 때                                         |
| ---------------- | ---------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------- |
| 랜딩             | `/`                    | 풀페이지 스크롤. 창녕군 계산 결과를 마을 집계 격자로 그린 그림 6장(기준 슬라이더, 정책 핀 등)      | regions, judge, plans, sensitivity, report                            | 저장한 창녕군 자료로 추정. 공문 예시는 비워 둠       |
| S1 지역 선택     | `/start`               | 전국 지도에서 72곳 중 선택, 호버 카드                                                              | `GET /api/regions`                                                    | 저장한 59곳 + 지원하지 않는 13곳을 따로 표시         |
| S2 현황 진단     | `/r/:code`             | 마을별 판정 지도, 기준(자가용·걷기·운행 횟수) 바꾸기, 마을 상세                                    | `GET /api/regions/{code}`, `…/map`, `POST /api/judge`, `/api/village` | 정적 자료 + 브라우저 판정 · 마을 카드                |
| S3 목표·예산     | `/r/:code/goal`        | 연 예산, 목표 달성률, 쓸 공급수단                                                                  | –                                                                     | 같음                                                 |
| S4 예산안 만들기 | `/r/:code/sim`         | 도구 호출 칩, 끝나면 결과로                                                                        | `POST /api/plans`                                                     | 브라우저 추정                                        |
| S5 결과          | `/r/:code/result`      | 대안 3개 카드, 추천, 지도에 고른 안, 단가 민감도                                                   | `POST /api/plans`, `/api/sensitivity`                                 | 브라우저 추정                                        |
| S6 What-if       | `/r/:code/whatif`      | 예산을 바꿔 본 대안, 예산별 최대 달성률 곡선                                                       | `POST /api/plans` (예산별)                                            | 브라우저 추정                                        |
| S7 가정과 출처   | 어디서든 (사이드 시트) | 지역 자료 출처, 단가·효과 가정 직접 수정                                                           | –                                                                     | 같음. 저장 자료의 수집일을 함께 표시                 |
| S8 레포트        | `/r/:code/report`      | 공문 초안, 문단을 문서 안에서 바로 고치기(서식 도구 · 자동 저장), PDF·링크                         | `POST /api/report`                                                    | 추정 요약 + PDF · 공유 링크(공문 초안 · 편집 없음)   |
| AI 질문          | S2 이후 모든 화면      | 서버 에이전트에게 묻기                                                                             | `GET /api/health`, `/api/examples`, `POST /api/ask`                   | AI가 아닌 자료 조회로 바뀜                           |
| 데이터와 기준    | `/about`               | 쓰는 데이터, 판정 기준, 출처와 이용 조건                                                           | –                                                                     | 같음                                                 |

'서버 장애 때'는 백엔드 전체 장애 · 정적 자료가 있는 59곳 기준이에요. 계산 API만 실패하면 자료는 서버에서 받은 것을 그대로 쓰고 계산만 브라우저가 해요.

## 판정과 서버 대조

기준(자가용 시간·정류장까지 걷는 시간·버스 운행 횟수)을 바꿀 때마다 서버를 부르면 느려서, `src/api/judge.ts`가 브라우저에서 바로 판정해 지도를 칠해요. 서버 판정(`POST /api/judge`)이 기준이라, 응답이 오면 마을별 판정과 합계를 대조해서 **다르면 서버 결과로 바꿔 보여 주고** 화면에 알려요.

- 정밀 지역은 하루 운행 횟수와 읍내행 첫차(낮 12시 전)까지, 나머지(간이 판정)는 정류장까지 걷는 거리만 봐요. 2026-11-09 서버 기준 72곳 중 정밀 40곳 · 간이 32곳이고(정적 자료 59곳 중 정밀 27곳), 화면의 지역 수는 `/api/health` 값을 써요.
- 마을 안에 병의원이 있으면 갈 수 있음, 자가용 기준 안에 병의원이 없으면 `병원이 너무 멀어 못 감`이에요.
- 이 규칙은 API 문서에 없어서 서버 결과에 맞춰 알아낸 거예요(72개 지역에서 서버 판정과 대조, [docs/estimated-simulation.md](docs/estimated-simulation.md)). 서버 규칙이 바뀌면 화면에 "서버와 N곳이 달라요"로 드러나요.

## 서버 장애 때

서버를 쓸 수 없으면 **브라우저가 직접 추정 시뮬레이션을 해요.** 추정에 쓰는 지역 자료는 실제 백엔드에서 받거나 미리 수집해 둔 값이고, 목데이터가 아니에요. 다만 추정 알고리즘은 서버의 최적화 계산과 같지 않아요.

| 상황 | 동작 |
| ---- | ---- |
| 지역 자료를 받은 뒤 계산 API 실패(연결 실패, 시간 초과, 5xx, 잘못된 응답) | 이미 받은 지역 자료로 브라우저가 판정 · 대안 3개 · 단가 민감도 · What-if를 추정하고, 레포트 대신 추정 요약을 보여 줘요 |
| 입력 오류(400 등) | 추정으로 숨기지 않고 오류를 보여 줘요 |
| 일부 API만 실패(지역 목록 · 지역 자료 · 경계) | 그 자료만 저장본을 쓰고 나머지는 서버 값을 써요. 저장본이 없는 13곳은 지원하지 않는다고 알려요 |
| 서버 전체 장애 · 정적 자료가 있는 59곳 | 처음 방문하거나 새로고침해도 시뮬레이션을 쓸 수 있어요. 추정임을 표시해요 |
| 서버 전체 장애 · 나머지 13곳 | 지금 지원하지 않는다고 알리고 값을 만들지 않아요. 서버가 정상일 때만 쓸 수 있고, 서버가 돌아오면 이어져요 |
| 서버 전체 장애 · 정적 파일 손상 | 진단과 계산을 할 수 없다고 안내하고 다시 시도를 줘요. 숫자를 만들어 채우지 않아요 |
| 서버 복구 | ‘서버로 다시 계산’을 누르거나 60초마다 하는 확인에서 돌아온 것을 알면, 입력값(지역 · 예산 · 목표 · 공급수단 · 단가 · 고른 안 · What-if 예산)을 유지한 채 서버 자료와 정식 계산으로 바뀌어요 |

**장애 중에도 쓰는 기능**(59곳): 진단(판정 지도 · 기준 바꾸기 · 마을 카드), 목표 · 예산 · 공급수단 · 단가 설정, 대안 3개와 추천, 지도 배치, 단가 민감도, 예산별 What-if, 추정 요약, PDF, 공유 링크.

**서버가 있어야 하는 기능**

- **생성형 AI 질문**: 장애 중 질문 창은 AI가 아닌 자료 조회로 바뀌어요. 저장 자료와 화면의 계산 값에서 공백 · 달성률 · 비용 · 배치 · 안별 차이 · 마을 판정 · 기준 · 출처만 찾아 답해요.
- **공문 초안과 문단 편집 저장**: 서버(`/api/report`)가 만들어서, 장애 중에는 추정 요약(계산 조건 · 3안 · 배치 · 근거 · 출처 · 기준 시점)으로 대신해요. 추정 요약은 고칠 수 없어요.

**한계**

- **추정은 실제 최적화 결과가 아니에요.** 달성률이 서버보다 높거나 낮게 나올 수 있고, 목표 달성 여부도 다를 수 있어요.
- **인터넷이 끊긴 상태에서 쓰는 완전 오프라인 서비스는 아니에요.** 앱과 정적 자료는 배포된 사이트에서 받고, 바탕 지도는 외부 지도 타일 서비스(OpenFreeMap)를 써서 인터넷이 끊기면 보이지 않아요.

### 정적 자료와 이용 조건

- **59개 지역**(마을 6,270곳 · 시설 2,918곳)만 `public/data/snapshot/`에 있어요. 나머지 13곳(진도 · 강화 · 보은 · 청양 · 홍성 · 금산 · 예산 · 예천 · 태안 · 양양 · 장흥 · 영동 · 괴산)은 자료별 이용 조건을 확인하기 전까지 넣지 않았어요.
- **OSM 파생 자료는 따로 둬요.** 전체 마을 좌표, 경로당 유무, 버스 값, 가까운 시설 결과처럼 OpenStreetMap에 의존하는 값은 ODbL 1.0 파일(`osm/`)로 나눴어요. 출처와 조건은 `LICENSES.txt` · `osm/README.txt`와 화면의 OSM · ODbL 고지에 있어요.
- 이용 조건은 공식 표시를 보고 판단한 것이고, 법률 검토를 마친 것은 아니에요. 남은 판단은 [docs/data-licenses.md](docs/data-licenses.md)에 있어요.
- **수집일과 기준 시점은 달라요.** 정적 자료는 2026-11-06에 서버에서 수집했어요. 이 날짜는 저장한 날이고, 원본 통계의 기준 시점은 자료마다 달라요(예: 주민등록 인구 2026-09-30, 생명표 2024, 전국 버스정류장 2025-10-31). 화면에는 수집일을, 추정 요약에는 원자료별 기준 시점을 함께 보여 줘요.
- **필요한 만큼만 받아요.** 서버가 정상이면 정적 파일을 받지 않아요. 장애 때 지역 목록은 `manifest.json`(약 40KB)과 `osm/index.json`만 받고, 지역을 고르면 그 지역의 두 파일만 받아요. 받은 파일은 SHA-256과 형식을 검사하고, 틀리면 값을 만들지 않아요.

추정 규칙과 서버 비교 결과는 [docs/estimated-simulation.md](docs/estimated-simulation.md)에, 정적 자료 구조와 전환은 [docs/offline-snapshot.md](docs/offline-snapshot.md)에, 이용 조건과 ODbL 분리는 [docs/data-licenses.md](docs/data-licenses.md)에 있어요.

## 폴더 구조

```
src/
  api/types.ts        API 요청·응답 타입
  api/client.ts       fetch 래퍼 · 오류(ApiError) · 지역 자료 캐시
  api/judge.ts        브라우저 판정 + 서버 판정 대조 (judge.test.ts)
  api/meta.ts         이름·색·숫자 표기
  api/estimatePlans.ts 서버 장애 때 쓰는 추정 계산 (estimatePlans.test.ts)
  api/fallback.ts     장애 판단 · 응답 검사 · 재시도 대기
  api/snapshot.ts     정적 스냅샷 읽기 · 검증 (manifest + 지역별 파일)
  api/snapshotSplit.ts 공공데이터 파일과 OSM 파생 파일(ODbL) 나누기 · 합치기
  api/villageLocal.ts 마을 카드를 원자료로 계산 (서버 대조: scripts/compare-village.test.ts)
  api/cells.ts        마을을 칸으로 묶어 집계 (랜딩 그림용, cells.test.ts)
  store.ts            zustand 전역 상태 (state · 지역 자료 · 서버 계산 결과와 로딩·오류 · 장애 전환)
  RegionRoute.tsx     /r/:code 화면의 지역 자료 불러오기 · 장애 중 지원하지 않는 지역 안내
  hooks.ts            useShownJudge · useAutoFetch (조건이 바뀌면 서버 계산을 다시 부름)
  map/                MapView(MapLibre + deck.gl) · geo
  chat/ChatDock.tsx   AI에게 물어보기 · 서버 장애 때 자료 조회(chat/localAnswer.ts)
  screens/            Landing · Select · Diagnose · Goal · Simulate · Results · WhatIf · Report · Sources · About
  screens/report/EstimatedSummary.tsx 서버 장애 때 레포트 대신 보여 주는 추정 요약
  ui/                 단계 메뉴 · 배지 · 지역 카드 · 도구 칩 · 카운트업 · 추정 안내 · OSM 고지
```

## 알아둘 점

- **AI 질문**: 서버에는 닿지만 에이전트가 꺼져 있으면(`/api/health`의 `agent: false`) 입력창을 막고 안내만 보여요. 서버에 닿지 못하거나 저장 자료를 쓰는 중이면 자료 조회로 바뀌어요. 질문은 IP별 하루 횟수 제한이 있어요(429).
- **state**: `GET /api/regions`의 `defaultState`에서 시작해, 바꾼 값만 바꿔 보내요. 서버는 범위를 벗어난 값을 400으로 거절해요(예: 예산 0~30억, 목표 50~100%).
- **단가·효과**는 가정값이에요. S7에서 고치면 대안이 다시 계산돼요.
- **레포트 고치기**: 문단은 TipTap 편집기로 문서 안에서 바로 고쳐요. 입력을 멈추거나 문단을 떠나면 고친 글을 넣은 state로 `POST /api/report`를 다시 불러 저장하고, 서버가 받아 준 뒤에만 '저장됨'으로 보여요. 서버는 문서를 따로 보관하지 않아서, 고친 문단과 아직 못 보낸 글은 지역마다 이 브라우저(localStorage)에 남겨 새로고침해도 이어져요. 문단 제목 · 비교 표 · 각주는 서버 계산 결과라 고칠 수 없어요. 서버 장애 중에는 공문 대신 추정 요약을 보여 줘요.

## 기술 스택

React 19 · TypeScript · Vite · Motion · zustand · react-router · MapLibre GL + react-map-gl · deck.gl · Vitest · oxlint · Cloudflare Workers(wrangler)

## 출처

- 행정 경계: [vuski/admdongkor](https://github.com/vuski/admdongkor) ver20260701 (통계청 SGIS 기반, CC BY 4.0)
- 바탕 지도: OpenFreeMap (© OpenStreetMap 기여자)
- 정적 자료: 공공데이터는 자료별 조건, OSM 파생 자료는 ODbL 1.0 ([docs/data-licenses.md](docs/data-licenses.md))
- 지역별 자료 출처는 서비스 안의 ‘가정과 출처’(S7)에 지역마다 나와요
