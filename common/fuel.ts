// 跳枪法油耗：两次「加满」之间为一段，油耗显示在这一段的终点记录上。
import { FuelRecord } from "./types"

export type Segment = {
  from: FuelRecord
  to: FuelRecord
  liters: number
  distance: number
  /** 升/百公里 */
  consumption: number
}

/** 同一辆车的加油记录按里程（相同时按时间）排序 */
export function sortFuel(records: FuelRecord[]): FuelRecord[] {
  return records.slice().sort((a, b) => a.odometer - b.odometer || a.ts - b.ts)
}

/**
 * 计算所有有效分段。
 * 段内任一记录标了「上次漏记」则这一段无效；第一次加满之前、两次加满之间的非加满记录都不单独计算。
 */
export function fuelSegments(records: FuelRecord[]): Segment[] {
  const segments: Segment[] = []
  let start: FuelRecord | null = null
  let liters = 0
  let invalid = false
  for (const r of sortFuel(records)) {
    if (!start) {
      if (r.full) { start = r; liters = 0; invalid = false }
      continue
    }
    liters += r.liters
    if (r.missed_before) invalid = true
    if (!r.full) continue
    const distance = r.odometer - start.odometer
    if (!invalid && distance > 0 && liters > 0) {
      segments.push({ from: start, to: r, liters, distance, consumption: liters / distance * 100 })
    }
    start = r
    liters = 0
    invalid = false
  }
  return segments
}

/** 每条记录（按 id）对应的本次油耗 */
export function consumptionById(records: FuelRecord[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of fuelSegments(records)) out.set(s.to.id, s.consumption)
  return out
}

export function averageConsumption(segments: Segment[]): number | null {
  let liters = 0
  let distance = 0
  for (const s of segments) { liters += s.liters; distance += s.distance }
  return distance > 0 ? liters / distance * 100 : null
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
