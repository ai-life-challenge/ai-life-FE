// 3D 장면이 고정된 동안 스크롤 진행도(0~1). 스크롤 훅이 쓰고, 3D 장면이 읽는다(3D 묶음을 따로 불러와도 같이 쓰도록 작은 모듈로 둔다)
export const v3d = { p: 0, listeners: new Set<() => void>() }
export const setV3d = (p: number) => { v3d.p = p; v3d.listeners.forEach((f) => f()) }

// 현황 진단 장면에서 스크롤이 기준 슬라이더(정류장 걷는 시간 · 버스 운행 횟수)를 움직인다. 기준 그림이 자기 setter를 여기 걸어 둔다
export const criteria: { set: ((walk: number, runs: number) => void) | null } = { set: null }
