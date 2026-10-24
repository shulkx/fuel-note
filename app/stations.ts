// 油站搜索（设计文档第 9 节）和按单价判断标号用的油价。开关打开时有高德 key 用高德，否则用小熊的附近油站
import { LngLat, metres } from "../common/geo"
import { AppData, fuelRecords, stationsFor } from "../common/ledger"
import { CityPrices, PriceRef, priceRefAt } from "../common/receipt"
import { Stop } from "../common/stops"
import { Station, StationCandidate, Vehicle } from "../common/types"
import { createPoiCache, PoiCacheEntries } from "../stations/poi_cache"
import { amapSearcher, StationSearcher, xxyhSearcher } from "../stations/search"
import { candidateFromPoi, stationPoint } from "../stations/match"
import { cityPrices, price92History } from "../sync/xxyh/api"
import { scriptingHttp } from "../platform/scripting_http"
import { getSecret, SECRET_AMAP_KEY, setSecret } from "../platform/secrets"
import { readCache, writeCache } from "../platform/storage"
import { errorText } from "./errors"
import { xxyhToken } from "./xxyh_io"

export const amapKey = () => getSecret(SECRET_AMAP_KEY)
export const setAmapKey = (key: string) => setSecret(SECRET_AMAP_KEY, key)

/** 用这个 key 实际查一次附近加油站（上海人民广场 2 km）；key 无效、额度用完时抛出高德的错误信息 */
export async function testAmapKey(key: string): Promise<string> {
  const t0 = Date.now()
  const pois = await amapSearcher(scriptingHttp, key).nearby([121.4691, 31.2323], 2000)
  return `查到 ${pois.length} 个加油站，${((Date.now() - t0) / 1000).toFixed(1)} 秒`
}

type PoiCacheFile = { schema_version: 1; entries: PoiCacheEntries }
const POI_CACHE_FILE = "poi_cache.json"

/** 附近搜索的结果按坐标缓存 30 天（cache/poi_cache.json） */
const poiCache = createPoiCache({
  load: () => {
    const f = readCache<PoiCacheFile>(POI_CACHE_FILE)
    return f && f.schema_version === 1 && f.entries ? f.entries : null
  },
  save: entries => writeCache(POI_CACHE_FILE, { schema_version: 1, entries }),
  now: () => Date.now(),
})

function rawSearcher(data: AppData): StationSearcher | null {
  if (data.ledger.settings.station_search === "off") return null
  const amap = amapKey()
  if (amap) return amapSearcher(scriptingHttp, amap)
  const token = xxyhToken()
  return token ? xxyhSearcher(scriptingHttp, token) : null
}

/** 附近和关键字搜索；关掉或都没有凭据时 null（只用我的油站） */
export function searcher(data: AppData): StationSearcher | null {
  const s = rawSearcher(data)
  return s ? { ...s, nearby: poiCache.wrap(s.name, (p, r) => s.nearby(p, r)) } : null
}

export function searcherName(data: AppData): string {
  return searcher(data)?.name || "不搜索，只用我的油站"
}

const priceCache = new Map<string, Promise<{ current: CityPrices | null; history: Array<[number, number]> }>>()

/** 某个城市在某个时刻的 92#、95# 油价，用来按单价判断标号。当前油价需要小熊凭据，历史油价不需要 */
export async function priceRefFor(city: string, province: string, atMs: number): Promise<PriceRef | null> {
  if (!city) return null
  const key = `${province}|${city}`
  let entry = priceCache.get(key)
  if (!entry) {
    const token = xxyhToken()
    entry = Promise.all([
      token ? cityPrices(scriptingHttp, token, province || city, city).catch(() => null) : Promise.resolve(null),
      price92History(scriptingHttp, city).catch(() => [] as Array<[number, number]>),
    ]).then(([current, history]) => ({ current, history }))
    priceCache.set(key, entry)
    entry.then(v => { if (!v.current && !v.history.length) priceCache.delete(key) }) // 都失败时下次重试
  }
  const { current, history } = await entry
  return priceRefAt(current, history, atMs, city)
}

const MUNICIPALITY = /^(北京|上海|天津|重庆)市$/

/** 判断标号用哪个城市的油价：油站所在城市 → 停车点所在城市 → 最近一次加油的油站所在城市 */
export function priceCityFor(data: AppData, vehicle: Vehicle, station: Station | null, stop: Stop | null): { city: string; province: string } {
  const pick = (city: string, province: string) => ({ city, province: province || (MUNICIPALITY.test(city) ? city : "") })
  if (station && station.city) return pick(station.city, station.province)
  if (stop && stop.place && stop.place.city) return pick(stop.place.city, "")
  const stations = stationsFor(data, vehicle)
  for (const r of fuelRecords(data, vehicle)) {
    const s = r.station_id ? stations.find(x => x.id === r.station_id) : null
    if (s && s.city) return pick(s.city, s.province)
  }
  return { city: "", province: "" }
}

/** 选油站：附近（以 center 为中心）或关键字；都没有时按最近使用排序 */
export async function stationCandidates(data: AppData, vehicle: Vehicle | null, center: LngLat | null, keyword: string): Promise<{ list: StationCandidate[]; error: string | null }> {
  const mine = stationsFor(data, vehicle)
  const now = Date.now()
  const out: StationCandidate[] = []
  const seen = new Set<string>()
  const add = (c: StationCandidate) => {
    if (seen.has(c.station.id)) return
    seen.add(c.station.id)
    out.push(c)
  }
  const s = searcher(data)
  let error: string | null = null
  const kw = keyword.trim()
  if (kw) {
    for (const st of mine.filter(x => x.name.includes(kw) || x.address.includes(kw)).slice(0, 8)) add({ kind: "mine", station: st, dist: center ? metres(stationPoint(st), center) : null })
    if (s && s.keyword) {
      const city = center ? (mine.slice().sort((a, b) => metres(stationPoint(a), center) - metres(stationPoint(b), center))[0]?.city || "") : ""
      try { for (const poi of await s.keyword(kw, city)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    }
    return { list: out, error }
  }
  if (center) {
    mine.map(st => ({ st, d: metres(stationPoint(st), center) })).filter(x => x.d <= 3000).sort((a, b) => a.d - b.d).slice(0, 5)
      .forEach(x => add({ kind: "mine", station: x.st, dist: x.d }))
    if (s) {
      try { for (const poi of await s.nearby(center, 2000)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    }
    return { list: out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)).slice(0, 12), error }
  }
  mine.slice().sort((a, b) => b.last_used_ts - a.last_used_ts).slice(0, 30).forEach(st => add({ kind: "mine", station: st, dist: null }))
  return { list: out, error }
}
