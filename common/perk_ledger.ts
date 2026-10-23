// 权益卡写进账本（权益设计 docs/specs/2026-10-23-benefits-wallet.md）：记费用时用的卡和门店、添加一批（套餐可以顺手记一笔费用，只记一次）、
// 修改一张、改一批、删除、记一次使用、我的门店。权益、使用记录、门店只存在本机；和小熊的关系只有费用（金额写实付，备注最后一行写用了什么和门店）。
// 边界：卡上的东西只在卡上改，不跟随保单期间、费用金额，也不反过来改它们；删卡不动费用。
import { newId } from "./ids"
import { MAINTENANCE_CATEGORY } from "./expense_stats"
import { AppData, Change, putExpense, unchanged, vehicleRecords } from "./ledger"
import { groupKey, perkBook, perkErrors, Use, usedOf } from "./perks"
import { addStore } from "./stores"
import { ExpenseData, LedgerFile, Perk, PerkUse, Store, Vehicle } from "./types"

/** 这辆车的卡 id */
function perkIdsOf(ledger: LedgerFile, vehicleId: string): Set<string> {
  return new Set((ledger.perks ?? []).filter(p => p.vehicle_id === vehicleId).map(p => p.id))
}

/** 门店加进我的门店（从备注认出的选了以后才加）；返回保存后的那一家 */
function saveStoreInto(ledger: LedgerFile, store: Store | null): Store | null {
  if (!store) return null
  const r = addStore(ledger.stores ?? [], store, () => newId("st"))
  ledger.stores = r.stores
  return r.store
}

/** 记费用时选的门店和用的卡 */
export type ExpenseExtras = { uses: Use[]; store: Store | null }

/**
 * 保存费用和这一笔用的卡：expense 的金额已经是实付、备注已经带上最后一行；
 * oldTs 是编辑的那一笔原来的时间：它原来的使用记录换成这一次的（改了日期的跟着改时间）。门店加进我的门店
 */
export function putExpenseWithPerks(
  data: AppData, vehicle: Vehicle, recordId: string | null, oldTs: number | null, expense: ExpenseData, extras: ExpenseExtras, now = Date.now(),
): Change {
  const c = putExpense(data, vehicle, recordId, expense, now)
  saveStoreInto(c.ledger, extras.store)
  const ids = perkIdsOf(c.ledger, vehicle.id)
  const kept = (c.ledger.perk_uses ?? []).filter(u => !(oldTs != null && u.expense_ts === oldTs && ids.has(u.perk_id)))
  const added: PerkUse[] = extras.uses.filter(u => ids.has(u.perk_id) && u.used > 0).map(u => ({
    id: newId("pu"), perk_id: u.perk_id, ts: expense.ts, used: u.used, deduct: u.deduct, expense_ts: expense.ts, note: "",
  }))
  if (kept.length || added.length || c.ledger.perk_uses) c.ledger.perk_uses = [...kept, ...added]
  return c
}

/** 套餐的买价：添加时顺手记的那一笔维修保养费用（只记这一次，之后费用和卡互不影响） */
export type PurchaseExpense = { amount: number; ts: number; remark: string }

/** 添加一批：几张卡（vehicle_id 填这辆车），门店加进我的门店；purchase 时另记一笔维修保养费用 */
export function addPerks(data: AppData, vehicle: Vehicle, perks: Perk[], store: Store | null, purchase: PurchaseExpense | null, now = Date.now()): Change {
  if (!perks.length) throw new Error("请至少添加一项")
  const c = purchase
    ? putExpense(data, vehicle, null, { ts: purchase.ts, category_id: MAINTENANCE_CATEGORY, amount: purchase.amount, remark: purchase.remark }, now)
    : unchanged(data)
  saveStoreInto(c.ledger, store)
  c.ledger.perks = [...(c.ledger.perks ?? []), ...perks.map(p => ({ ...p, vehicle_id: vehicle.id }))]
  return c
}

/** 修改一张卡（也可以新加一张）：用过的不能改类型，总量不能少于已用；门店加进我的门店 */
export function putPerk(data: AppData, vehicle: Vehicle, perk: Perk, store: Store | null): Change {
  const c = unchanged(data)
  const list = c.ledger.perks ?? []
  const before = list.find(p => p.id === perk.id) ?? null
  if (before && before.vehicle_id !== vehicle.id) throw new Error("这张卡不是这辆车的")
  const errors = perkErrors(perk, before, before ? usedOf(perkBook(c.ledger), perk.id) : 0)
  if (errors.length) throw new Error(errors.join("\n"))
  saveStoreInto(c.ledger, store)
  const next = { ...perk, vehicle_id: vehicle.id }
  c.ledger.perks = before ? list.map(p => (p.id === perk.id ? next : p)) : [...list, next]
  return c
}

/** 改一批：来自的名称、有效期、门店、原文写进这一批的每一张卡（没给的字段不改） */
export type BatchFields = { source?: string; end_ts?: number | null; store?: string; raw?: string }

export function updateBatch(data: AppData, vehicle: Vehicle, key: string, fields: BatchFields, store: Store | null): Change {
  const c = unchanged(data)
  if (fields.source != null && !fields.source.trim()) throw new Error("请填名称")
  saveStoreInto(c.ledger, store)
  c.ledger.perks = (c.ledger.perks ?? []).map(p => {
    if (p.vehicle_id !== vehicle.id || groupKey(p) !== key) return p
    return {
      ...p,
      ...(fields.source != null && !p.insurance_id ? { source: fields.source.trim() } : {}),
      ...(fields.end_ts !== undefined ? { end_ts: fields.end_ts } : {}),
      ...(fields.store != null ? { store: fields.store.trim() } : {}),
      ...(fields.raw != null ? { raw: fields.raw.trim() } : {}),
    }
  })
  return c
}

/** 删除几张卡和它们的使用记录；记过的费用不动（实付和备注都不改） */
export function removePerks(data: AppData, vehicle: Vehicle, ids: string[]): Change {
  const c = unchanged(data)
  const mine = new Set(ids.filter(id => (c.ledger.perks ?? []).some(p => p.id === id && p.vehicle_id === vehicle.id)))
  if (!mine.size) throw new Error("找不到这项权益")
  c.ledger.perks = (c.ledger.perks ?? []).filter(p => !mine.has(p.id))
  if (c.ledger.perk_uses) c.ledger.perk_uses = c.ledger.perk_uses.filter(u => !mine.has(u.perk_id))
  return c
}

/** 记一次使用（没有费用）或修改：按 id 覆盖 */
export function putUse(data: AppData, use: PerkUse): Change {
  const c = unchanged(data)
  const next: PerkUse = { ...use, expense_ts: null }
  c.ledger.perk_uses = [...(c.ledger.perk_uses ?? []).filter(u => u.id !== next.id), next]
  return c
}

/** 这辆车现存费用的时间；小熊车辆还没有云备份时 null（读不到，当作都在） */
export function expenseTimes(data: AppData, vehicle: Vehicle): Set<number> | null {
  if (vehicle.xxyh_car && !data.xxyh.base) return null
  return new Set(vehicleRecords(data, vehicle).filter(r => r.kind === "expense").map(r => r.ts))
}

/** 删除一次使用：记一次使用的，或记在费用上但那笔费用已经找不到（在小熊 App 里删了或改了日期）。费用还在的要在那笔费用里改 */
export function removeUse(data: AppData, vehicle: Vehicle, id: string): Change {
  const c = unchanged(data)
  const u = (c.ledger.perk_uses ?? []).find(x => x.id === id)
  if (!u) throw new Error("找不到这次使用")
  if (u.expense_ts != null) {
    const times = expenseTimes(data, vehicle)
    if (!times || times.has(u.expense_ts)) throw new Error("这次使用记在费用上，请在那笔费用的「使用权益」里修改")
  }
  c.ledger.perk_uses = (c.ledger.perk_uses ?? []).filter(x => x.id !== id)
  return c
}

/** 新建或修改我的门店（同名的不重复加） */
export function putStore(data: AppData, store: Store): Change & { store: Store } {
  const c = unchanged(data)
  const list = c.ledger.stores ?? []
  if (list.some(s => s.id === store.id)) {
    c.ledger.stores = list.map(s => (s.id === store.id ? { ...store, name: store.name.trim() } : s))
    return { ...c, store }
  }
  const saved = saveStoreInto(c.ledger, store)!
  return { ...c, store: saved }
}

/** 删除我的门店（卡上写的店名、费用备注里写的店名不动） */
export function removeStore(data: AppData, id: string): Change {
  const c = unchanged(data)
  c.ledger.stores = (c.ledger.stores ?? []).filter(s => s.id !== id)
  return c
}
