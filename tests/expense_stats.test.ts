// 费用的统计（设计文档 21.4、22.5、22.6、22.9 节）：费用和小熊的保养合成一笔一行、保养只算一次；去掉车险；分类合计、范围、每年按付款日期、
// 每月合计；记费用的分段和默认类别
import { test } from "node:test"
import assert from "node:assert/strict"
import { defaultCategory, expenseEntries, expenseSummary, expenseYears, formCategories, MAINTENANCE_CATEGORY, monthTotals, withoutCarInsurance } from "../common/expense_stats"
import { DEFAULT_EXPENSE_CATEGORIES, ExpenseCategory, ExpenseRecord, InsuranceYear, LedgerRecord, MaintenanceRecord } from "../common/types"
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
test("费用页和费用统计去掉车险：关联了保险年度的、只有金额的车险不算；年检照常算", () => {
  const linked: InsuranceYear = { id: "y1", vehicle_id: "v1", policies: [], discount: 0, paid_ts: at(2025, 12, 18), expense_id: "ins", remark: "" }
  const more = [
    ...records,
    expense("old", at(2020, 12, 10), 100002, 5000, "2021年示例车险"), // 只有金额
    expense("check", at(2022, 3, 1), 100002, 80, "年检"),
  ]
  const rest = withoutCarInsurance(expenseEntries(more), [linked])
  assert.deepEqual(rest.map(e => e.id), ["check", "wash", "e2", "m1"])
  const years = expenseYears(rest)
  assert.deepEqual(years.map(y => [y.year, y.total]), [[2022, 80], [2021, 1980], [2020, 420]])
  assert.equal(years.reduce((t, y) => t + y.total, 0), expenseSummary(rest, "all", at(2026, 10, 22)).total)
})

test("每年也列出合计为 0 的年份（一年里只有免费保养）", () => {
  const years = expenseYears(expenseEntries([...records.slice(1), maintenance("free", at(2023, 4, 15), 0, "第五次保养")]))
  assert.deepEqual(years.map(y => [y.year, y.total]), [[2023, 0], [2021, 1980], [2020, 420]])
})

test("记费用的分段：照类别列表的顺序、不含保险和交通规费，编辑这一类的费用时加上；默认最近一笔非保险的类别", () => {
  // 小熊的类别（已按 sortId 排）：行车费 · 维修保养 · 清洗护理 · 保险和交通规费 · 其它
  const xxyh: ExpenseCategory[] = [
    { id: 100000, name: "行车费", description: "" }, { id: MAINTENANCE_CATEGORY, name: "维修保养", description: "" },
    { id: WASH, name: "清洗护理", description: "" }, { id: 100002, name: "保险和交通规费", description: "" }, { id: 100003, name: "其它", description: "" },
  ]
  assert.deepEqual(formCategories(xxyh, null).map(c => c.name), ["行车费", "维修保养", "清洗护理", "其它"])
  assert.deepEqual(formCategories(xxyh, WASH).map(c => c.id), [100000, MAINTENANCE_CATEGORY, WASH, 100003])
  assert.deepEqual(formCategories(xxyh, 100002).map(c => c.id), [100000, MAINTENANCE_CATEGORY, WASH, 100002, 100003])
  // 最近一笔是车险，跳过它，取洗车
  assert.equal(defaultCategory(expenseEntries(records), xxyh), WASH)
  assert.equal(defaultCategory(expenseEntries(records.filter(r => r.id !== "wash")), xxyh), MAINTENANCE_CATEGORY)
  assert.equal(defaultCategory([], xxyh), 100000)
  assert.equal(defaultCategory([], DEFAULT_EXPENSE_CATEGORIES), 100000)
})
