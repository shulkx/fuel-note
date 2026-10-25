// 账本的修改（2.0 设计第 3、4 节）：记录有固定的 id；编辑保留表单以外的字段（小熊的原样）；费用的门店；删除费用时清掉保险、权益使用、保养的关联。
// 全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { AppData, makeAppData, putExpense, putFuel, removeRecord, vehicleRecords } from "../common/ledger"
import { emptyLedger, ExpenseRecord, FuelData, FuelRecord, LedgerFile, MaintenanceRecord, Vehicle } from "../common/types"
import { emptyXxyhState } from "../sync/xxyh/types"

const D = (s: string) => Date.parse(s)
const V: Vehicle = { id: "v1", name: "测试", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }

const fuel = (d: Partial<FuelData>): FuelData => ({
  ts: D("2026-10-17T09:00:00+08:00"), odometer: 83200, liters: 40, price: 8.6, amount: 344, paid: 330, grade: 95,
  full: true, light_on: false, missed_before: false, station_id: null, remark: "", ...d,
})

const data = (l: Partial<LedgerFile> = {}): AppData => makeAppData({ ...emptyLedger(), vehicles: [V], ...l }, emptyXxyhState())
const after = (ledger: LedgerFile): AppData => makeAppData(ledger, emptyXxyhState())

test("加油：新记有固定的 id，新油站加进我的油站；用已有的油站时更新最近使用时间；不改传入的数据", () => {
  const d = data()
  const st = { id: "s1", name: "新站", address: "", province: "", city: "", district: "", lng: 121, lat: 31, last_used_ts: 0 }
  const c = putFuel(d, V, null, fuel({ station_id: "s1" }), st)
  assert.equal(d.ledger.records.length, 0)
  assert.equal(c.ledger.records.length, 1)
  assert.equal(c.ledger.records[0].id, c.recordId)
  assert.match(c.recordId!, /^f/)
  assert.deepEqual(c.ledger.stations.map(s => [s.id, s.last_used_ts]), [["s1", fuel({}).ts]])
  const later = D("2026-10-20T09:00:00+08:00")
  const c2 = putFuel(after(c.ledger), V, null, fuel({ ts: later, station_id: "s1" }), null)
  assert.equal(c2.ledger.stations[0].last_used_ts, later)
})

test("编辑加油、费用：id 不变，表单以外的字段（小熊的原样、门店）保留", () => {
  const raw = { wc_id: 216, someFutureField: "x" }
  const f: FuelRecord = { ...fuel({}), kind: "fuel", id: "f1", vehicle_id: "v1", xxyh_raw: raw }
  const e: ExpenseRecord = { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100000, amount: 20, remark: "停车", store_id: "st1", xxyh_raw: raw }
  const d = data({ records: [f, e] })
  const c = putFuel(d, V, "f1", fuel({ paid: 300 }), null)
  assert.equal(c.recordId, "f1")
  assert.deepEqual(c.ledger.records.find(r => r.id === "f1"), { ...f, paid: 300 })
  const c2 = putExpense(d, V, "e1", { ts: 2, category_id: 100000, amount: 25, remark: "停车" })
  assert.deepEqual(c2.ledger.records.find(r => r.id === "e1"), { ...e, ts: 2, amount: 25 })
})

test("费用的门店：不传不改，null 去掉，传 id 换成它；新记时没有门店就不写这个字段", () => {
  const e: ExpenseRecord = { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 20, remark: "", store_id: "st1" }
  const d = data({ records: [e] })
  const body = { ts: 1, category_id: 100001, amount: 20, remark: "" }
  const one = (c: { ledger: LedgerFile }) => c.ledger.records[0] as ExpenseRecord
  assert.equal(one(putExpense(d, V, "e1", body)).store_id, "st1")
  assert.equal("store_id" in one(putExpense(d, V, "e1", body, null)), false)
  assert.equal(one(putExpense(d, V, "e1", body, "st2")).store_id, "st2")
  const fresh = putExpense(data(), V, null, body)
  assert.equal("store_id" in one(fresh), false)
})

test("删除费用：关联的保险年度、用在它上面的权益使用、它的保养记录一起删；删保养时连费用一起删；别的记录不动", () => {
  const e: ExpenseRecord = { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 900, remark: "" }
  const other: ExpenseRecord = { ...e, id: "e2", ts: 2 }
  const m: MaintenanceRecord = { kind: "maintenance", id: "m1", vehicle_id: "v1", ts: 1, odometer: 80000, items: ["机油"], amount: 900, remark: "", expense_id: "e1" }
  const d = data({
    records: [e, other, m],
    insurance: [{ id: "y1", vehicle_id: "v1", policies: [], discount: 0, paid_ts: 1, expense_id: "e1", remark: "" }, { id: "y2", vehicle_id: "v1", policies: [], discount: 0, paid_ts: 2, expense_id: "e2", remark: "" }],
    perk_uses: [
      { id: "u1", perk_id: "p1", ts: 1, used: 1, expense_id: "e1", note: "" },
      { id: "u2", perk_id: "p1", ts: 2, used: 1, expense_id: "e2", note: "" },
      { id: "u3", perk_id: "p1", ts: 3, used: 1, expense_id: null, note: "" },
    ],
  })
  const c = removeRecord(d, e)
  assert.deepEqual(c.ledger.records.map(r => r.id), ["e2"])
  assert.deepEqual(removeRecord(d, m).ledger.records.map(r => r.id), ["e2"], "删保养：费用一起删")
  assert.deepEqual(c.ledger.insurance.map(y => y.id), ["y2"])
  assert.deepEqual(c.removedInsurance, ["y1"])
  assert.deepEqual(c.ledger.perk_uses.map(u => u.id), ["u2", "u3"])
  // 删加油：只删这一条
  const f: FuelRecord = { ...fuel({}), kind: "fuel", id: "f1", vehicle_id: "v1" }
  const c2 = removeRecord(data({ records: [f, e] }), f)
  assert.deepEqual([c2.ledger.records.map(r => r.id), c2.removedInsurance], [["e1"], []])
})

test("一辆车的记录按时间倒序，只含这辆车的", () => {
  const e = (id: string, vehicle_id: string, ts: number): ExpenseRecord => ({ kind: "expense", id, vehicle_id, ts, category_id: 100000, amount: 1, remark: "" })
  const d = data({ records: [e("a", "v1", 1), e("b", "v2", 5), e("c", "v1", 3)] })
  assert.deepEqual(vehicleRecords(d, V).map(r => r.id), ["c", "a"])
})
