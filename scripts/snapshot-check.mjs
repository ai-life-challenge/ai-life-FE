// 스냅샷 자료 검사(수집 · 대조 스크립트가 같이 쓴다). 값을 고치지 않고 문제만 돌려준다.

// 앱이 읽지 않는 칸은 저장하지 않는다(공개 범위와 크기를 줄인다). 남기는 칸의 값은 바꾸지 않는다.
// 학교 · 도서관 시간, 읍면 약국 여부, TS-BIS 참고 운행 횟수: src에서 쓰지 않는다
export function stripRegion(data) {
  const { indicators: { runsShareBis: _r, ...indicators }, ...rest } = data
  return {
    ...rest, indicators,
    myeons: data.myeons.map(({ pharmacy: _p, ...m }) => m),
    villages: data.villages.map((v) => {
      const { nearest: { school: _s, library: _l, ...nearest }, bus: { dailyRunsBis: _d, ...bus }, ...r } = v
      return { ...r, bus, nearest }
    }),
  }
}
const isNum = (x) => typeof x === 'number' && Number.isFinite(x)
const inKorea = (lon, lat) => isNum(lon) && isNum(lat) && lon > 124 && lon < 132 && lat > 33 && lat < 39.5

// 지역 하나의 자료와 경계가 지역 목록과 맞고, 화면 · 추정 계산이 읽는 칸이 비어 있지 않은지
export function checkRegion(item, data, map) {
  const e = []
  if (!data || typeof data !== 'object') return ['지역 자료가 없음']
  for (const k of ['code', 'name', 'sido', 'tier']) if (data[k] !== item[k]) e.push(`${k} 불일치: ${data[k]} ≠ ${item[k]}`)
  if (!Array.isArray(data.villages) || !data.villages.length) return [...e, '마을 목록이 비어 있음']
  if (!Array.isArray(data.facilities)) e.push('시설 목록이 없음')
  if (!Array.isArray(data.myeons) || !data.myeons.length) e.push('읍면 목록이 없음')
  if (!Array.isArray(data.sources) || !data.sources.length) e.push('출처 목록이 없음')
  if (!data.indicators || !isNum(data.indicators.pop)) e.push('군 지표가 없음')
  if (data.villages.length !== item.villages) e.push(`마을 수 불일치: ${data.villages.length} ≠ ${item.villages}`)

  const ids = new Set(), myeons = new Set((data.myeons ?? []).map((m) => m.id))
  for (const v of data.villages) {
    const at = `마을 ${v?.id}`
    if (typeof v?.id !== 'string' || !v.id) { e.push('id 없는 마을'); continue }
    if (ids.has(v.id)) e.push(`${at} id 중복`)
    ids.add(v.id)
    if (!v.id.startsWith(item.code)) e.push(`${at}: id가 지역 코드로 시작하지 않음`)
    if (typeof v.name !== 'string' || !v.name) e.push(`${at}: 이름 없음`)
    if (!myeons.has(v.myeon)) e.push(`${at}: 없는 읍면 ${v.myeon}`)
    if (!inKorea(v.lon, v.lat)) e.push(`${at}: 좌표 이상 ${v.lon},${v.lat}`)
    for (const a of ['all', 'a65', 'a80']) if (!isNum(v.pop?.[a]) || v.pop[a] < 0) e.push(`${at}: 인구 ${a} 이상`)
    if (v.pop && !(v.pop.a80 <= v.pop.a65 && v.pop.a65 <= v.pop.all)) e.push(`${at}: 연령대 인구 순서 이상`)
    if (!isNum(v.a80In10y)) e.push(`${at}: a80In10y 이상`)
    if (typeof v.seniorCenter !== 'boolean') e.push(`${at}: seniorCenter 이상`)
    if (!v.bus || !isNum(v.bus.stopWalkMin) || typeof v.bus.noStop !== 'boolean') e.push(`${at}: 버스 자료 이상`)
    if (data.tier === 'precise' && !isNum(v.bus?.dailyRuns)) e.push(`${at}: 정밀 지역인데 하루 운행 횟수가 없음`) // 간이 지역 응답에는 운행 칸이 원래 없다
    if (data.tier === 'auto' && v.bus && 'dailyRuns' in v.bus) e.push(`${at}: 간이 지역인데 하루 운행 횟수가 있음`)
    if (!v.nearest || !('med' in v.nearest)) e.push(`${at}: 가까운 시설 자료 없음`)
    if (v.nearest?.med && !isNum(v.nearest.med.minutes)) e.push(`${at}: 병의원 시간 이상`)
  }
  if (!ids.has(data.depot)) e.push(`보건소 출발 마을 ${data.depot}이 마을 목록에 없음`)
  if (!ids.has(data.town) && typeof data.town !== 'string') e.push('읍내 정보 없음')
  const facIds = new Set()
  for (const f of data.facilities ?? []) {
    if (facIds.has(f.id)) e.push(`시설 ${f.id} id 중복`)
    facIds.add(f.id)
    if (f.village != null && !ids.has(f.village)) e.push(`시설 ${f.id}: 없는 마을 ${f.village}`)
    if (!inKorea(f.lon, f.lat)) e.push(`시설 ${f.id}: 좌표 이상`)
    if (!isNum(f.doctors)) e.push(`시설 ${f.id}: 의사 수 이상`)
  }
  if (!map || map.type !== 'FeatureCollection' || !Array.isArray(map.features) || !map.features.length) return [...e, '읍면 경계가 없음']
  const bounds = new Set(map.features.map((f) => f.properties?.id))
  for (const f of map.features) if (!['Polygon', 'MultiPolygon'].includes(f.geometry?.type) || !f.geometry.coordinates?.length) e.push(`경계 ${f.properties?.id}: 도형 이상`)
  for (const m of data.myeons ?? []) if (!bounds.has(m.id)) e.push(`읍면 ${m.id}(${m.name}) 경계 없음`)
  return e
}

// 공개하면 안 되는 값이 섞였는지 본다. 값의 형태로 찾는 검사라, 통과가 곧 민감정보 없음의 증명은 아니다.
// 숫자는 보지 않는다(경계 좌표 127.01960253235의 소수 부분이 전화번호 형태로 잡힌다). 문자열 값과 칸 이름만 본다
const SECRET_KEY = /^(api[_-]?key|service[_-]?key|secret|token|password|passwd|authorization|phone|tel|email|ssn|rrn)$/i
const SENSITIVE = [
  [/serviceKey=|[?&](api)?key=|https?:\/\//i, 'URL 또는 키'],
  [/\b\d{6}-[1-4]\d{6}\b/, '주민등록번호 형태'],
  [/\b0\d{1,2}-?\d{3,4}-?\d{4}\b/, '전화번호 형태'],
  [/[\w.+-]+@[\w-]+\.[\w.]+/, '이메일 형태'],
  [/\b(?:10|127|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\b/, '내부 IP 형태'],
  [/\/(?:home|Users|root|var|srv)\/[\w.-]+/, '서버 파일 경로 형태'],
  [/\bsk-[A-Za-z0-9_-]{16,}/, 'API 키 형태'],
]
const NOT_TEXT = new Set(['coordinates', 'id', 'code', 'myeon', 'village', 'town', 'depot']) // 좌표와 식별자(법정동 코드 · 시설 해시)는 글이 아니다
export function scanSensitive(root) {
  const found = new Set()
  const walk = (o) => {
    if (typeof o === 'string') { for (const [re, name] of SENSITIVE) if (re.test(o)) found.add(`${name} 발견: ${o.slice(0, 40)}`); return }
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (SECRET_KEY.test(k)) found.add(`비밀값 이름의 칸: ${k}`); if (!NOT_TEXT.has(k)) walk(v) }
  }
  walk(root)
  return [...found]
}
