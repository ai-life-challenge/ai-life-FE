LocalLens OSM 파생 자료 (osm/)

Contains information from OpenStreetMap (https://www.openstreetmap.org/copyright),
which is made available here under the Open Database License (ODbL)
(https://opendatacommons.org/licenses/odbl/1-0/).
© OpenStreetMap contributors

이 폴더의 파일은 OpenStreetMap 자료로 만들었거나 그 값을 함께 담은 데이터베이스이고, ODbL 1.0으로 제공합니다.
누구나 무료로 받아 쓰고, 고치고, 다시 배포할 수 있습니다. 이 자료를 공개적으로 쓰면 ODbL 조건을 따라야 합니다.
자료는 있는 그대로 제공하며 정확성을 보증하지 않습니다.

파일
- index.json: 지역 59곳의 중심 좌표와 군 지표(인구 · 고령 비율 제외)
- <지역 코드>.json: 지역 하나의 마을 값. 코드 목록은 index.json의 regions 또는 ../manifest.json에 있습니다.
수집일 2026-11-06.

담긴 값
- 마을: lon, lat, seniorCenter, bus(stopWalkMin, noStop, dailyRuns, firstToTownMin, firstEstimated), nearest(시설 이름 · 종류 · 분)
- 지역: depot, facilityVillages(시설 → 마을), indicators
마을 id는 법정리 코드입니다. 인구, 마을 이름, 시설 좌표, 읍면 경계 같은 비OSM 자료는 상위 폴더 파일에 따로 있고 각자의 조건을 따릅니다
(../LICENSES.txt).

이 데이터베이스에 함께 담긴 비OSM 값
각 파일의 contents 칸에 출처와 조건이 있습니다. 이 칸의 출처 표시를 지우지 마세요. ODbL은 개별 내용물의 권리에는 적용되지 않습니다
(ODbL 제2.4조). 병의원 이름 · 종류는 건강보험심사평가원 자료(공공누리 제1유형), 곡성군 시간표 값은 곡성군 자료(공공누리 제1유형)이고
출처 표시가 필요합니다.

만든 방법 (ODbL 제4.6조)
1. 원자료: Geofabrik South Korea 추출본 south-korea-latest.osm.pbf(자료 기준 2026-10-12). OSM 자료 자체는 고치지 않았습니다.
2. 마을 지점: place가 village, hamlet, neighbourhood, quarter, isolated_dwelling이고 이름(name:ko, 없으면 name)이 있는 노드를 뽑아 법정리 이름과 잇습니다.
3. 마을 대표점 순서: (1) 손으로 정한 점(학교 표준데이터, 전국 정류장 이름, OSM 지명 지점 근거) (2) 그 리의 경로당 좌표 가운데
   (3) OSM 마을 지점. 공공데이터 좌표와 OSM 좌표가 같은 칸에 섞여 있어 lon, lat 칸 전체를 ODbL로 제공합니다.
4. 이동 시간: OSRM v5.27.1 기본 자동차 · 걷기 프로필(MLD)로 마을 대표점에서 시설까지 잽니다. 외부 속도 자료는 쓰지 않습니다.
5. 정류장: 공공데이터 정류장에 더해, 산청군은 전국 파일에 빠진 정류장을 OSM(highway=bus_stop, public_transport=platform + bus=yes, amenity=bus_station)에서 보탭니다.
   2km 안에 정류장이 없으면 걷는 시간을 60분으로, 시간표에 마을 이름으로 나오면 15분 이하로 둡니다.
6. 첫차 추정: 정류장별 시각이 없으면 출발 시각 + 자가용 분 × 1.3으로 어림하고 firstEstimated를 참으로 둡니다.

서버 계산이 쓰는 마을 간 자가용 분 표는 파일로 제공하지 않습니다. 위 대표점과 같은 원자료 · 프로필로 다시 만들 수 있습니다.

이 폴더에 없는 지역
장흥군, 진도군, 강화군, 보은군, 영동군, 괴산군, 금산군, 청양군, 홍성군, 예산군, 태안군, 예천군, 양양군: 원자료 이용 조건을 확인하는 중이라 정적 자료에 넣지 않았습니다. 서버가 정상일 때 공개 API에서 볼 수 있습니다.
