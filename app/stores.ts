// 门店（2.1 设计第 10 节）：在高德里搜索门店（附近、关键字），记费用那时车停的地方。门店的存、改、删在 app/records.ts。
// FuelNote Check 的数据文件夹里不读钥匙串，不能搜索。
import { LngLat } from "../common/geo"
import { AppData } from "../common/ledger"
import { parkedAt } from "../common/stores"
import { StorePoi, Vehicle } from "../common/types"
import { Place } from "../providers/types"
import { storesByKeyword, storesNearby } from "../stations/store_search"
import { scriptingHttp } from "../platform/scripting_http"
import { isMainDataRoot } from "../platform/storage"
import { amapKey } from "./stations"
import { canReadTrips, stopsForPayment } from "./vehicle_data"

const searchKey = (): string | null => (isMainDataRoot() ? amapKey() : null)

/** 填了高德 Key 才能搜索、添加新的门店 */
export const canSearchStores = (): boolean => !!searchKey()

function key(): string {
  const k = searchKey()
  if (!k) throw new Error("还没有填高德 Key（设置 › 油站搜索）")
  return k
}

/** 关键字搜索：优先最近用过的油站所在的城市 */
export function searchStores(data: AppData, keyword: string): Promise<StorePoi[]> {
  const city = [...data.ledger.stations].sort((a, b) => b.last_used_ts - a.last_used_ts)[0]?.city ?? ""
  return storesByKeyword(scriptingHttp, key(), keyword, city)
}

/** 一个点附近的汽车服务 */
export function nearbyStores(p: LngLat): Promise<StorePoi[]> {
  return storesNearby(scriptingHttp, key(), p)
}

/** 记费用那时车停的地方（车辆数据的行程）；读不到行程、那时车不在停着时为 null */
export async function parkedPlace(data: AppData, vehicle: Vehicle, ts: number): Promise<Place | null> {
  if (!canReadTrips(vehicle)) return null
  const { stops } = await stopsForPayment(data, vehicle, ts)
  return parkedAt(stops, ts)?.place ?? null
}
