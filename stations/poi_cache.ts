// 附近油站搜索结果的缓存：按坐标（约 50 m 的网格）和半径保存 30 天，同一个地方不重复查高德或小熊。
// 纯逻辑，读写由调用方注入。
import { LngLat } from "../common/geo"
import { Poi } from "../common/types"

export const POI_TTL_MS = 30 * 86400e3
export const POI_CACHE_MAX = 500
/** 网格大小（度）：纬度方向约 55 m */
const GRID = 0.0005

export type Nearby = (p: LngLat, radiusM: number) => Promise<Poi[]>
export type PoiCacheEntry = { at: number; pois: Poi[] }
export type PoiCacheEntries = Record<string, PoiCacheEntry>

export function poiCacheKey(source: string, p: LngLat, radiusM: number): string {
  return `${source}|${Math.round(p[0] / GRID)},${Math.round(p[1] / GRID)}|${Math.round(radiusM)}`
}

/** 去掉过期的，只留最新的 max 条 */
export function prunePoiCache(entries: PoiCacheEntries, now: number, max = POI_CACHE_MAX): PoiCacheEntries {
  const kept = Object.entries(entries)
    .filter(([, e]) => e && now - e.at < POI_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, max)
  return Object.fromEntries(kept)
}

export type PoiCacheDeps = {
  load(): PoiCacheEntries | null
  save(entries: PoiCacheEntries): void
  now(): number
}

export function createPoiCache(deps: PoiCacheDeps): { wrap(source: string, nearby: Nearby): Nearby } {
  let entries: PoiCacheEntries | null = null
  const all = (): PoiCacheEntries => {
    if (!entries) {
      try { entries = deps.load() || {} } catch { entries = {} }
    }
    return entries
  }
  return {
    wrap(source, nearby) {
      return async (p, radiusM) => {
        const key = poiCacheKey(source, p, radiusM)
        const hit = all()[key]
        if (hit && deps.now() - hit.at < POI_TTL_MS) return hit.pois
        const pois = await nearby(p, radiusM) // 出错不缓存
        entries = prunePoiCache({ ...all(), [key]: { at: deps.now(), pois } }, deps.now())
        try { deps.save(entries) } catch { /* 缓存写不进去不影响使用 */ }
        return pois
      }
    },
  }
}
