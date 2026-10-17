// 坐标转换与距离。点的格式为 [经度, 纬度]。
// 应用内部一律 WGS-84；沃尔沃、高德是 GCJ-02，小熊的旧油站是 BD-09。

export type LngLat = [number, number]

const EARTH_A = 6378245.0
const EARTH_EE = 0.00669342162296594323

function transformLat(x: number, y: number): number {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3
  return r
}

function transformLng(x: number, y: number): number {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3
  return r
}

export function wgs84ToGcj02([lng, lat]: LngLat): LngLat {
  let dLat = transformLat(lng - 105, lat - 35)
  let dLng = transformLng(lng - 105, lat - 35)
  const rad = lat / 180 * Math.PI
  const magic = 1 - EARTH_EE * Math.sin(rad) ** 2
  const sq = Math.sqrt(magic)
  dLat = dLat * 180 / ((EARTH_A * (1 - EARTH_EE)) / (magic * sq) * Math.PI)
  dLng = dLng * 180 / (EARTH_A / sq * Math.cos(rad) * Math.PI)
  return [lng + dLng, lat + dLat]
}

export function gcj02ToWgs84([lng, lat]: LngLat): LngLat {
  let w: LngLat = [lng, lat]
  for (let i = 0; i < 5; i++) {
    const g = wgs84ToGcj02(w)
    w = [w[0] - (g[0] - lng), w[1] - (g[1] - lat)]
  }
  return w
}

export function bd09ToGcj02([lng, lat]: LngLat): LngLat {
  const x = lng - 0.0065
  const y = lat - 0.006
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180)
  const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180)
  return [z * Math.cos(t), z * Math.sin(t)]
}

export function gcj02ToBd09([lng, lat]: LngLat): LngLat {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * Math.PI * 3000 / 180)
  const t = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * Math.PI * 3000 / 180)
  return [z * Math.cos(t) + 0.0065, z * Math.sin(t) + 0.006]
}

export function bd09ToWgs84(p: LngLat): LngLat {
  return gcj02ToWgs84(bd09ToGcj02(p))
}

/** 两点间的球面距离（米） */
export function metres(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180
  const h = Math.sin((b[1] - a[1]) * r / 2) ** 2
    + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin((b[0] - a[0]) * r / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(h))
}

export function distanceText(m: number | null | undefined): string {
  if (m == null) return ""
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}
