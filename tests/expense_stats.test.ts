// 费用的统计（设计文档 21.4 节）：费用和小熊的保养合成一笔一行、保养只算一次；分类合计、范围、每年按付款日期、每月合计
import { test } from "node:test"
import assert from "node:assert/strict"
import { expenseEntries, expenseSummary, expenseYears, MAINTENANCE_CATEGORY, monthTotals } from "../common/expense_stats"
import { ExpenseRecord, LedgerRecord, MaintenanceRecord } from "../common/types"
import { fuel } from "./helpers"

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 10, 30).getTime()
const WASH = 1646374903 // 小熊里自定义的类别（例如「清洗护理」）

function expense(id: string, ts: number, category_id: number, amount: number, remark = ""): ExpenseRecord & LedgerRecord {
  return { kind: "expense", id, vehicle_id: "v1", ts, category_id, amount, remark, origin: "xxyh", pending: false }
}

function maintenance(id: string, ts: number, amount: number, remark = "", odometer = 15000): MaintenanceRecord & LedgerRecord {
  return { kind: "maintenance", id, vehicle_id: "v1", ts, odometer, items: "机油、机油滤清器", amount, remark, origin: "xxyh", pending: false }
}

const records: LedgerRecord[] = [
  expense("ins", at(2025, 12, 18), 100002, 6830.5, "2026 车险 · 示例财险"),
  // 小熊的一次保养：保养记录和同一时刻的一笔维修保养费用
  maintenance("m2", at(2021, 1, 20), 1860, "第二次保养"),
  expense("e2", at(2021, 1, 20), MAINTENANCE_CATEGORY, 1860, "第二次保养\n保养里程：15000公里"),
  // 没有对应费用的保养
  maintenance("m1", at(2020, 7, 10), 420, "第一次保养", 8000),
  expense("wash", at(2021, 4, 8), WASH, 120, "洗车"),
  { ...fuel("f", { ts: at(2021, 4, 8), paid: 300 }), origin: "xxyh", pending: false },
]

test("费用和保养合成一笔一行：同一时刻的保养和费用只算一次，没有费用的保养照算，加油不进来", () => {
  const entries = expenseEntries(records)
  assert.deepEqual(entries.map(e => e.id), ["ins", "wash", "e2", "m1"]) // 新的在前
  const pair = entries.find(e => e.id === "e2")!
  assert.equal(pair.maintenance?.id, "m2")
  assert.equal(pair.amount, 1860)
  const alone = entries.find(e => e.id === "m1")!
  assert.equal(alone.expense, null)
  assert.equal(alone.category_id, MAINTENANCE_CATEGORY)
  assert.equal(alone.amount, 420)
  assert.equal(entries.reduce((s, e) => s + e.amount, 0), 6830.5 + 1860 + 420 + 120)
})

test("同一时刻有几笔费用时，保养配维修保养类别的那笔，其余照常列出", () => {
  const ts = at(2022, 8, 5)
  const entries = expenseEntries([maintenance("m", ts, 0, "第四次保养"), expense("park", ts, 100000, 10), expense("fix", ts, MAINTENANCE_CATEGORY, 0)])
  assert.equal(entries.length, 2)
  assert.equal(entries.find(e => e.id === "fix")?.maintenance?.id, "m")
  assert.equal(entries.find(e => e.id === "park")?.maintenance, null)
})

test("分类合计按金额从大到小，合计为 0 的类别不列出；范围；从第一笔算起", () => {
  const entries = expenseEntries([...records, maintenance("free", at(2023, 4, 15), 0, "第五次保养")])
  const all = expenseSummary(entries, "all", at(2026, 10, 22))
  assert.ok(Math.abs(all.total - (6830.5 + 1860 + 420 + 120)) < 1e-9)
  assert.deepEqual(all.categories.map(c => c.category_id), [100002, MAINTENANCE_CATEGORY, WASH])
  assert.equal(all.categories[1].amount, 2280)
  assert.equal(all.count, 5)
  assert.equal(all.from_ts, at(2020, 7, 10))
  const year = expenseSummary(entries, "1y", at(2026, 10, 22))
  assert.equal(year.total, 6830.5)
  assert.equal(year.count, 1)
  const none = expenseSummary(entries, "ytd", at(2026, 10, 22))
  assert.deepEqual([none.total, none.categories.length], [0, 0])
})

test("每年按付款日期：车险 12 月付的算在付款那一年；每月合计", () => {
  const entries = expenseEntries(records)
  const years = expenseYears(entries)
  assert.deepEqual(years.map(y => [y.year, y.total]), [[2025, 6830.5], [2021, 1980], [2020, 420]])
  assert.deepEqual(years[1].categories.map(c => c.category_id), [MAINTENANCE_CATEGORY, WASH])
  const months = monthTotals(entries)
  assert.equal(months.get("2025-12"), 6830.5)
  assert.equal(months.get("2021-01"), 1860) // 保养和它的费用只算一次
  assert.equal(months.get("2021-04"), 120) // 同月的加油不算
})
