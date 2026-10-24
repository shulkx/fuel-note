// 我的门店（纯函数，设计文档 20.7、22.11 节）：选择门店页的顺序，记费用时默认这一类上次用的门店。
// 2.0 起门店只看费用的 store_id，不从备注里认店名（2.0.0-beta.3；2.1 起门店来自高德，见 docs/specs/2026-10-24-maintenance-volvo.md 第 10 节）。
import { ExpenseRecord, FuelRecord, MaintenanceRecord, Store } from "./types"

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

/** 我的门店里加上一家（同名的不重复加）；返回加进来的那一家（已有时是原来的） */
export function addStore(stores: Store[], store: Store, newId: () => string): { stores: Store[]; store: Store } {
  const same = stores.find(s => s.id === store.id || normalizeName(s.name) === normalizeName(store.name))
  if (same) return { stores, store: same }
  const saved: Store = { ...store, id: store.id || newId(), name: store.name.trim() }
  return { stores: [...stores, saved], store: saved }
}
