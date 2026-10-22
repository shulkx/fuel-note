// 油耗的统计（纯函数，设计文档 21.3 节）：只收加油记录，按范围汇总花费、里程、油耗；每月加油、同期对比、单价、每年汇总。
// 费用的统计在 expense_stats.ts，两边互不读对方的记录。
import { averageConsumption, fuelSegments, Segment } from "./fuel"
import { nextMonth, rangeStart, StatsRange } from "./ranges"
import { monthKey } from "./time"
import { FuelRecord } from "./types"

export type Summary = {
  avg_consumption: number | null
  latest_consumption: number | null
  distance_km: number
  fuel_cost: number
  fuel_liters: number
  fuel_count: number
  /** 每公里油费：只算加油 */
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

/** 时间段内行驶里程：段内最大里程 − 段开始前的最大里程（没有更早的记录时用段内最小里程） */
function distanceIn(records: FuelRecord[], from: number, to = Infinity): number {
  const odos = records.filter(r => r.odometer > 0)
  const inOdo = odos.filter(x => x.ts >= from && x.ts < to).map(x => x.odometer)
  const beforeOdo = odos.filter(x => x.ts < from).map(x => x.odometer)
  if (!inOdo.length) return 0
  return Math.max(0, Math.max(...inOdo) - (beforeOdo.length ? Math.max(...beforeOdo) : Math.min(...inOdo)))
}

export function summarize(records: FuelRecord[], range: StatsRange, now = Date.now()): Summary {
  const from = rangeStart(range, now)
  const segments = fuelSegments(records).filter(s => s.to.ts >= from)
  const fuelIn = records.filter(r => r.ts >= from).sort((a, b) => a.ts - b.ts)
  const fuelCost = fuelIn.reduce((s, r) => s + r.paid, 0)
  const pumpAmount = fuelIn.reduce((s, r) => s + r.amount, 0)
  const liters = fuelIn.reduce((s, r) => s + r.liters, 0)
  const distance = distanceIn(records, from)
  const sorted = records.slice().sort((a, b) => a.ts - b.ts)
  const last = sorted[sorted.length - 1]
  const allOdo = records.map(r => r.odometer).filter(x => x > 0)
  // 范围实际覆盖的天数：从范围开始（「全部」时从第一条记录）到今天
  const firstTs = fuelIn.length ? fuelIn[0].ts : null
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
    cost_per_km: distance > 0 ? fuelCost / distance : null,
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

/** 范围内的月均油费：合计 ÷ 范围覆盖的月数（不足一个月按一个月） */
export function monthlyMean(s: Summary, now = Date.now()): number | null {
  if (s.from_ts == null) return null
  const days = Math.max(1, (now - s.from_ts) / 86400e3)
  return s.fuel_cost * 30.44 / Math.max(days, 30.44)
}

// ---------- 每月加油 ----------

export type MonthFuel = { month: string; cost: number; fills: number }

/** 范围内每个月的加油花费；没有加油的月份补 0。从范围开始的月份（「全部」时从第一条记录的月份）到本月 */
export function monthlyFuel(records: FuelRecord[], range: StatsRange, now = Date.now()): MonthFuel[] {
  const from = rangeStart(range, now)
  const map = new Map<string, MonthFuel>()
  for (const r of records) {
    if (r.ts < from) continue
    const key = monthKey(r.ts)
    const m = map.get(key) || { month: key, cost: 0, fills: 0 }
    m.cost += r.paid
    m.fills += 1
    map.set(key, m)
  }
  if (!map.size) return []
  const first = from === -Infinity ? Array.from(map.keys()).sort()[0] : monthKey(from)
  const last = monthKey(now)
  const out: MonthFuel[] = []
  for (let key = first, guard = 0; guard < 1200; key = nextMonth(key), guard++) {
    out.push(map.get(key) || { month: key, cost: 0, fills: 0 })
    if (key >= last) break
  }
  return out
}

/** 本月的加油花费（小组件） */
export function monthFuelCost(records: FuelRecord[], now = Date.now()): number {
  const key = monthKey(now)
  return records.filter(r => monthKey(r.ts) === key).reduce((s, r) => s + r.paid, 0)
}

// ---------- 油耗、单价 ----------

export function consumptionSeries(records: FuelRecord[], range: StatsRange, now = Date.now()): Segment[] {
  const from = rangeStart(range, now)
  return fuelSegments(records).filter(s => s.to.ts >= from).sort((a, b) => a.to.ts - b.to.ts)
}

export type PricePoint = { ts: number; paid: number; pump: number; grade: number | null }

/** 每次加油的实付单价（实付 ÷ 升数）和机显单价（机显金额 ÷ 升数） */
export function priceSeries(records: FuelRecord[], range: StatsRange, now = Date.now()): PricePoint[] {
  const from = rangeStart(range, now)
  return records.filter(r => r.ts >= from && r.liters > 0)
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

export function yearOverYear(records: FuelRecord[], now = Date.now()): YearOverYear {
  const d = new Date(now)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const segs = fuelSegments(records)
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

/** 每年的加油次数、里程、油费、平均油耗；新的在前 */
export function yearSummaries(records: FuelRecord[]): YearSummary[] {
  const years = Array.from(new Set(records.map(r => new Date(r.ts).getFullYear()))).sort((a, b) => b - a)
  const segs = fuelSegments(records)
  return years.map(y => {
    const from = new Date(y, 0, 1).getTime()
    const to = new Date(y + 1, 0, 1).getTime()
    const inYear = records.filter(r => r.ts >= from && r.ts < to)
    return {
      year: y,
      fills: inYear.length,
      distance_km: distanceIn(records, from, to),
      cost: inYear.reduce((s, r) => s + r.paid, 0),
      avg_consumption: averageConsumption(segs.filter(s => s.to.ts >= from && s.to.ts < to)),
    }
  }).filter(y => y.fills)
}
