// 小熊车型库（sync/xxyh/catalog.ts 的公开接口）：品牌列表文件缓存 30 天，车型参数查过就存（cache/catalog_cache.json）
import { CarSpec, CatalogBrand, CatalogItem, fetchBrands, fetchModels, fetchSeries, fetchSpec, replenishModeOf } from "../sync/xxyh/catalog"
import { VehicleProfile } from "../common/types"
import { scriptingHttp } from "../platform/scripting_http"
import { readCache, writeCache } from "../platform/storage"

const CATALOG_FILE = "catalog_cache.json"
const CATALOG_TTL = 30 * 86400e3
type CatalogFile = { schema_version: 1; brands?: { at: number; list: CatalogBrand[] }; specs?: Record<string, CarSpec> }

let brandsPromise: Promise<CatalogBrand[]> | null = null
const seriesCache = new Map<number, Promise<CatalogItem[]>>()
const modelsCache = new Map<string, Promise<CatalogItem[]>>()
const specCache = new Map<number, Promise<CarSpec | null>>()

const readCatalog = (): CatalogFile => readCache<CatalogFile>(CATALOG_FILE) || { schema_version: 1 }

/** 缓存里的车型参数，不发请求；没查过时 null */
export function cachedSpec(model: number): CarSpec | null {
  return readCatalog().specs?.[String(model)] ?? null
}

/** 品牌列表：文件缓存 30 天 */
export function catalogBrands(): Promise<CatalogBrand[]> {
  if (!brandsPromise) {
    const cached = readCatalog().brands
    brandsPromise = cached && Date.now() - cached.at < CATALOG_TTL && cached.list.length
      ? Promise.resolve(cached.list)
      : fetchBrands(scriptingHttp).then(list => {
        try { writeCache(CATALOG_FILE, { ...readCatalog(), brands: { at: Date.now(), list } }) } catch { /* 下次再缓存 */ }
        return list
      })
    brandsPromise.catch(() => { brandsPromise = null })
  }
  return brandsPromise
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  let p = map.get(key)
  if (!p) {
    p = load()
    map.set(key, p)
    p.catch(() => map.delete(key))
  }
  return p
}

export const catalogSeries = (brand: number) => memo(seriesCache, brand, () => fetchSeries(scriptingHttp, brand))
export const catalogModels = (brand: number, series: number) => memo(modelsCache, `${brand}/${series}`, () => fetchModels(scriptingHttp, brand, series))

/** 车型参数：文件里有就不再请求（车型参数不会变） */
export function catalogSpec(model: number): Promise<CarSpec | null> {
  return memo(specCache, model, async () => {
    const cached = cachedSpec(model)
    if (cached) return cached
    const spec = await fetchSpec(scriptingHttp, model)
    if (spec) {
      try { const f = readCatalog(); writeCache(CATALOG_FILE, { ...f, specs: { ...(f.specs || {}), [String(model)]: spec } }) } catch { /* 下次再缓存 */ }
    }
    return spec
  })
}

/** 选好的车型 → 车辆资料 */
export function profileFromSpec(spec: CarSpec | null, buyDate: string | null): VehicleProfile {
  return {
    model: spec ? spec.id : null,
    model_name: spec ? spec.name : null,
    pinpai: spec ? spec.pinpai : null,
    chexi: spec ? spec.chexi : null,
    vehicle_type: spec ? spec.vehicle_type : null,
    replenish_mode: spec ? replenishModeOf(spec.fuel_type) : null,
    gas_type: spec ? spec.gas_type : null,
    buy_date: buyDate,
  }
}
