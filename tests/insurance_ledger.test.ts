// 保险与费用的关联（设计文档 20.4 节）：本机车辆直接改本机记录，小熊车辆生成操作、保存后再找回费用 id。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { linkInsuranceExpenses, makeAppData, putInsurance, removeInsurance, removeRecord, vehicleRecords, vehiclesForCars } from "../common/ledger"
import { yearTotal } from "../common/insurance"
import { emptyLedger, ExpenseRecord, InsuranceYear, LedgerFile, Policy, Vehicle } from "../common/types"
import { applyOps, validateUpload } from "../sync/xxyh/ops"
import { carProfile, xxyhRecordId } from "../sync/xxyh/mapping"
import { emptyXxyhState, XxyhBackup } from "../sync/xxyh/types"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const PAID = BJ("2021-12-20T10:00:00")
const OLD = BJ("2021-11-24T15:00:00")

function policy(kind: Policy["kind"], premium: number, extra: Partial<Policy> = {}): Policy {
  return {
    kind, title: "示例保单", insurer: "示例财产保险股份有限公司", policy_no: "0000", start_ts: BJ("2022-01-07T00:00:00"), end_ts: BJ("2023-01-06T23:59:59.999"),
    premium, premium_ex_tax: null, tax: null, float_rate: null, vehicle_tax: null, phone: null, items: [], file: null, issues: [], ...extra,
  }
}

function year(extra: Partial<InsuranceYear> = {}): InsuranceYear {
  return {
    id: "ins1", vehicle_id: "", discount: 0, paid_ts: PAID, expense_id: null, remark: "",
    policies: [policy("compulsory", 950, { vehicle_tax: 360 }), policy("commercial", 4000)],
    ...extra,
  }
}

const TOTAL = 5310

function localSetup(withOld = false) {
  const v: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v] }
  if (withOld) ledger.records = [{ kind: "expense", id: "e-old", vehicle_id: "v1", ts: OLD, category_id: 100002, amount: 4800, remark: "2022年示例车险" }]
  return { data: makeAppData(ledger, emptyXxyhState()), v }
}

function cloud(): XxyhBackup {
  return {
    expenseTypes: [{ _id: 100002, name: "保险和交通规费" }],
    myStations: { stations: [] },
    cars: [{
      uuid: "1000000001", name: "示例车", selected: 1, fuelRecords: [], maintainRecords: [],
      expenseRecords: [{ date: OLD, type: 100002, expense: 4800, description: "2022年示例车险", wc_id: 1, carId: 1000000001 }],
    }],
  }
}

function linkedSetup() {
  const ledger = vehiclesForCars(emptyLedger(), [{ uuid: "1000000001", name: "示例车", fuel_count: 0, expense_count: 1, profile: carProfile({ uuid: "1000000001" }) }])
  const xxyh = { ...emptyXxyhState(), base: cloud(), base_version: 1 }
  return { data: makeAppData(ledger, xxyh), v: ledger.vehicles[0] }
}

const expenses = (data: ReturnType<typeof makeAppData>, v: Vehicle) =>
  vehicleRecords(data, v).filter((r): r is ExpenseRecord & typeof r => r.kind === "expense")

test("本机车辆：新记保险时记一笔费用，保险关联它；编辑时改同一笔", () => {
  const { data, v } = localSetup()
  const c = putInsurance(data, v, year(), "total")
  assert.equal(c.linked, false)
  const d1 = makeAppData(c.ledger, c.xxyh)
  const [e] = expenses(d1, v)
  assert.deepEqual([e.amount, e.category_id, e.ts, e.remark], [TOTAL, 100002, PAID, "2022 车险 · 示例"])
  assert.equal(c.year.expense_id, e.id)
  assert.equal(c.year.vehicle_id, "v1")
  assert.deepEqual(d1.ledger.insurance?.map(y => y.id), ["ins1"])

  const c2 = putInsurance(d1, v, { ...c.year, discount: 310 }, "total")
  const d2 = makeAppData(c2.ledger, c2.xxyh)
  assert.deepEqual(expenses(d2, v).map(r => [r.id, r.amount]), [[e.id, TOTAL - 310]])
  assert.equal(d2.ledger.insurance?.length, 1)
})

test("本机车辆：补到已有费用，「保留原金额」不改费用，「改成保单合计」改金额和日期、保留备注", () => {
  const { data, v } = localSetup(true)
  const keep = putInsurance(data, v, year({ expense_id: "e-old", paid_ts: OLD }), "keep")
  const dk = makeAppData(keep.ledger, keep.xxyh)
  assert.deepEqual(expenses(dk, v).map(r => [r.id, r.amount, r.remark]), [["e-old", 4800, "2022年示例车险"]])
  assert.equal(keep.year.expense_id, "e-old")

  const total = putInsurance(data, v, year({ expense_id: "e-old" }), "total")
  const dt = makeAppData(total.ledger, total.xxyh)
  assert.deepEqual(expenses(dt, v).map(r => [r.id, r.amount, r.ts, r.remark]), [["e-old", TOTAL, PAID, "2022年示例车险"]])
})

test("小熊车辆：新记保险生成新增费用的操作，保存后找回费用 id，上传前检查通过", () => {
  const { data, v } = linkedSetup()
  const c = putInsurance(data, v, year(), "total", 1)
  assert.equal(c.linked, true)
  assert.equal(c.year.expense_id, null)
  assert.deepEqual(c.xxyh.ops.map(o => [o.type, (o as { key: number | null }).key]), [["put_expense", null]])

  const d1 = makeAppData(c.ledger, c.xxyh)
  const ledger = linkInsuranceExpenses(d1)
  assert.ok(ledger)
  assert.equal(ledger!.insurance?.[0].expense_id, xxyhRecordId("1000000001", "e", PAID))
  assert.equal(linkInsuranceExpenses(makeAppData(ledger!, c.xxyh)), null)

  const applied = applyOps(cloud(), c.xxyh.ops)
  assert.deepEqual(applied.conflicts, [])
  assert.deepEqual(validateUpload(cloud(), applied), [])
})

test("小熊车辆：补到已有费用并保留原金额时不生成操作；改了付款日期后按新日期找回 id", () => {
  const { data, v } = linkedSetup()
  const oldId = xxyhRecordId("1000000001", "e", OLD)
  const keep = putInsurance(data, v, year({ expense_id: oldId, paid_ts: OLD }), "keep")
  assert.equal(keep.xxyh.ops.length, 0)
  assert.equal(keep.year.expense_id, oldId)

  const moved = putInsurance(data, v, year({ expense_id: oldId }), "total", 1)
  assert.deepEqual(moved.xxyh.ops.map(o => [o.type, (o as { key: number | null }).key]), [["put_expense", OLD]])
  const ledger = linkInsuranceExpenses(makeAppData(moved.ledger, moved.xxyh))
  assert.equal(ledger?.insurance?.[0].expense_id, xxyhRecordId("1000000001", "e", PAID))
})

test("保留原金额时改了付款日期：费用跟着改日期，金额和备注不变；小熊车辆按新日期找回 id（金额与合计不同也能找回）", () => {
  const local = localSetup(true)
  const lk = putInsurance(local.data, local.v, year({ expense_id: "e-old" }), "keep")
  assert.deepEqual(expenses(makeAppData(lk.ledger, lk.xxyh), local.v).map(r => [r.id, r.amount, r.ts, r.remark]), [["e-old", 4800, PAID, "2022年示例车险"]])
  assert.equal(lk.year.expense_id, "e-old")

  const { data, v } = linkedSetup()
  const oldId = xxyhRecordId("1000000001", "e", OLD)
  const moved = putInsurance(data, v, year({ expense_id: oldId }), "keep", 1)
  assert.deepEqual(moved.xxyh.ops.map(o => [o.type, (o as { key: number | null }).key, (o as { data: { amount: number; ts: number } }).data.amount]), [["put_expense", OLD, 4800]])
  const ledger = linkInsuranceExpenses(makeAppData(moved.ledger, moved.xxyh))
  assert.equal(ledger?.insurance?.[0].expense_id, xxyhRecordId("1000000001", "e", PAID))
  const applied = applyOps(cloud(), moved.xxyh.ops)
  assert.deepEqual(validateUpload(cloud(), applied), [])
})

test("费用在别处被删了：找不到时把关联清掉，详情里提示", () => {
  const { data, v } = localSetup()
  const c = putInsurance(data, v, year(), "total")
  const gone: LedgerFile = { ...c.ledger, records: [] }
  const ledger = linkInsuranceExpenses(makeAppData(gone, c.xxyh))
  assert.equal(ledger?.insurance?.[0].expense_id, null)
})

test("删除保险：可以只删明细，也可以连费用一起删；删除带保险的费用会删掉那一年的保险", () => {
  const { data, v } = localSetup()
  const c = putInsurance(data, v, year(), "total")
  const d = makeAppData(c.ledger, c.xxyh)

  const onlyDetail = removeInsurance(d, v, "ins1", false)
  assert.deepEqual([onlyDetail.ledger.insurance, onlyDetail.ledger.records.length, onlyDetail.removedInsurance], [[], 1, ["ins1"]])

  const both = removeInsurance(d, v, "ins1", true)
  assert.deepEqual([both.ledger.insurance, both.ledger.records.length], [[], 0])

  const record = vehicleRecords(d, v)[0]
  const viaRecord = removeRecord(d, v, record)
  assert.deepEqual([viaRecord.ledger.insurance, viaRecord.removedInsurance], [[], ["ins1"]])

  assert.throws(() => removeInsurance(d, v, "nope", false), /找不到/)
})

test("小熊车辆：连费用一起删除生成删除操作", () => {
  const { data, v } = linkedSetup()
  const oldId = xxyhRecordId("1000000001", "e", OLD)
  const keep = putInsurance(data, v, year({ expense_id: oldId, paid_ts: OLD }), "keep")
  const d = makeAppData(keep.ledger, keep.xxyh)
  const both = removeInsurance(d, v, "ins1", true, 1)
  assert.deepEqual(both.xxyh.ops.map(o => [o.type, (o as { key: number }).key]), [["delete_expense", OLD]])
  assert.deepEqual(both.ledger.insurance, [])
  assert.equal(yearTotal(year()), TOTAL)
})
