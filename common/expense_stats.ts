// 费用的统计（纯函数，设计文档 21.4 节）：费用和小熊的保养合成一笔一行；按范围的合计和分类、每年、每月合计。
// 只收费用和保养记录，加油记录不进来；油耗的统计在 fuel_stats.ts，两边互不读对方的记录。
import { rangeStart, StatsRange } from "./ranges"
import { monthKey } from "./time"
import { ExpenseRecord, FuelRecord, LedgerRecord, MaintenanceRecord } from "./types"

/** 小熊的「维修保养」类别：没有对应费用的保养记录算在这一类 */
export const MAINTENANCE_CATEGORY = 100001

export type ExpenseEntry = {
  /** 打开、删除时用的记录 id：有费用时是费用的，否则是保养记录的 */
  id: string
  ts: number
  /** 只算一次的金额：有费用时取费用的，否则取保养的花费 */
  amount: number
  category_id: number
  expense: (ExpenseRecord & LedgerRecord) | null
  maintenance: (MaintenanceRecord & LedgerRecord) | null
}

/**
 * 小熊的保养记录对应的费用：保养记录 id → 费用 id。
 * 小熊的一次保养是一条保养记录，加同一时刻的一条费用（费用带 maintain_id，但备份里保养记录的 id 都是 0，对不上），所以按时间相同对应。
 * 一条保养只配一笔费用；同一时刻有几笔时优先「维修保养」类别的。费用页（expenseEntries）和断开小熊时转成本机数据（ledger.ts）都用它。
 */
export function maintenanceExpenses(records: ReadonlyArray<FuelRecord | ExpenseRecord | MaintenanceRecord>): Map<string, string> {
  const expenses = records.filter((r): r is ExpenseRecord => r.kind === "expense")
  const out = new Map<string, string>()
  const taken = new Set<string>()
  for (const m of records) {
    if (m.kind !== "maintenance") continue
    const same = expenses.filter(e => e.ts === m.ts && !taken.has(e.id))
    const e = same.find(x => x.category_id === MAINTENANCE_CATEGORY) ?? same[0]
    if (!e) continue
    taken.add(e.id)
    out.set(m.id, e.id)
  }
  return out
}

/** 费用和保养合成一笔一行，按时间从新到旧：对应上的保养和费用一行，金额取费用的；没有对应费用的保养，按保养的花费、「维修保养」类别算 */
export function expenseEntries(records: LedgerRecord[]): ExpenseEntry[] {
  const pairs = maintenanceExpenses(records)
  const byExpense = new Map<string, MaintenanceRecord & LedgerRecord>()
  const out: ExpenseEntry[] = []
  for (const r of records) {
    if (r.kind !== "maintenance") continue
    const e = pairs.get(r.id)
    if (e) byExpense.set(e, r)
    else out.push({ id: r.id, ts: r.ts, amount: r.amount, category_id: MAINTENANCE_CATEGORY, expense: null, maintenance: r })
  }
  for (const r of records) {
    if (r.kind === "expense") out.push({ id: r.id, ts: r.ts, amount: r.amount, category_id: r.category_id, expense: r, maintenance: byExpense.get(r.id) ?? null })
  }
  return out.sort((a, b) => b.ts - a.ts)
}

export type CategoryAmount = { category_id: number; amount: number }

/** 每个类别的合计，金额从大到小；合计为 0 的类别不列出 */
function byCategory(entries: ExpenseEntry[]): CategoryAmount[] {
  const map = new Map<number, number>()
  for (const e of entries) map.set(e.category_id, (map.get(e.category_id) ?? 0) + e.amount)
  return Array.from(map, ([category_id, amount]) => ({ category_id, amount })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount)
}

export type ExpenseSummary = {
  total: number
  categories: CategoryAmount[]
  count: number
  /** 范围实际覆盖的开始时刻（「全部」时为第一笔） */
  from_ts: number | null
}

export function expenseSummary(entries: ExpenseEntry[], range: StatsRange, now = Date.now()): ExpenseSummary {
  const from = rangeStart(range, now)
  const inRange = entries.filter(e => e.ts >= from)
  const first = inRange.length ? Math.min(...inRange.map(e => e.ts)) : null
  return {
    total: inRange.reduce((s, e) => s + e.amount, 0),
    categories: byCategory(inRange),
    count: inRange.length,
    from_ts: from === -Infinity ? first : from,
  }
}

export type ExpenseYear = { year: number; total: number; categories: CategoryAmount[] }

/** 每年的费用，按付款日期（车险多在 12 月付下一年的保费，算在付款那一年）；新的在前 */
export function expenseYears(entries: ExpenseEntry[]): ExpenseYear[] {
  const years = Array.from(new Set(entries.map(e => new Date(e.ts).getFullYear()))).sort((a, b) => b - a)
  return years.map(y => {
    const inYear = entries.filter(e => new Date(e.ts).getFullYear() === y)
    return { year: y, total: inYear.reduce((s, e) => s + e.amount, 0), categories: byCategory(inYear) }
  })
}

/** 记录页每个月的合计：月份（YYYY-MM）→ 金额 */
export function monthTotals(entries: ExpenseEntry[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of entries) {
    const key = monthKey(e.ts)
    map.set(key, (map.get(key) ?? 0) + e.amount)
  }
  return map
}
