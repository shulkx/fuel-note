// 权益卡写进账本（权益设计第 4 节）：用卡记费用（金额写实付、备注最后一行、使用记录按费用的时间）、改日期、删除费用恢复剩余；
// 添加一批（套餐顺手记一笔费用，只记一次）；修改一张、改一批、删除（费用不动）；记一次使用、删除（费用还在的不能删，找不到的能删）；门店。
// 本机车辆和小熊车辆。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultUse, joinRemark, perkBook, remaining, usageLine } from "../common/perks"
import { addPerks, expenseTimes, putExpenseWithPerks, putPerk, putStore, putUse, removePerks, removeStore, removeUse, updateBatch } from "../common/perk_ledger"
import { makeAppData, removeRecord, vehicleRecords, vehiclesForCars } from "../common/ledger"
import { emptyLedger, ExpenseRecord, LedgerFile, Perk, Store, Vehicle } from "../common/types"
import { applyOps, validateUpload } from "../sync/xxyh/ops"
import { carProfile } from "../sync/xxyh/mapping"
import { emptyXxyhState, XxyhBackup } from "../sync/xxyh/types"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const T1 = BJ("2026-10-22T10:00:00")
const T2 = BJ("2026-10-23T15:00:00")
const END = BJ("2027-01-06T23:59:59.999")

const STORE: Store = { id: "st1", name: "示例沃尔沃", full_name: "", address: "", phone: "", lng: null, lat: null, source: "manual" }

const perk = (id: string, name: string, vehicleId: string, extra: Partial<Perk>): Perk => ({
  id, vehicle_id: vehicleId, name, kind: "count", total: 1, unit: "次", end_ts: END, store: "示例沃尔沃",
  source: "示例赠送", insurance_id: null, origin: "other", raw: "示例原文", note: "", created_ts: 0, ...extra,
})

function localSetup() {
  const v: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }
  const perks = [perk("fund", "维修保养券", "v1", { kind: "balance", total: 1000, unit: "元" }), perk("basic", "基础保养", "v1", {})]
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v], stores: [STORE], perks }
  return { data: makeAppData(ledger, emptyXxyhState()), v, fund: perks[0], basic: perks[1] }
}

function cloud(): XxyhBackup {
  return {
    expenseTypes: [{ _id: 100001, name: "维修保养" }],
    myStations: { stations: [] },
    cars: [{ uuid: "1000000001", name: "示例车", selected: 1, fuelRecords: [], maintainRecords: [], expenseRecords: [] }],
  }
}

function linkedSetup() {
  const base = vehiclesForCars(emptyLedger(), [{ uuid: "1000000001", name: "示例车", fuel_count: 0, expense_count: 0, profile: carProfile({ uuid: "1000000001" }) }])
  const v = base.vehicles[0]
  const perks = [perk("fund", "维修保养券", v.id, { kind: "balance", total: 1000, unit: "元" }), perk("basic", "基础保养", v.id, {})]
  const ledger: LedgerFile = { ...base, stores: [STORE], perks }
  return { data: makeAppData(ledger, { ...emptyXxyhState(), base: cloud(), base_version: 1 }), v, fund: perks[0], basic: perks[1] }
}

const expenses = (d: ReturnType<typeof makeAppData>, v: Vehicle) => vehicleRecords(d, v).filter((r): r is ExpenseRecord & typeof r => r.kind === "expense")

test("本机车辆：用维修保养券和基础保养记费用，金额是实付、备注最后一行；改日期跟着改；删除费用恢复剩余", () => {
  const { data, v, fund, basic } = localSetup()
  const uses = [defaultUse(fund, 1000, 1000), defaultUse(basic, 1, 2250)]
  const line = usageLine([fund, basic], uses, STORE.name)
  const c = putExpenseWithPerks(data, v, null, null, { ts: T1, category_id: 100001, amount: 1250, remark: joinRemark("第六次保养", line) }, { uses, store: STORE })
  const d1 = makeAppData(c.ledger, c.xxyh)
  const e = expenses(d1, v)[0]
  assert.deepEqual([e.amount, e.remark], [1250, "第六次保养\n维修保养券抵扣 ¥1,000.00 · 基础保养 1 次 · 示例沃尔沃"])
  assert.deepEqual(d1.ledger.perk_uses!.map(u => [u.perk_id, u.used, u.deduct, u.expense_ts]), [["fund", 1000, 1000, T1], ["basic", 1, 0, T1]])
  assert.equal(remaining(perkBook(d1.ledger), fund), 0)
  // 改日期：使用记录跟着改时间
  const c2 = putExpenseWithPerks(d1, v, e.id, T1, { ts: T2, category_id: 100001, amount: 1250, remark: e.remark }, { uses, store: STORE })
  const d2 = makeAppData(c2.ledger, c2.xxyh)
  assert.deepEqual(d2.ledger.perk_uses!.map(u => u.expense_ts), [T2, T2])
  // 删除费用：使用记录一起删，剩余恢复
  const c3 = removeRecord(d2, v, expenses(d2, v)[0])
  assert.deepEqual(c3.ledger.perk_uses, [])
  assert.equal(remaining(perkBook(c3.ledger), fund), 1000)
})

test("小熊车辆：用卡记费用生成新增费用的操作（金额是实付），上传前检查通过；删除生成删除操作并恢复剩余", () => {
  const { data, v, fund } = linkedSetup()
  const uses = [defaultUse(fund, 1000, 300)]
  const c = putExpenseWithPerks(data, v, null, null, { ts: T1, category_id: 100001, amount: 0, remark: usageLine([fund], uses, null) }, { uses, store: null })
  assert.equal(c.linked, true)
  const base = cloud()
  assert.deepEqual(validateUpload(base, applyOps(base, c.xxyh.ops)), [])
  const d1 = makeAppData(c.ledger, c.xxyh)
  assert.equal(remaining(perkBook(d1.ledger), fund), 700)
  const c2 = removeRecord(d1, v, expenses(d1, v)[0])
  assert.equal(c2.xxyh.ops.at(-1)!.type, "delete_expense")
  assert.equal(remaining(perkBook(c2.ledger), fund), 1000)
})

test("添加一批：几张卡填上这辆车；套餐顺手记一笔维修保养费用（只记一次，备注是名称和门店）；门店加进我的门店；一张都没有时报错", () => {
  const { data, v } = localSetup()
  const pkg = [perk("coupon", "基础保养抵用券", "x", { unit: "张", source: "示例保养套餐", origin: "package" }), perk("spray", "原厂喷漆", "x", { source: "示例保养套餐", origin: "package", unit: "面" })]
  const newStore: Store = { ...STORE, id: "remark:示例新店", name: "示例新店", source: "remark" }
  const c = addPerks(data, v, pkg, newStore, { amount: 168, ts: T1, remark: "示例保养套餐\n示例新店" })
  const d = makeAppData(c.ledger, c.xxyh)
  assert.deepEqual(d.ledger.perks!.slice(2).map(p => [p.id, p.vehicle_id]), [["coupon", "v1"], ["spray", "v1"]])
  assert.deepEqual(expenses(d, v).map(e => [e.ts, e.category_id, e.amount, e.remark]), [[T1, 100001, 168, "示例保养套餐\n示例新店"]])
  assert.deepEqual(d.ledger.stores!.map(s => s.name), ["示例沃尔沃", "示例新店"])
  const noExpense = addPerks(data, v, pkg, null, null)
  assert.equal(expenses(makeAppData(noExpense.ledger, noExpense.xxyh), v).length, 0)
  assert.throws(() => addPerks(data, v, [], null, null), /至少/)
  // 小熊车辆：买价那一笔是新增费用的操作
  const linked = linkedSetup()
  const c2 = addPerks(linked.data, linked.v, pkg, null, { amount: 168, ts: T1, remark: "示例保养套餐" })
  assert.equal(c2.linked, true)
  assert.deepEqual(validateUpload(cloud(), applyOps(cloud(), c2.xxyh.ops)), [])
})

test("修改一张：用过的不能改类型，改总量时不能少于已用；改名、改说明可以；也可以新加一张；别的车的卡不能改", () => {
  const { data, v, fund } = localSetup()
  const used = makeAppData({ ...data.ledger, perk_uses: [{ id: "u1", perk_id: "fund", ts: T1, used: 300, deduct: 300, expense_ts: null, note: "" }] }, data.xxyh)
  assert.throws(() => putPerk(used, v, { ...fund, kind: "count", unit: "次" }, null), /不能更改类型/)
  assert.throws(() => putPerk(used, v, { ...fund, total: 200 }, null), /总量不能少于已用/)
  const c = putPerk(used, v, { ...fund, name: "保养券", note: "不与其他优惠叠加" }, null)
  assert.deepEqual(c.ledger.perks!.map(p => p.name), ["保养券", "基础保养"])
  const added = putPerk(used, v, perk("paint", "原厂油漆面", "v1", { total: 3, unit: "面" }), null)
  assert.equal(added.ledger.perks!.length, 3)
  assert.throws(() => putPerk(used, { ...v, id: "v2" }, fund, null), /不是这辆车/)
})

test("改一批：来自的名称、有效期、门店、原文写进同一来自的每一张卡；车险赠送的名称不改；别的批不动", () => {
  const { data, v } = localSetup()
  const ledger: LedgerFile = { ...data.ledger, perks: [...data.ledger.perks!, perk("ins", "空调清洗", "v1", { source: "2026 车险", insurance_id: "y26", origin: "insurance" })] }
  const d = makeAppData(ledger, data.xxyh)
  const later = BJ("2027-01-31T23:59:59.999")
  const c = updateBatch(d, v, "src:示例赠送", { source: "示例赠送卡", end_ts: later, store: "示例新店", raw: "新的原文" }, null)
  assert.deepEqual(c.ledger.perks!.map(p => [p.source, p.end_ts, p.store, p.raw]), [
    ["示例赠送卡", later, "示例新店", "新的原文"], ["示例赠送卡", later, "示例新店", "新的原文"], ["2026 车险", END, "示例沃尔沃", "示例原文"],
  ])
  const c2 = updateBatch(d, v, "ins:y26", { source: "改不了", end_ts: null }, null)
  assert.deepEqual(c2.ledger.perks!.map(p => [p.source, p.end_ts]).at(-1), ["2026 车险", null])
  assert.throws(() => updateBatch(d, v, "src:示例赠送", { source: " " }, null), /名称/)
})

test("删除卡：使用记录一起删，记过的费用不动（金额和备注都不改）", () => {
  const { data, v, fund } = localSetup()
  const uses = [defaultUse(fund, 1000, 1000)]
  const c = putExpenseWithPerks(data, v, null, null, { ts: T1, category_id: 100001, amount: 0, remark: usageLine([fund], uses, null) }, { uses, store: null })
  const d = makeAppData(c.ledger, c.xxyh)
  const c2 = removePerks(d, v, ["fund"])
  const d2 = makeAppData(c2.ledger, c2.xxyh)
  assert.deepEqual(d2.ledger.perks!.map(p => p.id), ["basic"])
  assert.deepEqual(d2.ledger.perk_uses, [])
  assert.deepEqual(expenses(d2, v).map(e => [e.amount, e.remark]), [[0, "维修保养券抵扣 ¥1,000.00"]])
  assert.throws(() => removePerks(d, { ...v, id: "v2" }, ["fund"]), /找不到/)
})

test("记一次使用、修改、删除；记在还在的费用上的不能在这里删，那笔费用找不到了（在小熊里删了或改了日期）可以删", () => {
  const { data, v, basic, fund } = localSetup()
  const once = { id: "u1", perk_id: "basic", ts: T1, used: 1, deduct: 0, expense_ts: null, note: "" }
  const c = putUse(data, once)
  const d1 = makeAppData(c.ledger, c.xxyh)
  assert.equal(remaining(perkBook(d1.ledger), basic), 0)
  const c2 = putUse(d1, { ...once, note: "示例备注" })
  assert.deepEqual(c2.ledger.perk_uses!.map(u => [u.id, u.note]), [["u1", "示例备注"]])
  assert.deepEqual(removeUse(d1, v, "u1").ledger.perk_uses, [])
  // 记在费用上
  const uses = [defaultUse(fund, 1000, 500)]
  const ce = putExpenseWithPerks(data, v, null, null, { ts: T1, category_id: 100001, amount: 0, remark: "" }, { uses, store: null })
  const de = makeAppData(ce.ledger, ce.xxyh)
  const id = de.ledger.perk_uses![0].id
  assert.throws(() => removeUse(de, v, id), /费用/)
  // 费用不在了（模拟在别处删掉）：可以删
  const orphan = makeAppData({ ...de.ledger, records: [] }, de.xxyh)
  assert.equal(expenseTimes(orphan, v)!.size, 0)
  assert.deepEqual(removeUse(orphan, v, id).ledger.perk_uses, [])
})

test("小熊车辆还没有云备份时读不到费用，当作都在，不放行删除", () => {
  const { data, v } = linkedSetup()
  const noBase = makeAppData({ ...data.ledger, perk_uses: [{ id: "u1", perk_id: "fund", ts: T1, used: 1, deduct: 1, expense_ts: T1, note: "" }] }, { ...emptyXxyhState() })
  assert.equal(expenseTimes(noBase, v), null)
  assert.throws(() => removeUse(noBase, v, "u1"), /费用/)
})

test("门店：同名不重复加；改名；删除后卡上写的店名不动", () => {
  const { data } = localSetup()
  const same = putStore(data, { ...STORE, id: "" })
  assert.equal(same.store.id, "st1")
  const renamed = putStore(data, { ...STORE, name: "示例沃尔沃（新）" })
  assert.equal(renamed.ledger.stores![0].name, "示例沃尔沃（新）")
  const removed = removeStore(data, "st1")
  assert.deepEqual(removed.ledger.stores, [])
  assert.equal(removed.ledger.perks![0].store, "示例沃尔沃")
})
