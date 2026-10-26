// 지도 위 점 묶기: 지금 확대 정도에서 화면 거리 px 안에 드는 점끼리 하나로 묶는다(거리 기반).
// 예전 칸 나누기 방식은 칸 경계에 걸친 두 점이 바로 옆인데도 따로 남아, 묶음 원과 낱개 아이콘이 겹쳐 보였다.
// 1) 주변 점이 많은 점부터 씨앗으로 잡아 px 안의 점을 모으고 2) 묶음 가운데에서 px 안에 남은 낱개도 마저 모은다. 점이 지역당 수백 개라 O(n²)도 충분히 빠르다.
export interface Cluster<T> { lon: number; lat: number; items: T[] }

// 웹 메르카토르 세계 좌표(줌 0에서 512px, MapLibre 타일 크기)
const worldX = (lon: number, scale: number) => ((lon + 180) / 360) * scale
const worldY = (lat: number, scale: number) => {
  const s = Math.sin((lat * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

export function clusterByPixel<T>(items: T[], at: (t: T) => [number, number], zoom: number, px = 48): Cluster<T>[] {
  const scale = 512 * 2 ** zoom
  const xy = items.map((t) => { const [lon, lat] = at(t); return [worldX(lon, scale), worldY(lat, scale)] })
  const near = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]) < px
  // 주변 점이 많은 점부터 씨앗으로(묶음이 촘촘한 곳 가운데에 생기게)
  const order = items.map((_, i) => i).sort((i, j) => xy.filter((p) => near(p, xy[j])).length - xy.filter((p) => near(p, xy[i])).length)
  const taken = new Array(items.length).fill(false)
  const groups: number[][] = []
  for (const i of order) {
    if (taken[i]) continue
    const g = order.filter((j) => !taken[j] && near(xy[i], xy[j]))
    g.forEach((j) => { taken[j] = true })
    groups.push(g)
  }
  const center = (g: number[]) => [g.reduce((a, j) => a + xy[j][0], 0) / g.length, g.reduce((a, j) => a + xy[j][1], 0) / g.length]
  // 묶음 가운데가 옮겨 가며 바로 옆에 낱개가 남으면 그 묶음에 넣는다(겹쳐 보이지 않게)
  const multi = groups.filter((g) => g.length > 1)
  for (const s of groups.filter((g) => g.length === 1)) {
    const host = multi.find((g) => near(center(g), xy[s[0]]))
    if (host) { host.push(s[0]); s.length = 0 }
  }
  return groups.filter((g) => g.length).map((g) => ({
    lon: g.reduce((a, j) => a + at(items[j])[0], 0) / g.length,
    lat: g.reduce((a, j) => a + at(items[j])[1], 0) / g.length,
    items: g.map((j) => items[j]),
  }))
}
