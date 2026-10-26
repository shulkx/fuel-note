// 养修（docs/specs/2026-10-24-maintenance-volvo.md 第 6 节）：读车辆数据提供方的养修记录，缓存在 cache/service_visits.json（不进备份）；
// 记下时写进账本（common/service.ts 的 putServiceVisit）。读取在后台，失败时照旧用缓存，养修记录页写原因。
import { AppData } from "../common/ledger"
import { metres } from "../common/geo"
import { perkBook } from "../common/perks"
import { putServiceVisit, serviceDraft, ServiceDraft, ServiceSave, serviceVocabulary, TicketNaming } from "../common/service"
import { ServiceVisit, Vehicle } from "../common/types"
import { providerById } from "../providers/registry"
import { ServiceVisitHead, VehicleDataProvider } from "../providers/types"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { readCache, writeCache } from "../platform/storage"
import { errorText } from "./errors"
import { commit } from "./store"
import { cachedStops, stopsKey } from "./vehicle_data"

const FILE = "service_visits.json"
const LIST_EVERY = 24 * 3600e3
const UNSETTLED_EVERY = 10 * 60e3
const NEAR_STORE_M = 300
const PARKED_MIN = 60

type Entry = {
  /** 上次读列表的时间 */
  list_ts: number
  heads: ServiceVisitHead[]
  /** 读过明细的进店（结算过的以后不再读） */
  visits: Record<string, ServiceVisit>
  /** 提供方已不保留的（2021 年 1 月及更早） */
  missing: string[]
  error: string | null
}
type CacheFile = { schema_version: 1; entries: Record<string, Entry> }

function readAll(): Record<string, Entry> {
  const f = readCache<CacheFile>(FILE)
  return f && f.schema_version === 1 && f.entries ? f.entries : {}
}

function save(key: string, e: Entry): void {
  writeCache(FILE, { schema_version: 1, entries: { ...readAll(), [key]: e } })
}

/** 这辆车关联的提供方支持养修；不看凭据 */
function serviceProvider(vehicle: Vehicle | null): VehicleDataProvider | null {
  const p = vehicle && vehicle.provider ? providerById(vehicle.provider.id) : null
  return p && p.serviceTitle && p.serviceVisits && p.serviceVisit && p.serviceNaming ? p : null
}

/** 能读养修：支持养修的提供方，并且凭据还在 */
export function canReadService(vehicle: Vehicle | null): boolean {
  return !!(vehicle && vehicle.provider && serviceProvider(vehicle) && providerCredential(vehicle.provider.id))
}

/** 费用页、养修记录页用的：标题、读到的进店（新的在前，不含已取消、已不保留的）、项目整理规则、上次读取的错误 */
export type ServiceView = {
  title: string
  visits: ServiceVisit[]
  naming: TicketNaming
  error: string | null
  list_ts: number | null
}

function viewOf(p: VehicleDataProvider, e: Entry | null): ServiceView {
  const visits = e
    ? e.heads.filter(h => !h.cancelled && !e.missing.includes(h.order_id)).map(h => e.visits[h.order_id]).filter((v): v is ServiceVisit => !!v)
    : []
  return {
    title: p.serviceTitle as string,
    visits,
    naming: p.serviceNaming!(visits.flatMap(v => v.tickets.flatMap(t => t.labours))),
    error: e ? e.error : null,
    list_ts: e ? e.list_ts : null,
  }
}

/** 只看缓存，不发请求；不支持养修的车辆为 null */
export function cachedService(vehicle: Vehicle | null): ServiceView | null {
  const p = serviceProvider(vehicle)
  if (!vehicle || !p) return null
  return viewOf(p, readAll()[stopsKey(vehicle)] ?? null)
}

/**
 * 要不要读列表（第 6 节）：距上次超过 24 小时；最近一次停车在带经销商代码的门店 300 米内、停了 1 小时以上，而且停车结束晚于上次读取；
 * 有还没结算的进店（已取消的不算），至少隔 10 分钟
 */
export function serviceDue(data: AppData, vehicle: Vehicle, e: Entry | null, now: number): boolean {
  if (!e) return true
  if (now - e.list_ts > LIST_EVERY) return true
  const unsettled = e.heads.some(h => !h.cancelled && !e.missing.includes(h.order_id) && !(e.visits[h.order_id]?.tickets.length))
  if (unsettled && now - e.list_ts >= UNSETTLED_EVERY) return true
  const dealers = data.ledger.stores.filter(s => s.dealer && s.dealer.provider === vehicle.provider?.id && s.lng != null && s.lat != null)
  if (!dealers.length) return false
  const stop = (cachedStops(data, vehicle) ?? []).filter(s => s.place).sort((a, b) => b.end_ts - a.end_ts)[0]
  if (!stop || !stop.place || stop.end_ts <= e.list_ts || (stop.stay_min ?? Infinity) < PARKED_MIN) return false
  const at: [number, number] = [stop.place.lng, stop.place.lat]
  return dealers.some(s => metres(at, [s.lng as number, s.lat as number]) <= NEAR_STORE_M)
}

const running = new Map<string, Promise<ServiceView>>()

/**
 * 读养修：要读时（或 force）读列表，再读还没读过的、还没结算的明细（结算过的以后不再读）。失败时照旧用缓存，错误写进缓存。
 * 同一辆车同时只读一次
 */
export async function refreshService(data: AppData, vehicle: Vehicle, force = false): Promise<ServiceView | null> {
  const p = serviceProvider(vehicle)
  if (!p || !vehicle.provider) return null
  const key = stopsKey(vehicle)
  const before = readAll()[key] ?? null
  if (!force && !serviceDue(data, vehicle, before, Date.now())) return viewOf(p, before)
  const inFlight = running.get(key)
  if (inFlight) return inFlight
  const link = vehicle.provider
  const job = (async () => {
    const e: Entry = before ? { ...before, visits: { ...before.visits }, missing: [...before.missing] } : { list_ts: 0, heads: [], visits: {}, missing: [], error: null }
    try {
      const cred = providerCredential(link.id)
      if (!cred) throw new Error(`未连接${p.name}，请在设置中连接`)
      const ctx = providerCtx(link.id)
      e.heads = await p.serviceVisits!(ctx, cred, link.vehicle_id)
      e.list_ts = Date.now()
      for (const h of e.heads) {
        if (h.cancelled || e.missing.includes(h.order_id)) continue
        const had = e.visits[h.order_id]
        if (had && had.tickets.length) continue
        const v = await p.serviceVisit!(ctx, cred, link.vehicle_id, h)
        if (v) e.visits[h.order_id] = v
        else e.missing.push(h.order_id)
      }
      e.error = null
    } catch (err) {
      e.error = errorText(err)
    }
    save(key, e)
    return viewOf(p, e)
  })()
  running.set(key, job)
  try {
    return await job
  } finally {
    running.delete(key)
  }
}

/** 项目页的候选：沃尔沃的叫法（第 5 节） */
export function serviceCandidates(data: AppData, vehicle: Vehicle, view: ServiceView): string[] {
  return serviceVocabulary(view.visits, view.naming, data.ledger, vehicle.id)
}

/** 从养修填写的表单内容，和项目页的候选 */
export function serviceForm(data: AppData, vehicle: Vehicle, view: ServiceView, visit: ServiceVisit): { draft: ServiceDraft; vocabulary: string[] } {
  return { draft: serviceDraft(data.ledger, perkBook(data.ledger), vehicle, visit, view.naming), vocabulary: serviceCandidates(data, vehicle, view) }
}

/** 记下一次进店（第 9 节） */
export function saveServiceVisit(data: AppData, vehicle: Vehicle, visit: ServiceVisit, input: ServiceSave): AppData {
  return commit(data, putServiceVisit(data, vehicle, visit, input).ledger)
}
