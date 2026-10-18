// 统计：按范围汇总花费、里程、油耗；每月花费、同期对比、单价、每年汇总（纯函数）
import { FuelRecord, LedgerRecord } from "./types"
import { averageConsumption, fuelSegments, Segment } from "./fuel"
import { monthKey } from "./time"

export type StatsRange = "6m" | "1y" | "3y" | "all"

export const RANGE_TITLES: Record<StatsRange, string> = { "6m": "半年", "1y": "1 年", "3y": "3 年", all: "全部" }
export const RANGES: StatsRange[] = ["6m", "1y", "3y", "all"]

const RANGE_MONTHS: Record<Exclude<StatsRange, "all">, number> = { "6m": 6, "1y": 12, "3y": 36 }

/** 范围的开始时刻：从今天往前推 N 个月（次日 0 点，即正好 N 个月）；全部为 -Infinity */
export function rangeStart(range: StatsRange, now = Date.now()): number {
  if (range === "all") return -Infinity
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth() - RANGE_MONTHS[range], d.getDate() + 1).getTime()
}

export type Summary = {
  avg_consumption: number | null
  latest_consumption: number | null
  distance_km: number
  fuel_cost: number
  fuel_liters: number
  fuel_count: number
  other_cost: number
  total_cost: number
  cost_per_km: number | null
  last_odometer: number | null
  last_fuel_ts: number | null
  /** 范围实际覆盖的开始时刻（「全部」时为第一条记录） */
  from_ts: number | null
  /** 日均行驶 */
  km_per_day: number | null
  /** 平均几天加一次油 */
  days_per_fill: number | null
  /** 平均多少公里加一次油 */
  km_per_fill: number | null
  liters_per_fill: number | null
  /** 优惠合计（机显金额 − 实付） */
  discount: number
  pump_amount: number
  /** 平均单价：实付 ÷ 升数、机显金额 ÷ 升数 */
  paid_unit_price: number | null
  pump_unit_price: number | null
}

const costOf = (r: LedgerRecord) => (r.kind === "fuel" ? r.paid : r.amount)
const isFuel = (r: LedgerRecord): r is FuelRecord & LedgerRecord => r.kind === "fuel"

/** 时间段内行驶里程：段内最大里程 − 段开始前的最大里程（没有更早的记录时用段内最小里程） */
function distanceIn(records: LedgerRecord[], from: number, to = Infinity): number {
  const odos = records.filter(r => r.kind !== "expense").map(r => ({ ts: r.ts, odo: (r as { odometer: number }).odometer })).filter(x => x.odo > 0)
  const inOdo = odos.filter(x => x.ts >= from && x.ts < to).map(x => x.odo)
  const beforeOdo = odos.filter(x => x.ts < from).map(x => x.odo)
  if (!inOdo.length) return 0
  return Math.max(0, Math.max(...inOdo) - (beforeOdo.length ? Math.max(...beforeOdo) : Math.min(...inOdo)))
}

export function summarize(records: LedgerRecord[], range: StatsRange, now = Date.now()): Summary {
  const from = rangeStart(range, now)
  const fuel = records.filter(isFuel)
  const segments = fuelSegments(fuel).filter(s => s.to.ts >= from)
  const inRange = records.filter(r => r.ts >= from)
  const fuelIn = inRange.filter(isFuel).sort((a, b) => a.ts - b.ts)
  const fuelCost = fuelIn.reduce((s, r) => s + r.paid, 0)
  const pumpAmount = fuelIn.reduce((s, r) => s + r.amount, 0)
  const liters = fuelIn.reduce((s, r) => s + r.liters, 0)
  const otherCost = inRange.filter(r => r.kind !== "fuel").reduce((s, r) => s + costOf(r), 0)
  const distance = distanceIn(records, from)
  const sortedFuel = fuel.slice().sort((a, b) => a.ts - b.ts)
  const last = sortedFuel[sortedFuel.length - 1]
  const allOdo = records.filter(r => r.kind !== "expense").map(r => (r as { odometer: number }).odometer).filter(x => x > 0)
  // 范围实际覆盖的天数：从范围开始（「全部」时从第一条记录）到今天
  const firstTs = inRange.length ? Math.min(...inRange.map(r => r.ts)) : null
  const fromTs = from === -Infinity ? firstTs : from
  const days = fromTs != null ? Math.max(1, (now - fromTs) / 86400e3) : null
  const gaps = fuelIn.slice(1).map((r, i) => (r.ts - fuelIn[i].ts) / 86400e3)
  return {
    avg_consumption: averageConsumption(segments),
    latest_consumption: segments.length ? segments.slice().sort((a, b) => a.to.ts - b.to.ts)[segments.length - 1].consumption : null,
    distance_km: distance,
    fuel_cost: fuelCost,
    fuel_liters: liters,
    fuel_count: fuelIn.length,
    other_cost: otherCost,
    total_cost: fuelCost + otherCost,
    cost_per_km: distance > 0 ? (fuelCost + otherCost) / distance : null,
    last_odometer: allOdo.length ? Math.max(...allOdo) : null,
    last_fuel_ts: last ? last.ts : null,
    from_ts: fromTs,
    km_per_day: days && distance > 0 ? distance / days : null,
    days_per_fill: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    km_per_fill: fuelIn.length && distance > 0 ? distance / fuelIn.length : null,
    liters_per_fill: fuelIn.length ? liters / fuelIn.length : null,
    discount: Math.max(0, pumpAmount - fuelCost),
    pump_amount: pumpAmount,
    paid_unit_price: liters > 0 ? fuelCost / liters : null,
    pump_unit_price: liters > 0 ? pumpAmount / liters : null,
  }
}

// ---------- 每月花费 ----------

export type MonthCost = { month: string; fuel: number; other: number; fills: number }

const nextMonth = (key: string) => {
  let [y, m] = key.split("-").map(Number)
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, "0")}`
}

/** 范围内每个月的花费；没有花费的月份补 0。从范围开始的月份（「全部」时从第一条记录的月份）到本月 */
export function monthlyCosts(records: LedgerRecord[], range: StatsRange, now = Date.now()): MonthCost[] {
  const from = rangeStart(range, now)
  const map = new Map<string, MonthCost>()
  for (const r of records) {
    if (r.ts < from) continue
    const key = monthKey(r.ts)
    const m = map.get(key) || { month: key, fuel: 0, other: 0, fills: 0 }
    if (r.kind === "fuel") { m.fuel += r.paid; m.fills += 1 } else m.other += costOf(r)
    map.set(key, m)
  }
  if (!map.size) return []
  const first = from === -Infinity ? Array.from(map.keys()).sort()[0] : monthKey(from)
  const last = monthKey(now)
  const out: MonthCost[] = []
  for (let key = first, guard = 0; guard < 1200; key = nextMonth(key), guard++) {
    out.push(map.get(key) || { month: key, fuel: 0, other: 0, fills: 0 })
    if (key >= last) break
  }
  return out
}

// ---------- 油耗、单价 ----------

export function consumptionSeries(records: LedgerRecord[], range: StatsRange, now = Date.now()): Segment[] {
  const from = rangeStart(range, now)
  return fuelSegments(records.filter(isFuel)).filter(s => s.to.ts >= from).sort((a, b) => a.to.ts - b.to.ts)
}

export type PricePoint = { ts: number; paid: number; pump: number; grade: number | null }

/** 每次加油的实付单价（实付 ÷ 升数）和机显单价（机显金额 ÷ 升数） */
export function priceSeries(records: LedgerRecord[], range: StatsRange, now = Date.now()): PricePoint[] {
  const from = rangeStart(range, now)
  return records.filter(isFuel).filter(r => r.ts >= from && r.liters > 0)
    .sort((a, b) => a.ts - b.ts)
    .map(r => ({ ts: r.ts, paid: r.paid / r.liters, pump: r.amount / r.liters, grade: r.grade }))
}

// ---------- 同期对比 ----------

export type YearOverYear = {
  year: number
  /** 每月平均油耗（按分段终点所在的月份），没有数据为 null */
  current: Array<number | null>
  previous: Array<number | null>
  /** 今年 1 月到本月、去年同期的平均油耗 */
  ytd: number | null
  prevYtd: number | null
  /** 本月是几月（1–12） */
  month: number
}

export function yearOverYear(records: LedgerRecord[], now = Date.now()): YearOverYear {
  const d = new Date(now)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const segs = fuelSegments(records.filter(isFuel))
  const monthly = (y: number) => Array.from({ length: 12 }, (_, i) => averageConsumption(segs.filter(s => {
    const t = new Date(s.to.ts)
    return t.getFullYear() === y && t.getMonth() === i
  })))
  const ytdOf = (y: number) => averageConsumption(segs.filter(s => {
    const t = new Date(s.to.ts)
    return t.getFullYear() === y && t.getMonth() < month
  }))
  return { year, current: monthly(year), previous: monthly(year - 1), ytd: ytdOf(year), prevYtd: ytdOf(year - 1), month }
}

// ---------- 每年 ----------

export type YearSummary = { year: number; fills: number; distance_km: number; cost: number; avg_consumption: number | null }

/** 每年的加油次数、里程、花费（加油和其他费用）、平均油耗；新的在前 */
export function yearSummaries(records: LedgerRecord[]): YearSummary[] {
  const years = Array.from(new Set(records.map(r => new Date(r.ts).getFullYear()))).sort((a, b) => b - a)
  const segs = fuelSegments(records.filter(isFuel))
  return years.map(y => {
    const from = new Date(y, 0, 1).getTime()
    const to = new Date(y + 1, 0, 1).getTime()
    const inYear = records.filter(r => r.ts >= from && r.ts < to)
    return {
      year: y,
      fills: inYear.filter(r => r.kind === "fuel").length,
      distance_km: distanceIn(records, from, to),
      cost: inYear.reduce((s, r) => s + costOf(r), 0),
      avg_consumption: averageConsumption(segs.filter(s => s.to.ts >= from && s.to.ts < to)),
    }
  }).filter(y => y.fills || y.cost)
}

export function monthCost(records: LedgerRecord[], now = Date.now()): number {
  const key = monthKey(now)
  return records.filter(r => monthKey(r.ts) === key).reduce((s, r) => s + costOf(r), 0)
}
