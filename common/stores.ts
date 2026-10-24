// 我的门店（纯函数，设计文档 20.7、22.11 节，1.7）：列出选择门店页的候选，记费用时默认这一类上次用的门店。
// 2.0 起费用的门店存在 store_id；没有 store_id 的旧费用（从小熊导入、备注里自己写了店名的）照旧从备注最后一行认出店名
// （例如「两桶水护理上蜡套餐\n白武士车体精细护理」），选了以后加进我的门店。
import { ExpenseRecord, FuelRecord, MaintenanceRecord, Store } from "./types"

type AnyRecord = FuelRecord | ExpenseRecord | MaintenanceRecord

/** 比较店名时忽略空白、全角括号 */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase()
}

const lastLine = (remark: string) => {
  const lines = remark.split("\n").map(l => l.trim()).filter(Boolean)
  return { line: lines.length ? lines[lines.length - 1] : "", count: lines.length }
}
const lastPart = (line: string) => line.split(" · ").pop()!.trim()

/** 像店名的一段：不含「：」（小熊写的「保养里程：…」）、不长于 24 字、不是金额或次数 */
function looksLikeStore(s: string): boolean {
  return !!s && s.length <= 24 && !/[：:]/.test(s) && !/抵扣|¥|\d+\s*(次|面|张|瓶)$/.test(s) && !/^\d/.test(s)
}

/** 从备注认出店名（找候选用）：多行备注的最后一行（最后一个「 · 」后面）；单行的备注不算 */
export function remarkStore(remark: string): string | null {
  const { line, count } = lastLine(remark)
  if (count < 2) return null
  const s = lastPart(line)
  return looksLikeStore(s) ? s : null
}

/** 备注最后一行写的是不是已知的门店（单行也算：只填了门店时备注就是店名）；是时返回那一家 */
export function storeInRemark(remark: string, stores: Store[]): Store | null {
  const { line } = lastLine(remark)
  if (!line) return null
  const name = normalizeName(lastPart(line))
  return stores.find(s => normalizeName(s.name) === name) ?? null
}

export type StoreCandidate = {
  store: Store
  /** 还没加进我的门店（从费用备注认出的），选了以后才加进来 */
  fromRemark: boolean
  /** 备注里写着这家店的费用笔数 */
  count: number
  last_ts: number
}

/** 从备注认出的店：id 用店名，选了以后加进我的门店才有正式的 id */
export const remarkStoreId = (name: string) => `remark:${name}`

/**
 * 选择门店页的候选：我的门店，加上费用备注里认出、还没加进来的。
 * 都按最近一次用的时间排（我的门店在前）；同名的（忽略空白和全角括号）只列一次
 */
export function storeCandidates(stores: Store[], records: AnyRecord[]): StoreCandidate[] {
  const stats = new Map<string, { name: string; count: number; last: number }>()
  const byId = new Map(stores.map(s => [s.id, s]))
  for (const r of records) {
    if (r.kind !== "expense") continue
    const name = (r.store_id ? byId.get(r.store_id)?.name : null) ?? remarkStore(r.remark) ?? storeInRemark(r.remark, stores)?.name ?? null
    if (!name) continue
    const key = normalizeName(name)
    const s = stats.get(key) ?? { name, count: 0, last: 0 }
    s.count += 1
    s.last = Math.max(s.last, r.ts)
    stats.set(key, s)
  }
  const saved = stores.map(store => {
    const s = stats.get(normalizeName(store.name))
    return { store, fromRemark: false, count: s?.count ?? 0, last_ts: s?.last ?? 0 }
  })
  const savedKeys = new Set(stores.map(s => normalizeName(s.name)))
  const derived: StoreCandidate[] = Array.from(stats.entries())
    .filter(([key]) => !savedKeys.has(key))
    .map(([, s]) => ({
      store: { id: remarkStoreId(s.name), name: s.name, full_name: "", address: "", phone: "", lng: null, lat: null, source: "remark" as const },
      fromRemark: true, count: s.count, last_ts: s.last,
    }))
  const byRecent = (a: StoreCandidate, b: StoreCandidate) => b.last_ts - a.last_ts
  return [...saved.sort(byRecent), ...derived.sort(byRecent)]
}

/** 记费用默认的门店：这一类最近一笔费用的门店（store_id，没有时看备注最后一行；records 新的在前）；没有时 null */
export function lastStoreFor(records: AnyRecord[], categoryId: number, candidates: Store[]): Store | null {
  for (const r of records) {
    if (r.kind !== "expense" || r.category_id !== categoryId) continue
    const s = (r.store_id ? candidates.find(c => c.id === r.store_id) : null) ?? storeInRemark(r.remark, candidates)
    if (s) return s
  }
  return null
}

/** 费用列表第二行写的门店名：store_id 对应的门店；没有时照旧取备注最后一行认出的店名 */
export function expenseStoreName(stores: Store[], e: ExpenseRecord): string | null {
  if (e.store_id) return stores.find(s => s.id === e.store_id)?.name ?? null
  return remarkStore(e.remark)
}

/** 我的门店里加上一家（同名的不重复加）；返回加进来的那一家（已有时是原来的） */
export function addStore(stores: Store[], store: Store, newId: () => string): { stores: Store[]; store: Store } {
  const same = stores.find(s => s.id === store.id || normalizeName(s.name) === normalizeName(store.name))
  if (same) return { stores, store: same }
  const saved: Store = { ...store, id: store.id.startsWith("remark:") || !store.id ? newId() : store.id, name: store.name.trim() }
  return { stores: [...stores, saved], store: saved }
}
