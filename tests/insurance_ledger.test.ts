// 保险与费用的关联（设计文档 20.4 节，2.0 起按费用的 id）。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { AppData, makeAppData, putInsurance, removeInsurance, removeRecord, vehicleRecords } from "../common/ledger"
import { yearTotal } from "../common/insurance"
import { emptyLedger, ExpenseRecord, InsuranceYear, LedgerFile, Policy, Vehicle } from "../common/types"
import { emptyXxyhState } from "../sync/xxyh/types"

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

function setup(withOld = false) {
  const v: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v] }
  if (withOld) ledger.records = [{ kind: "expense", id: "e-old", vehicle_id: "v1", ts: OLD, category_id: 100002, amount: 4800, remark: "2022年示例车险" }]
  return { data: makeAppData(ledger, emptyXxyhState()), v }
}

const after = (ledger: LedgerFile): AppData => makeAppData(ledger, emptyXxyhState())
const expenses = (data: AppData, v: Vehicle) => vehicleRecords(data, v).filter((r): r is ExpenseRecord => r.kind === "expense")

test("新记保险时记一笔费用，保险按 id 关联它；编辑时改同一笔", () => {
  const { data, v } = setup()
  const c = putInsurance(data, v, year(), "total")
  const d1 = after(c.ledger)
  const [e] = expenses(d1, v)
  assert.deepEqual([e.amount, e.category_id, e.ts, e.remark], [TOTAL, 100002, PAID, "2022 车险 · 示例"])
  assert.equal(c.year.expense_id, e.id)
  assert.equal(c.year.vehicle_id, "v1")
  assert.deepEqual(d1.ledger.insurance.map(y => y.id), ["ins1"])

  const c2 = putInsurance(d1, v, { ...c.year, discount: 310 }, "total")
  const d2 = after(c2.ledger)
  assert.deepEqual(expenses(d2, v).map(r => [r.id, r.amount]), [[e.id, TOTAL - 310]])
  assert.equal(d2.ledger.insurance.length, 1)
})

test("补到已有费用：「保留原金额」不改费用，「改成保单合计」改金额和日期、保留备注", () => {
  const { data, v } = setup(true)
  const keep = putInsurance(data, v, year({ expense_id: "e-old", paid_ts: OLD }), "keep")
  assert.deepEqual(expenses(after(keep.ledger), v).map(r => [r.id, r.amount, r.remark]), [["e-old", 4800, "2022年示例车险"]])
  assert.equal(keep.year.expense_id, "e-old")

  const total = putInsurance(data, v, year({ expense_id: "e-old" }), "total")
  assert.deepEqual(expenses(after(total.ledger), v).map(r => [r.id, r.amount, r.ts, r.remark]), [["e-old", TOTAL, PAID, "2022年示例车险"]])
})

test("保留原金额时改了付款日期：费用跟着改日期，金额、备注和 id 都不变", () => {
  const { data, v } = setup(true)
  const moved = putInsurance(data, v, year({ expense_id: "e-old" }), "keep")
  assert.deepEqual(expenses(after(moved.ledger), v).map(r => [r.id, r.amount, r.ts, r.remark]), [["e-old", 4800, PAID, "2022年示例车险"]])
  assert.equal(moved.year.expense_id, "e-old")
})

test("关联的费用已经不在（或是别的车的）：当作新记一笔", () => {
  const { data, v } = setup()
  const c = putInsurance(data, v, year({ expense_id: "e-gone" }), "total")
  const [e] = expenses(after(c.ledger), v)
  assert.equal(c.year.expense_id, e.id)
  assert.notEqual(e.id, "e-gone")
})

test("删除保险：可以只删明细，也可以连费用一起删；删除带保险的费用会删掉那一年的保险", () => {
  const { data, v } = setup()
  const c = putInsurance(data, v, year(), "total")
  const d = after(c.ledger)

  const onlyDetail = removeInsurance(d, "ins1", false)
  assert.deepEqual([onlyDetail.ledger.insurance, onlyDetail.ledger.records.length, onlyDetail.removedInsurance], [[], 1, ["ins1"]])

  const both = removeInsurance(d, "ins1", true)
  assert.deepEqual([both.ledger.insurance, both.ledger.records.length, both.removedInsurance], [[], 0, ["ins1"]])

  const record = vehicleRecords(d, v)[0]
  const viaRecord = removeRecord(d, record)
  assert.deepEqual([viaRecord.ledger.insurance, viaRecord.removedInsurance], [[], ["ins1"]])

  assert.throws(() => removeInsurance(d, "nope", false), /找不到/)
  assert.equal(yearTotal(year()), TOTAL)
})
