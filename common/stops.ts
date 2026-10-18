// 加油停车识别（与品牌无关）。规则与参数来自油猴脚本 v0.2.0：
// 用 2024-12 至 2026-10 的 916 段行程验证，74 条加油记录中 73 条能找到对应的加油停车，没有误判。
import { LngLat, metres } from "./geo"
import { FuelRecord, Poi, Station, StationCandidate } from "./types"
import { Place, Trip } from "../providers/types"
import { candidateFromPoi, nearestStation, SAME_STATION_M, stationPoint } from "../stations/match"

export const MINE_STAY_MAX_MIN = 45
export const NEW_STAY_MAX_MIN = 30
export const NEW_STATION_M = 60
export const STATION_SEARCH_M = 200
export const STOP_LOOKUPS_MAX = 12
/** 停车后多久内有加油记录算已记录（支付在熄火之后） */
export const RECORDED_WINDOW_MS = 3 * 3600e3

export type Stop = {
  trip: Trip
  end_ts: number
  place: Place | null
  odometer_km: number
  /** 停留分钟；最后一段行程之后还没有下一段时为 null */
  stay_min: number | null
  candidate: StationCandidate | null
  refuel: boolean
  recorded: FuelRecord | null
}

export type StopOptions = {
  stations: Station[]
  fuel: FuelRecord[]
  /** 附近搜索；没有时只认已有油站 */
  nearby: ((p: LngLat, radiusM: number) => Promise<Poi[]>) | null
  now: number
}

const point = (p: Place): LngLat => [p.lng, p.lat]

/** 停车后有没有对应的加油记录（熄火前 15 分钟到之后 3 小时） */
function recordedFor(endTs: number, fuel: FuelRecord[]): FuelRecord | null {
  return fuel.find(r => r.ts >= endTs - 15 * 60e3 && r.ts <= endTs + RECORDED_WINDOW_MS) || null
}

export async function findStops(trips: Trip[], opts: StopOptions): Promise<Stop[]> {
  const sorted = trips.slice().sort((a, b) => a.start_ts - b.start_ts)
  const stops: Stop[] = sorted.map((t, i) => {
    const next = sorted[i + 1]
    return {
      trip: t,
      end_ts: t.end_ts,
      place: t.end,
      odometer_km: t.end_odometer_km,
      stay_min: next ? (next.start_ts - t.end_ts) / 60e3 : null,
      candidate: null,
      refuel: false,
      recorded: recordedFor(t.end_ts, opts.fuel),
    }
  })
  const cache = new Map<string, StationCandidate | null>()
  let lookups = 0
  for (const s of stops.slice().reverse()) { // 先看最近的停车
    if (!s.place) continue
    const p = point(s.place)
    const mine = nearestStation(opts.stations, p, SAME_STATION_M)
    if (mine && (s.stay_min === null || s.stay_min <= MINE_STAY_MAX_MIN)) {
      s.candidate = { kind: "mine", station: mine.station, dist: mine.dist }
      s.refuel = true
      continue
    }
    const short = s.stay_min !== null ? s.stay_min <= NEW_STAY_MAX_MIN : opts.now - s.end_ts <= 2 * 3600e3
    if (!short || !opts.nearby || lookups >= STOP_LOOKUPS_MAX) continue
    lookups++
    const key = `${p[0].toFixed(4)},${p[1].toFixed(4)}`
    if (!cache.has(key)) cache.set(key, await nearestCandidate(p, opts).catch(() => null))
    const c = cache.get(key)
    if (c && c.dist != null && c.dist <= (c.kind === "mine" ? SAME_STATION_M : NEW_STATION_M)) {
      s.candidate = c
      s.refuel = true
    }
  }
  return stops
}

async function nearestCandidate(p: LngLat, opts: StopOptions): Promise<StationCandidate | null> {
  const pois = opts.nearby ? await opts.nearby(p, STATION_SEARCH_M) : []
  let best: { poi: Poi; dist: number } | null = null
  for (const poi of pois) {
    const d = metres([poi.lng, poi.lat], p)
    if (d <= STATION_SEARCH_M && (!best || d < best.dist)) best = { poi, dist: d }
  }
  if (!best) return null
  const c = candidateFromPoi(best.poi, opts.stations, p, opts.now)
  return c.kind === "mine" ? { ...c, dist: metres(stationPoint(c.station), p) } : c
}

/**
 * 缓存里的停车按当前数据重新判断（不发请求）：
 * - 「已记录」按当前的加油记录；
 * - 停车点 80 m 内现在有我的油站（之后新建的）时，算作在这个油站加油；
 * - 推荐的新油站已经建过（同一位置）时，改用已有的油站，避免重复新建。
 */
export function refreshStops(stops: Stop[], stations: Station[], fuel: FuelRecord[]): Stop[] {
  return stops.map(s => {
    let candidate = s.candidate
    let refuel = s.refuel
    if (s.place) {
      const p = point(s.place)
      const mine = nearestStation(stations, p, SAME_STATION_M)
      if (mine && (s.stay_min === null || s.stay_min <= MINE_STAY_MAX_MIN)) {
        candidate = { kind: "mine", station: mine.station, dist: mine.dist }
        refuel = true
      } else if (candidate && candidate.kind === "new") {
        const again = nearestStation(stations, stationPoint(candidate.station), SAME_STATION_M)
        if (again) candidate = { kind: "mine", station: again.station, dist: metres(stationPoint(again.station), p) }
      }
    }
    return { ...s, candidate, refuel, recorded: recordedFor(s.end_ts, fuel) }
  })
}

/** 显示顺序：未记录的加油停车（新的在前）→ 已记录的加油停车 → 其他停车（新的在前） */
export function rankStops(stops: Stop[]): Stop[] {
  const byRecent = (a: Stop, b: Stop) => b.end_ts - a.end_ts
  const open = stops.filter(s => s.refuel && !s.recorded).sort(byRecent)
  const done = stops.filter(s => s.refuel && s.recorded).sort(byRecent)
  const other = stops.filter(s => !s.refuel).sort(byRecent)
  return [...open, ...done, ...other]
}

/**
 * 默认选择：有支付时间时取支付前 3 小时内最近的加油停车；
 * 没有时取最近一次未记录的加油停车。找不到时退回最近一段行程。
 */
export function chooseStop(stops: Stop[], at: number | null): { stop: Stop; kind: "refuel" | "trip" } | null {
  const sorted = stops.slice().sort((a, b) => a.end_ts - b.end_ts)
  if (at) {
    const win = sorted.filter(s => s.end_ts <= at + 2 * 60e3 && s.end_ts >= at - RECORDED_WINDOW_MS)
    const refuel = win.filter(s => s.refuel).pop()
    if (refuel) return { stop: refuel, kind: "refuel" }
    return win.length ? { stop: win[win.length - 1], kind: "trip" } : null
  }
  const open = sorted.filter(s => s.refuel && !s.recorded).pop()
  if (open) return { stop: open, kind: "refuel" }
  return sorted.length ? { stop: sorted[sorted.length - 1], kind: "trip" } : null
}

/** 记录页顶部提示用：最近 maxAgeMs 内、还没记录、没被忽略的加油停车（最新的一次）。用当前的加油记录重新判断「已记录」 */
export function openRefuelStop(stops: Stop[], fuel: FuelRecord[], dismissed: number[], now: number, maxAgeMs = 48 * 3600e3): Stop | null {
  const list = stops
    .filter(s => s.refuel && now - s.end_ts <= maxAgeMs && !dismissed.includes(s.end_ts) && !recordedFor(s.end_ts, fuel))
    .sort((a, b) => b.end_ts - a.end_ts)
  return list[0] || null
}
