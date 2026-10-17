// 统计：按范围汇总花费、里程、油耗
import { FuelRecord, LedgerRecord } from "./types"
import { averageConsumption, fuelSegments, Segment } from "./fuel"
import { monthKey } from "./time"

export type StatsRange = "all" | "year" | "12m"

export const RANGE_TITLES: Record<StatsRange, string> = { all: "全部", year: "今年", "12m": "近 12 个月" }

export function rangeStart(range: StatsRange, now = Date.now()): number {
  if (range === "all") return -Infinity
  const d = new Date(now)
  if (range === "year") return new Date(d.getFullYear(), 0, 1).getTime()
  return new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime()
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
}

const costOf = (r: LedgerRecord) => (r.kind === "fuel" ? r.paid : r.amount)

export function summarize(records: LedgerRecord[], range: StatsRange, now = Date.now()): Summary {
  const from = rangeStart(range, now)
  const fuel = records.filter((r): r is FuelRecord & LedgerRecord => r.kind === "fuel")
  const segments = fuelSegments(fuel).filter(s => s.to.ts >= from)
  const inRange = records.filter(r => r.ts >= from)
  const fuelIn = inRange.filter(r => r.kind === "fuel") as FuelRecord[]
  const fuelCost = fuelIn.reduce((s, r) => s + r.paid, 0)
  const otherCost = inRange.filter(r => r.kind !== "fuel").reduce((s, r) => s + costOf(r), 0)

  // 行驶里程：范围内最大里程 − 范围开始前的最大里程（没有更早的记录时用范围内最小里程）
  const odos = records.filter(r => r.kind !== "expense").map(r => ({ ts: r.ts, odo: (r as { odometer: number }).odometer })).filter(x => x.odo > 0)
  const inOdo = odos.filter(x => x.ts >= from).map(x => x.odo)
  const beforeOdo = odos.filter(x => x.ts < from).map(x => x.odo)
  const distance = inOdo.length
    ? Math.max(...inOdo) - (beforeOdo.length ? Math.max(...beforeOdo) : Math.min(...inOdo))
    : 0
  const sortedFuel = fuel.slice().sort((a, b) => a.ts - b.ts)
  const last = sortedFuel[sortedFuel.length - 1]
  const allOdo = odos.map(x => x.odo)
  return {
    avg_consumption: averageConsumption(segments),
    latest_consumption: segments.length ? segments.slice().sort((a, b) => a.to.ts - b.to.ts)[segments.length - 1].consumption : null,
    distance_km: Math.max(0, distance),
    fuel_cost: fuelCost,
    fuel_liters: fuelIn.reduce((s, r) => s + r.liters, 0),
    fuel_count: fuelIn.length,
    other_cost: otherCost,
    total_cost: fuelCost + otherCost,
    cost_per_km: distance > 0 ? (fuelCost + otherCost) / distance : null,
    last_odometer: allOdo.length ? Math.max(...allOdo) : null,
    last_fuel_ts: last ? last.ts : null,
  }
}

export type MonthCost = { month: string; fuel: number; other: number }

export function monthlyCosts(records: LedgerRecord[], range: StatsRange, now = Date.now()): MonthCost[] {
  const from = rangeStart(range, now)
  const map = new Map<string, MonthCost>()
  for (const r of records) {
    if (r.ts < from) continue
    const key = monthKey(r.ts)
    const m = map.get(key) || { month: key, fuel: 0, other: 0 }
    if (r.kind === "fuel") m.fuel += r.paid
    else m.other += costOf(r)
    map.set(key, m)
  }
  return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month))
}

export function consumptionSeries(records: LedgerRecord[], range: StatsRange, now = Date.now()): Segment[] {
  const from = rangeStart(range, now)
  const fuel = records.filter(r => r.kind === "fuel") as FuelRecord[]
  return fuelSegments(fuel).filter(s => s.to.ts >= from).sort((a, b) => a.to.ts - b.to.ts)
}

export function monthCost(records: LedgerRecord[], now = Date.now()): number {
  const key = monthKey(now)
  return records.filter(r => monthKey(r.ts) === key).reduce((s, r) => s + costOf(r), 0)
}
