// 权益卡写进账本（权益设计 docs/specs/2026-10-23-benefits-wallet.md）：记费用时用的卡和门店、添加一批（套餐可以顺手记一笔费用，只记一次）、
// 修改一张、改一批、删除、记一次使用、我的门店。费用金额写实付；门店存在费用的 store_id，使用记录按费用的 id 对应（2.0 起），
// 导出到小熊时才把用量和门店写进费用备注。边界：卡上的东西只在卡上改，不跟随保单期间、费用金额，也不反过来改它们；删卡不动费用。
import { newId } from "./ids"
import { MAINTENANCE_CATEGORY } from "./expense_stats"
import { AppData, Change, putExpense, unchanged } from "./ledger"
import { groupKey, perkBook, perkErrors, Use, usedOf } from "./perks"
import { addStore } from "./stores"
import { ExpenseData, LedgerFile, Perk, PerkUse, Store, Vehicle } from "./types"

/** 这辆车的卡 id */
function perkIdsOf(ledger: LedgerFile, vehicleId: string): Set<string> {
  return new Set(ledger.perks.filter(p => p.vehicle_id === vehicleId).map(p => p.id))
}

/** 门店加进我的门店（已经在的不重复加）；返回保存后的那一家 */
function saveStoreInto(ledger: LedgerFile, store: Store | null): Store | null {
  if (!store) return null
  const r = addStore(ledger.stores, store, () => newId("st"))
  ledger.stores = r.stores
  return r.store
}

/** 记费用时选的门店和用的卡 */
export type ExpenseExtras = { uses: Use[]; store: Store | null }

/**
 * 保存费用和这一笔用的卡：expense 的金额已经是实付，备注只是用户写的内容；门店加进我的门店，写进费用的 store_id。
 * 编辑时这一笔原来的使用记录换成这一次的
 */
export function putExpenseWithPerks(data: AppData, vehicle: Vehicle, recordId: string | null, expense: ExpenseData, extras: ExpenseExtras): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const store = saveStoreInto(ledger, extras.store)
  const c = putExpense({ ...data, ledger }, vehicle, recordId, expense, store ? store.id : null)
  const expenseId = c.recordId!
  const ids = perkIdsOf(c.ledger, vehicle.id)
  const kept = c.ledger.perk_uses.filter(u => !(u.expense_id === expenseId && ids.has(u.perk_id)))
  const added: PerkUse[] = extras.uses.filter(u => ids.has(u.perk_id) && u.used > 0).map(u => ({
    id: newId("pu"), perk_id: u.perk_id, ts: expense.ts, used: u.used, expense_id: expenseId, note: "",
  }))
  c.ledger.perk_uses = [...kept, ...added]
  return c
}

/** 套餐的买价：添加时顺手记的那一笔维修保养费用（只记这一次，之后费用和卡互不影响） */
export type PurchaseExpense = { amount: number; ts: number; remark: string }

/** 添加一批：几张卡（vehicle_id 填这辆车，门店是卡上的 store_id）；purchase 时另记一笔维修保养费用（门店同卡上的） */
export function addPerks(data: AppData, vehicle: Vehicle, perks: Perk[], purchase: PurchaseExpense | null): Change {
  if (!perks.length) throw new Error("请至少添加一项")
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const c: Change = purchase
    ? putExpense({ ...data, ledger }, vehicle, null, { ts: purchase.ts, category_id: MAINTENANCE_CATEGORY, amount: purchase.amount, remark: purchase.remark }, perks[0].store_id ?? null)
    : { ledger }
  c.ledger.perks = [...c.ledger.perks, ...perks.map(p => ({ ...p, vehicle_id: vehicle.id }))]
  return c
}

/** 修改一张卡（也可以新加一张）：用过的不能改类型，总量不能少于已用 */
export function putPerk(data: AppData, vehicle: Vehicle, perk: Perk): Change {
  const c = unchanged(data)
  const list = c.ledger.perks
  const before = list.find(p => p.id === perk.id) ?? null
  if (before && before.vehicle_id !== vehicle.id) throw new Error("这张卡不是这辆车的")
  const errors = perkErrors(perk, before, before ? usedOf(perkBook(c.ledger), perk.id) : 0)
  if (errors.length) throw new Error(errors.join("\n"))
  const next = { ...perk, vehicle_id: vehicle.id }
  c.ledger.perks = before ? list.map(p => (p.id === perk.id ? next : p)) : [...list, next]
  return c
}

/** 改一批：来自的名称、有效期、门店（null 去掉）、原文写进这一批的每一张卡（没给的字段不改） */
/** start_ts：有效期起（2.1.0-beta.5），null 时去掉，回到默认（车险赠送取保险的购买日，其余取添加那天） */
export type BatchFields = { source?: string; start_ts?: number | null; end_ts?: number | null; store_id?: string | null; raw?: string }

export function updateBatch(data: AppData, vehicle: Vehicle, key: string, fields: BatchFields): Change {
  const c = unchanged(data)
  if (fields.source != null && !fields.source.trim()) throw new Error("请填名称")
  c.ledger.perks = c.ledger.perks.map(p => {
    if (p.vehicle_id !== vehicle.id || groupKey(p) !== key) return p
    const { store_id: oldStore, start_ts: oldStart, ...rest } = p
    const storeId = fields.store_id === undefined ? oldStore : fields.store_id ?? undefined
    const start = fields.start_ts === undefined ? oldStart : fields.start_ts ?? undefined
    return {
      ...rest,
      ...(start != null ? { start_ts: start } : {}),
      ...(fields.source != null && !p.insurance_id ? { source: fields.source.trim() } : {}),
      ...(fields.end_ts !== undefined ? { end_ts: fields.end_ts } : {}),
      ...(storeId ? { store_id: storeId } : {}),
      ...(fields.raw != null ? { raw: fields.raw.trim() } : {}),
    }
  })
  return c
}

/** 删除几张卡和它们的使用记录；记过的费用不动 */
export function removePerks(data: AppData, vehicle: Vehicle, ids: string[]): Change {
  const c = unchanged(data)
  const mine = new Set(ids.filter(id => c.ledger.perks.some(p => p.id === id && p.vehicle_id === vehicle.id)))
  if (!mine.size) throw new Error("找不到这项权益")
  c.ledger.perks = c.ledger.perks.filter(p => !mine.has(p.id))
  c.ledger.perk_uses = c.ledger.perk_uses.filter(u => !mine.has(u.perk_id))
  return c
}

/** 记一次使用（没有费用）或修改：按 id 覆盖 */
export function putUse(data: AppData, use: PerkUse): Change {
  const c = unchanged(data)
  const next: PerkUse = { ...use, expense_id: null }
  c.ledger.perk_uses = [...c.ledger.perk_uses.filter(u => u.id !== next.id), next]
  return c
}

/** 这辆车现存的费用：id → 时间（费用统计的权益抵扣） */
export function expenseTimes(data: AppData, vehicle: Vehicle): Map<string, number> {
  return new Map(data.ledger.records.filter(r => r.kind === "expense" && r.vehicle_id === vehicle.id).map(r => [r.id, r.ts]))
}

/** 删除一次「记一次使用」；记在费用上的要在那笔费用里改 */
export function removeUse(data: AppData, id: string): Change {
  const c = unchanged(data)
  const u = c.ledger.perk_uses.find(x => x.id === id)
  if (!u) throw new Error("找不到这次使用")
  if (u.expense_id != null) throw new Error("这次使用记在费用上，请在那笔费用的「使用权益」里修改")
  c.ledger.perk_uses = c.ledger.perk_uses.filter(x => x.id !== id)
  return c
}

/** 新建或修改我的门店（同名的不重复加） */
export function putStore(data: AppData, store: Store): Change & { store: Store } {
  const c = unchanged(data)
  const list = c.ledger.stores
  if (list.some(s => s.id === store.id)) {
    c.ledger.stores = list.map(s => (s.id === store.id ? { ...store, name: store.name.trim() } : s))
    return { ...c, store }
  }
  const saved = saveStoreInto(c.ledger, store)!
  return { ...c, store: saved }
}

/** 删除我的门店：用到它的费用和权益卡去掉门店，别的不变 */
export function removeStore(data: AppData, id: string): Change {
  const c = unchanged(data)
  c.ledger.stores = c.ledger.stores.filter(s => s.id !== id)
  c.ledger.records = c.ledger.records.map(r => {
    if (r.kind !== "expense" || r.store_id !== id) return r
    const { store_id: _gone, ...rest } = r
    return rest
  })
  c.ledger.perks = c.ledger.perks.map(p => {
    if (p.store_id !== id) return p
    const { store_id: _gone, ...rest } = p
    return rest
  })
  return c
}
