// 权益卡写进账本（权益设计第 4 节，2.0 起按费用的 id）：用卡记费用（金额写实付、门店存在费用上、使用记录按费用的 id）、改日期、删除费用恢复剩余；
// 添加一批（套餐顺手记一笔费用，只记一次）；修改一张、改一批、删除（费用不动）；记一次使用、删除（费用还在的不能删，找不到的能删）；门店。
// 全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultUse, perkBook, remaining } from "../common/perks"
import { addPerks, expenseTimes, putExpenseWithPerks, putPerk, putStore, putUse, removePerks, removeStore, removeUse, updateBatch } from "../common/perk_ledger"
import { AppData, makeAppData, removeRecord, vehicleRecords } from "../common/ledger"
import { emptyLedger, ExpenseRecord, LedgerFile, Perk, Store, Vehicle } from "../common/types"
import { emptyXxyhState } from "../sync/xxyh/types"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const T1 = BJ("2026-10-22T10:00:00")
const T2 = BJ("2026-10-23T15:00:00")
const END = BJ("2027-01-06T23:59:59.999")

const STORE: Store = { id: "st1", name: "示例沃尔沃", full_name: "", address: "", phone: "", hours: "", poi_id: "amap-1", lng: null, lat: null, dealer: null }

const perk = (id: string, name: string, vehicleId: string, extra: Partial<Perk>): Perk => ({
  id, vehicle_id: vehicleId, name, kind: "count", total: 1, unit: "次", end_ts: END, store_id: "st1",
  source: "示例赠送", insurance_id: null, origin: "other", raw: "示例原文", note: "", created_ts: 0, ...extra,
})

function setup() {
  const v: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }
  const perks = [perk("fund", "维修保养券", "v1", { kind: "balance", total: 1000, unit: "元" }), perk("basic", "基础保养", "v1", {})]
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v], stores: [STORE], perks }
  return { data: makeAppData(ledger, emptyXxyhState()), v, fund: perks[0], basic: perks[1] }
}

const after = (ledger: LedgerFile): AppData => makeAppData(ledger, emptyXxyhState())
const expenses = (d: AppData, v: Vehicle) => vehicleRecords(d, v).filter((r): r is ExpenseRecord => r.kind === "expense")

test("用维修保养券和基础保养记费用：金额是实付，备注只有自己写的，门店存在费用上；改日期跟着改；删除费用恢复剩余", () => {
  const { data, v, fund, basic } = setup()
  const uses = [defaultUse(fund, 1000, 1000), defaultUse(basic, 1, 2250)]
  const c = putExpenseWithPerks(data, v, null, { ts: T1, category_id: 100001, amount: 1250, remark: "第六次保养" }, { uses, store: STORE })
  const d1 = after(c.ledger)
  const e = expenses(d1, v)[0]
  assert.deepEqual([e.id, e.amount, e.remark, e.store_id], [c.recordId, 1250, "第六次保养", "st1"])
  assert.deepEqual(d1.ledger.perk_uses.map(u => [u.perk_id, u.used, u.expense_id, u.ts]), [["fund", 1000, e.id, T1], ["basic", 1, e.id, T1]])
  assert.equal(remaining(perkBook(d1.ledger), fund), 0)
  // 改日期：同一笔费用，使用记录换成这一次的（时间跟着改）
  const c2 = putExpenseWithPerks(d1, v, e.id, { ts: T2, category_id: 100001, amount: 1250, remark: e.remark }, { uses, store: STORE })
  const d2 = after(c2.ledger)
  assert.equal(c2.recordId, e.id)
  assert.deepEqual(d2.ledger.perk_uses.map(u => [u.expense_id, u.ts]), [[e.id, T2], [e.id, T2]])
  // 去掉门店
  const c3 = putExpenseWithPerks(d2, v, e.id, { ts: T2, category_id: 100001, amount: 1250, remark: e.remark }, { uses, store: null })
  assert.equal(expenses(after(c3.ledger), v)[0].store_id, undefined)
  // 删除费用：使用记录一起删，剩余恢复
  const c4 = removeRecord(d2, expenses(d2, v)[0])
  assert.deepEqual(c4.ledger.perk_uses, [])
  assert.equal(remaining(perkBook(c4.ledger), fund), 1000)
})

test("改费用时只换这一笔自己的使用记录，别的费用和记一次使用不动", () => {
  const { data, v, fund, basic } = setup()
  const a = putExpenseWithPerks(data, v, null, { ts: T1, category_id: 100001, amount: 0, remark: "" }, { uses: [defaultUse(fund, 1000, 200)], store: null })
  const once = putUse(after(a.ledger), { id: "u-once", perk_id: "basic", ts: T1, used: 1, expense_id: null, note: "" })
  const b = putExpenseWithPerks(after(once.ledger), v, null, { ts: T2, category_id: 100001, amount: 0, remark: "" }, { uses: [defaultUse(fund, 800, 300)], store: null })
  const c = putExpenseWithPerks(after(b.ledger), v, a.recordId!, { ts: T1, category_id: 100001, amount: 0, remark: "" }, { uses: [], store: null })
  assert.deepEqual(c.ledger.perk_uses.map(u => [u.expense_id, u.used]), [[null, 1], [b.recordId, 300]])
  assert.equal(remaining(perkBook(c.ledger), fund), 700)
  assert.equal(remaining(perkBook(c.ledger), basic), 0)
})

test("添加一批：几张卡填上这辆车，门店是卡上的；套餐顺手记一笔维修保养费用（只记一次，门店同卡上的）；一张都没有时报错", () => {
  const { data, v } = setup()
  const pkg = [perk("coupon", "基础保养抵用券", "x", { unit: "张", source: "示例保养套餐", origin: "package" }), perk("spray", "原厂喷漆", "x", { source: "示例保养套餐", origin: "package", unit: "面" })]
  const c = addPerks(data, v, pkg, { amount: 168, ts: T1, remark: "示例保养套餐" })
  const d = after(c.ledger)
  assert.deepEqual(d.ledger.perks.slice(2).map(p => [p.id, p.vehicle_id, p.store_id]), [["coupon", "v1", "st1"], ["spray", "v1", "st1"]])
  assert.deepEqual(expenses(d, v).map(e => [e.ts, e.category_id, e.amount, e.remark, e.store_id]), [[T1, 100001, 168, "示例保养套餐", "st1"]])
  const { store_id: _s, ...noStore } = pkg[0]
  const plain = addPerks(data, v, [noStore], { amount: 10, ts: T2, remark: "" })
  assert.equal(expenses(after(plain.ledger), v)[0].store_id, undefined)
  const noExpense = addPerks(data, v, pkg, null)
  assert.equal(expenses(after(noExpense.ledger), v).length, 0)
  assert.throws(() => addPerks(data, v, [], null), /至少/)
})

test("修改一张：用过的不能改类型，改总量时不能少于已用；改名、改说明可以；也可以新加一张；别的车的卡不能改", () => {
  const { data, v, fund } = setup()
  const used = after({ ...data.ledger, perk_uses: [{ id: "u1", perk_id: "fund", ts: T1, used: 300, expense_id: null, note: "" }] })
  assert.throws(() => putPerk(used, v, { ...fund, kind: "count", unit: "次" }), /不能更改类型/)
  assert.throws(() => putPerk(used, v, { ...fund, total: 200 }), /总量不能少于已用/)
  const c = putPerk(used, v, { ...fund, name: "保养券", note: "不与其他优惠叠加" })
  assert.deepEqual(c.ledger.perks.map(p => p.name), ["保养券", "基础保养"])
  const added = putPerk(used, v, perk("paint", "原厂油漆面", "v1", { total: 3, unit: "面" }))
  assert.equal(added.ledger.perks.length, 3)
  assert.throws(() => putPerk(used, { ...v, id: "v2" }, fund), /不是这辆车/)
})

test("改一批：来自的名称、有效期、门店、原文写进同一来自的每一张卡；车险赠送的名称不改；别的批不动", () => {
  const { data, v } = setup()
  const d = after({ ...data.ledger, perks: [...data.ledger.perks, perk("ins", "空调清洗", "v1", { source: "2026 车险", insurance_id: "y26", origin: "insurance" })] })
  const later = BJ("2027-01-31T23:59:59.999")
  const c = updateBatch(d, v, "src:示例赠送", { source: "示例赠送卡", end_ts: later, store_id: "st2", raw: "新的原文" })
  assert.deepEqual(c.ledger.perks.map(p => [p.source, p.end_ts, p.store_id, p.raw]), [
    ["示例赠送卡", later, "st2", "新的原文"], ["示例赠送卡", later, "st2", "新的原文"], ["2026 车险", END, "st1", "示例原文"],
  ])
  const c2 = updateBatch(d, v, "ins:y26", { source: "改不了", end_ts: null, store_id: null })
  assert.deepEqual(c2.ledger.perks.map(p => [p.source, p.end_ts, "store_id" in p]).at(-1), ["2026 车险", null, false])
  assert.equal(updateBatch(d, v, "src:示例赠送", { raw: "x" }).ledger.perks[0].store_id, "st1", "没给门店时不改")
  assert.throws(() => updateBatch(d, v, "src:示例赠送", { source: " " }), /名称/)
})

test("删除卡：使用记录一起删，记过的费用不动（金额和备注都不改）", () => {
  const { data, v, fund } = setup()
  const c = putExpenseWithPerks(data, v, null, { ts: T1, category_id: 100001, amount: 0, remark: "示例" }, { uses: [defaultUse(fund, 1000, 1000)], store: null })
  const d = after(c.ledger)
  const d2 = after(removePerks(d, v, ["fund"]).ledger)
  assert.deepEqual(d2.ledger.perks.map(p => p.id), ["basic"])
  assert.deepEqual(d2.ledger.perk_uses, [])
  assert.deepEqual(expenses(d2, v).map(e => [e.amount, e.remark]), [[0, "示例"]])
  assert.throws(() => removePerks(d, { ...v, id: "v2" }, ["fund"]), /找不到/)
})

test("记一次使用、修改、删除；记在费用上的不能在这里删", () => {
  const { data, v, basic, fund } = setup()
  const once = { id: "u1", perk_id: "basic", ts: T1, used: 1, expense_id: "e-whatever", note: "" }
  const c = putUse(data, once)
  const d1 = after(c.ledger)
  assert.equal(d1.ledger.perk_uses[0].expense_id, null, "记一次使用不挂在费用上")
  assert.equal(remaining(perkBook(d1.ledger), basic), 0)
  const c2 = putUse(d1, { ...once, note: "示例备注" })
  assert.deepEqual(c2.ledger.perk_uses.map(u => [u.id, u.note]), [["u1", "示例备注"]])
  assert.deepEqual(removeUse(d1, "u1").ledger.perk_uses, [])
  assert.throws(() => removeUse(d1, "nope"), /找不到/)
  // 记在费用上
  const ce = putExpenseWithPerks(data, v, null, { ts: T1, category_id: 100001, amount: 0, remark: "" }, { uses: [defaultUse(fund, 1000, 500)], store: null })
  const de = after(ce.ledger)
  const id = de.ledger.perk_uses[0].id
  assert.deepEqual([...expenseTimes(de, v)], [[ce.recordId, T1]])
  assert.throws(() => removeUse(de, id), /费用/)
})

test("门店：同一个高德地点不重复加；改名；删除后费用和卡都去掉门店", () => {
  const { data, v } = setup()
  const same = putStore(data, { ...STORE, id: "" })
  assert.equal(same.store.id, "st1")
  const renamed = putStore(data, { ...STORE, name: "示例沃尔沃（新）" })
  assert.equal(renamed.ledger.stores[0].name, "示例沃尔沃（新）")
  const withExpense = putExpenseWithPerks(data, v, null, { ts: T1, category_id: 100001, amount: 300, remark: "" }, { uses: [], store: STORE })
  const removed = removeStore(after(withExpense.ledger), "st1")
  assert.deepEqual(removed.ledger.stores, [])
  assert.equal("store_id" in removed.ledger.perks[0], false)
  assert.equal(expenses(after(removed.ledger), v)[0].store_id, undefined)
})
