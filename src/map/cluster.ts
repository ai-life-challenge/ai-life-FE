// 지도 위 점 묶기: 지금 확대 정도에서 화면 px 크기의 칸으로 나눠, 같은 칸에 든 점끼리 하나로 묶는다.
// 점이 지역당 수백 개라 확대할 때마다 다시 계산해도 충분히 빠르다. (칸 경계에 걸친 두 점은 가까워도 따로 남을 수 있다)
export interface Cluster<T> { lon: number; lat: number; items: T[] }

// 웹 메르카토르 세계 좌표(줌 0에서 512px, MapLibre 타일 크기)
const worldX = (lon: number, scale: number) => ((lon + 180) / 360) * scale
const worldY = (lat: number, scale: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

export function clusterByPixel<T>(items: T[], at: (t: T) => [number, number], zoom: number, px = 44): Cluster<T>[] {
  const scale = 512 * 2 ** zoom
  const cells = new Map<string, T[]>()
  for (const t of items) {
    const [lon, lat] = at(t)
    const key = `${Math.floor(worldX(lon, scale) / px)},${Math.floor(worldY(lat, scale) / px)}`
    const c = cells.get(key)
    if (c) c.push(t)
    else cells.set(key, [t])
  }
  return [...cells.values()].map((members) => ({
    lon: members.reduce((a, t) => a + at(t)[0], 0) / members.length,
    lat: members.reduce((a, t) => a + at(t)[1], 0) / members.length,
    items: members,
  }))
}
