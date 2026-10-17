// 油站匹配：离已有油站多近算同一个；搜索结果转成候选油站
import { LngLat, metres } from "../common/geo"
import { Poi, Station, StationCandidate } from "../common/types"
import { stationIdFor } from "../sync/xxyh/mapping"

/** 与已有油站相距在此以内视为同一个 */
export const SAME_STATION_M = 80

export const stationPoint = (s: { lng: number; lat: number }): LngLat => [s.lng, s.lat]

export function nearestStation(stations: Station[], p: LngLat, limit: number): { station: Station; dist: number } | null {
  let best: { station: Station; dist: number } | null = null
  for (const s of stations) {
    const d = metres(stationPoint(s), p)
    if (d <= limit && (!best || d < best.dist)) best = { station: s, dist: d }
  }
  return best
}

/** 搜索结果新建的油站：id 用小熊 App「自定义」站点的算法，本机和小熊通用 */
export function stationFromPoi(poi: Poi, ts: number): Station {
  return {
    id: stationIdFor(poi.lng, poi.lat), name: poi.name, address: poi.address, province: poi.province,
    city: poi.city, district: poi.district, lng: poi.lng, lat: poi.lat, last_used_ts: ts,
  }
}

/** 搜索结果落在已有油站附近时用已有油站（高德与旧油站的坐标常差几米到几十米） */
export function candidateFromPoi(poi: Poi, stations: Station[], from: LngLat | null, now: number): StationCandidate {
  const mine = nearestStation(stations, [poi.lng, poi.lat], SAME_STATION_M)
  if (mine) return { kind: "mine", station: mine.station, dist: from ? metres(stationPoint(mine.station), from) : null }
  return { kind: "new", station: stationFromPoi(poi, now), dist: from ? metres([poi.lng, poi.lat], from) : null, src: poi.src }
}

const coreName = (s: string) => String(s || "").replace(/中国石化|中石化|中国石油|中石油|销售|有限公司|加油站|加油加气站|加气站|服务区|股份|[()（）\s·\-]/g, "")

export function sameStationName(a: string, b: string): boolean {
  const x = coreName(a)
  const y = coreName(b)
  return !!(x && y && (x.includes(y) || y.includes(x)))
}
