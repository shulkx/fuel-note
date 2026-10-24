// 车辆数据提供方（设计文档第 8 节）：连接、行程与加油停车（16.6 节，记录页提示、记加油表单、从行程选择共用一份缓存）、车况（第 18 节）
import { AppData, fuelRecords, stationsFor } from "../common/ledger"
import { findStops, openRefuelStop, rankStops, refreshStops, Stop } from "../common/stops"
import { createStopSource, paymentStopsRange, StopGetOptions, StopsSnapshot } from "../common/stop_source"
import { createStatusSource, StatusSnapshot } from "../common/status_source"
import { ProviderId, Vehicle } from "../common/types"
import { providerById } from "../providers/registry"
import { Credential, RemoteVehicle, VehicleStatus } from "../providers/types"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { providerSecretKey, providerSessionKey, removeSecret, setJsonSecret } from "../platform/secrets"
import { readCache, readStatusCache, saveStatusSnapshot, writeCache } from "../platform/storage"
import { cachedSpec, catalogSpec } from "./catalog"
import { searcher } from "./stations"
import { commit, updateSettings } from "./store"

// ---------- 提供方 ----------

/** 校验并保存凭据，返回账号下的车辆 */
export async function connectProvider(id: ProviderId, input: Credential): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  if (!p) throw new Error("未知的车辆数据提供方")
  const cred = p.normalizeCredential(input)
  const vehicles = await p.listVehicles(providerCtx(id), cred)
  setJsonSecret(providerSecretKey(id), cred)
  return vehicles
}

/** 读车况（剩余油量等，设计文档 18.1 节）；提供方不支持时返回 null */
export async function providerVehicleStatus(id: ProviderId, vehicleId: string): Promise<VehicleStatus | null> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred || !p.vehicleStatus) return null
  return p.vehicleStatus(providerCtx(id), cred, vehicleId)
}

export async function providerVehicles(id: ProviderId): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred) return []
  return p.listVehicles(providerCtx(id), cred)
}

/** 断开提供方：删除凭据和会话缓存，并解除所有车辆的关联 */
export function disconnectProvider(data: AppData, id: ProviderId): AppData {
  removeSecret(providerSecretKey(id))
  removeSecret(providerSessionKey(id))
  return commit(data, { ...data.ledger, vehicles: data.ledger.vehicles.map(v => (v.provider?.id === id ? { ...v, provider: null } : v)) })
}

// ---------- 行程与加油停车（设计文档 16.6 节） ----------

type TripsCacheFile = { schema_version: 1; entries: Record<string, StopsSnapshot> }
const TRIPS_CACHE_FILE = "trips_cache.json"

function readTripsCache(): Record<string, StopsSnapshot> {
  const f = readCache<TripsCacheFile>(TRIPS_CACHE_FILE)
  return f && f.schema_version === 1 && f.entries ? f.entries : {}
}

/** 最近 7 天的停车：记录页提示、记加油表单、从行程选择共用一份，缓存 10 分钟（cache/trips_cache.json） */
const stopSource = createStopSource({
  load: key => readTripsCache()[key] || null,
  save: snap => writeCache(TRIPS_CACHE_FILE, { schema_version: 1, entries: { ...readTripsCache(), [snap.key]: snap } }),
  now: () => Date.now(),
})

/** 行程、车况缓存的键：车辆和它关联的远端车 */
export const stopsKey = (v: Vehicle) => `${v.id}|${v.provider?.id}|${v.provider?.vehicle_id}`

/** 这辆车能不能读行程：关联了车辆数据，并且凭据还在 */
export function canReadTrips(vehicle: Vehicle | null): boolean {
  return !!(vehicle && vehicle.provider && providerCredential(vehicle.provider.id))
}

/** 最近 7 天的停车。「已记录」和我的油站按当前数据重新判断 */
export async function vehicleStops(data: AppData, vehicle: Vehicle, opts: StopGetOptions = {}): Promise<Stop[]> {
  if (!canReadTrips(vehicle)) return []
  const snap = await stopSource.get(stopsKey(vehicle), range => fetchStops(data, vehicle, range), opts)
  return refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle))
}

/** 只看缓存（可能已过期），不发请求；没有缓存时为 null */
export function cachedStops(data: AppData, vehicle: Vehicle | null): Stop[] | null {
  if (!vehicle || !vehicle.provider) return null
  const snap = stopSource.peek(stopsKey(vehicle))
  return snap ? refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)) : null
}

/**
 * 按付款时间配对用的停车：付款时间在共用的 7 天内时用共用的（shared 为 true）；
 * 更早时单独读付款前后各 1 天，不进缓存（设计文档 19.2 节）
 */
export async function stopsForPayment(data: AppData, vehicle: Vehicle, payTs: number): Promise<{ stops: Stop[]; shared: boolean }> {
  const range = paymentStopsRange(payTs, Date.now())
  if (!range) return { stops: await vehicleStops(data, vehicle, { needAfter: payTs }), shared: true }
  if (!canReadTrips(vehicle)) return { stops: [], shared: false }
  const stops = await fetchStops(data, vehicle, range)
  return { stops: refreshStops(stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)), shared: false }
}

/** 从行程选择：加油停车在前 */
export async function recentStops(data: AppData, vehicle: Vehicle, force = false): Promise<Stop[]> {
  return rankStops(await vehicleStops(data, vehicle, { force }))
}

/** 最近 2 天里还没记录、没被忽略的加油停车（最新的一次） */
export function openStopIn(data: AppData, vehicle: Vehicle, stops: Stop[]): Stop | null {
  return openRefuelStop(stops, fuelRecords(data, vehicle), data.ledger.settings.dismissed_stops, Date.now())
}

/** 记录页顶部提示。刚保存的记录会让提示立即消失（「已记录」按当前数据判断） */
export async function detectOpenStop(data: AppData, vehicle: Vehicle | null, force = false): Promise<Stop | null> {
  if (!vehicle || !canReadTrips(vehicle)) return null
  return openStopIn(data, vehicle, await vehicleStops(data, vehicle, { force }))
}

/** 不发请求：按缓存判断（启动时立刻显示上次的结果，之后再刷新） */
export function openStopNow(data: AppData, vehicle: Vehicle | null): Stop | null {
  if (!vehicle || !canReadTrips(vehicle)) return null
  const stops = cachedStops(data, vehicle)
  return stops ? openStopIn(data, vehicle, stops) : null
}

export function dismissStop(data: AppData, stop: Stop): AppData {
  const list = [stop.end_ts, ...data.ledger.settings.dismissed_stops.filter(t => t !== stop.end_ts)].slice(0, 20)
  return updateSettings(data, { dismissed_stops: list })
}

async function fetchStops(data: AppData, vehicle: Vehicle, range: { from: number; to: number }): Promise<Stop[]> {
  if (!vehicle.provider) throw new Error("这辆车没有关联车辆数据")
  const p = providerById(vehicle.provider.id)
  const cred = providerCredential(vehicle.provider.id)
  if (!p || !cred) throw new Error(`未连接${p ? p.name : "车辆数据"}，请在设置中连接`)
  const trips = await p.fetchTrips(providerCtx(vehicle.provider.id), cred, vehicle.provider.vehicle_id, range)
  const s = searcher(data)
  return findStops(trips, { stations: stationsFor(data, vehicle), fuel: fuelRecords(data, vehicle), nearby: s ? (pt, r) => s.nearby(pt, r) : null, now: range.to })
}

// ---------- 车况（设计文档第 18 节） ----------

/** 车况：记录页、小组件共用一份，缓存 10 分钟（cache/status_cache.json；小组件也会写） */
export const statusSource = createStatusSource({
  load: key => readStatusCache()[key] || null,
  save: saveStatusSnapshot,
  now: () => Date.now(),
})

/** 这辆车关联的车辆数据能读车况（不看凭据） */
export function hasStatusSource(vehicle: Vehicle | null): boolean {
  const p = vehicle && vehicle.provider ? providerById(vehicle.provider.id) : null
  return !!(p && p.vehicleStatus)
}

/** 能读车况：能读车况的车辆数据，并且凭据还在 */
export function canReadStatus(vehicle: Vehicle | null): boolean {
  return hasStatusSource(vehicle) && canReadTrips(vehicle)
}

/** 油箱容量（升）：车型参数里的 tank，只读缓存的车型参数 */
const tankMemo = new Map<number, number | null>()
export function vehicleTank(_data: AppData, vehicle: Vehicle): number | null {
  const model = vehicle.profile?.model
  if (!model || model <= 0) return null
  if (!tankMemo.has(model)) {
    const spec = cachedSpec(model)
    if (!spec) return null // 还没查过车型参数，查到后再记
    tankMemo.set(model, spec.tank && spec.tank > 0 ? spec.tank : null)
  }
  return tankMemo.get(model) ?? null
}

/** 上次读到的车况（可能已过期），不发请求 */
export function cachedStatus(vehicle: Vehicle | null): StatusSnapshot | null {
  return vehicle && hasStatusSource(vehicle) ? statusSource.peek(stopsKey(vehicle)) : null
}

/** 读车况（10 分钟内用缓存；force 时重新读）。第一次用到油箱容量时顺便查车型参数 */
export async function readVehicleStatus(data: AppData, vehicle: Vehicle | null, force = false): Promise<StatusSnapshot | null> {
  if (!vehicle || !vehicle.provider || !canReadStatus(vehicle)) return null
  const link = vehicle.provider
  const snap = await statusSource.get(stopsKey(vehicle), async () => {
    const st = await providerVehicleStatus(link.id, link.vehicle_id)
    if (!st) throw new Error("这个车辆数据提供方不支持车况")
    return st
  }, { force })
  const model = vehicle.profile?.model
  if (model && model > 0 && vehicleTank(data, vehicle) == null) {
    try { await catalogSpec(model) } catch { /* 没有油箱容量时只显示升数 */ }
  }
  return snap
}
