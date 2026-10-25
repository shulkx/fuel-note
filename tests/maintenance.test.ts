// 记保养（common/maintenance.ts，2.1 设计第 5、11 节）：填了项目才存保养记录，跟着费用的时间和金额；没项目、换类别时删掉；用过的项目按次数排。编造的数据
import { test } from "node:test"
import assert from "node:assert/strict"
import { maintenanceOf, putMaintenance, usedItems } from "../common/maintenance"
import { emptyLedger, ExpenseRecord, LedgerFile, MaintenanceRecord } from "../common/types"

const expense = (patch: Partial<ExpenseRecord> = {}): ExpenseRecord =>
  ({ kind: "expense", id: "e1", vehicle_id: "v1", ts: 1000, category_id: 100001, amount: 900, remark: "第六次保养", ...patch })
const ledgerWith = (...records: LedgerFile["records"]): LedgerFile => ({ ...emptyLedger(), records })

test("维修保养填了项目：存一条保养记录，时间、金额跟着费用，备注用表单里的", () => {
  const l = putMaintenance(ledgerWith(expense()), "e1", { odometer: 83000, items: ["机油", "机油滤清器"], remark: "第六次保养" })
  const m = maintenanceOf(l.records, "e1")!
  assert.deepEqual([m.vehicle_id, m.ts, m.amount, m.odometer, m.items, m.remark, m.expense_id], ["v1", 1000, 900, 83000, ["机油", "机油滤清器"], "第六次保养", "e1"])
  assert.equal(l.records.length, 2)
})

test("编辑：沿用原来的 id 和小熊的原样；去掉全部项目、换了类别时删掉保养记录，费用留着", () => {
  const old: MaintenanceRecord = { kind: "maintenance", id: "m1", vehicle_id: "v1", ts: 500, odometer: 80000, items: ["机油"], amount: 800, remark: "旧", expense_id: "e1", xxyh_raw: { wc_id: 7 } }
  const l = putMaintenance(ledgerWith(expense({ amount: 950, ts: 2000 }), old), "e1", { odometer: 81000, items: ["机油", "空调滤芯"], remark: "新" })
  const m = maintenanceOf(l.records, "e1")!
  assert.deepEqual([m.id, m.ts, m.amount, m.odometer, m.remark, m.xxyh_raw], ["m1", 2000, 950, 81000, "新", { wc_id: 7 }])
  assert.deepEqual(putMaintenance(l, "e1", { odometer: 81000, items: [], remark: "" }).records.map(r => r.id), ["e1"])
  const other = { ...l, records: l.records.map(r => (r.id === "e1" ? { ...r, category_id: 100003 } : r)) }
  assert.deepEqual(putMaintenance(other, "e1", { odometer: 81000, items: ["机油"], remark: "" }).records.map(r => r.id), ["e1"])
  assert.deepEqual(putMaintenance(l, "e1", null).records.map(r => r.id), ["e1"])
})

test("用过的项目：按次数排，次数一样时最近用过的在前；只算这辆车", () => {
  const m = (id: string, ts: number, items: string[], vehicle_id = "v1"): MaintenanceRecord =>
    ({ kind: "maintenance", id, vehicle_id, ts, odometer: 0, items, amount: 0, remark: "" })
  const records = [m("a", 1, ["机油", "火花塞"]), m("b", 3, ["机油", "空调滤芯"]), m("c", 2, ["刹车油"]), m("d", 9, ["轮胎", "轮胎", "轮胎"], "v2")]
  assert.deepEqual(usedItems(records, "v1"), ["机油", "空调滤芯", "刹车油", "火花塞"])
})
