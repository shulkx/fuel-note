// 我的门店（纯函数，设计文档 20.7、22.11 节）：选择门店页的顺序，记费用时默认这一类上次用的门店。
// 2.0 起门店只看费用的 store_id，不从备注里认店名；2.1 起每家门店都是高德地点（docs/specs/2026-10-24-maintenance-volvo.md 第 10 节）。
import { ExpenseRecord, FuelRecord, LedgerFile, MaintenanceRecord, Store, StorePoi } from "./types"

type AnyRecord = FuelRecord | ExpenseRecord | MaintenanceRecord

/** 比较店名时忽略空白、全角括号 */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase()
}

export type StoreCandidate = {
  store: Store
  /** 记在这家店的费用笔数 */
  count: number
  last_ts: number
}

/** 选择门店页的我的门店：按最近一笔费用的时间排，没用过的按原来的顺序排在后面 */
export function storeCandidates(stores: Store[], records: AnyRecord[]): StoreCandidate[] {
  const stats = new Map<string, { count: number; last: number }>()
  for (const r of records) {
    if (r.kind !== "expense" || !r.store_id) continue
    const s = stats.get(r.store_id) ?? { count: 0, last: 0 }
    s.count += 1
    s.last = Math.max(s.last, r.ts)
    stats.set(r.store_id, s)
  }
  return stores
    .map(store => ({ store, count: stats.get(store.id)?.count ?? 0, last_ts: stats.get(store.id)?.last ?? 0 }))
    .sort((a, b) => b.last_ts - a.last_ts)
}

/** 记费用默认的门店：这一类最近一笔有门店的费用（records 新的在前）；没有时 null */
export function lastStoreFor(records: AnyRecord[], categoryId: number, stores: Store[]): Store | null {
  for (const r of records) {
    if (r.kind !== "expense" || r.category_id !== categoryId || !r.store_id) continue
    const s = stores.find(x => x.id === r.store_id)
    if (s) return s
  }
  return null
}

/** 费用列表第二行写的门店名 */
export function expenseStoreName(stores: Store[], e: ExpenseRecord): string | null {
  return e.store_id ? stores.find(s => s.id === e.store_id)?.name ?? null : null
}

/** 我的门店里加上一家（同一个高德地点不重复加）；返回加进来的那一家（已有时是原来的） */
export function addStore(stores: Store[], store: Store, newId: () => string): { stores: Store[]; store: Store } {
  const same = stores.find(s => s.id === store.id || (!!store.poi_id && s.poi_id === store.poi_id))
  if (same) return { stores, store: same }
  const saved: Store = { ...store, id: store.id || newId(), name: store.name.trim() }
  return { stores: [...stores, saved], store: saved }
}

/** 高德的名称去掉末尾括号里的分店名：「优车美装（正大乐城）」→「优车美装」 */
export function shortStoreName(name: string): string {
  const s = name.replace(/[（(][^（）()]*[）)]\s*$/, "").trim()
  return s || name.trim()
}

/** 从高德选中的地点建一家门店（还没有 id，存进我的门店时给） */
export function storeFromPoi(poi: StorePoi): Store {
  return {
    id: "", name: shortStoreName(poi.name), full_name: poi.name, address: poi.address, phone: poi.phone, hours: poi.hours,
    poi_id: poi.poi_id, lng: poi.lng, lat: poi.lat, dealer: null,
  }
}

/** 重新定位：换上高德的资料；id、名称、经销商代码不变，用到它的费用和权益卡不用改 */
export function relocatedStore(store: Store, poi: StorePoi): Store {
  return { ...store, full_name: poi.name, address: poi.address, phone: poi.phone, hours: poi.hours, poi_id: poi.poi_id, lng: poi.lng, lat: poi.lat }
}

/** 我的门店里的同一个高德地点；没有时 null */
export function storeOfPoi(stores: Store[], poiId: string): Store | null {
  return poiId ? stores.find(s => s.poi_id === poiId) ?? null : null
}

/** 用到这家店的费用笔数和权益卡张数（门店详情、删除前的确认） */
export function storeUsage(ledger: LedgerFile, id: string): { expenses: number; perks: number } {
  return {
    expenses: ledger.records.filter(r => r.kind === "expense" && r.store_id === id).length,
    perks: ledger.perks.filter(p => p.store_id === id).length,
  }
}

/** 停车的地方：time 那时车停着的那一站（停车结束到下一段行程之前，最后一站还没开走的也算）；没有时 null */
export function parkedAt<T extends { end_ts: number; stay_min: number | null }>(stops: T[], ts: number): T | null {
  const before = stops.filter(s => s.end_ts <= ts + 5 * 60e3).sort((a, b) => b.end_ts - a.end_ts)[0]
  if (!before) return null
  if (before.stay_min != null && ts > before.end_ts + (before.stay_min + 30) * 60e3) return null
  return before
}
