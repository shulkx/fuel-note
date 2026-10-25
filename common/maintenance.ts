// 保养记录（2.1 设计第 5、11 节，纯函数）：维修保养费用填了项目时另存一条保养记录，expense_id 指向这笔费用，两条一起改、一起删；
// 用过的项目按次数排，给保养项目页点选。
import { MAINTENANCE_CATEGORY } from "./expense_stats"
import { newId } from "./ids"
import { ExpenseRecord, LedgerFile, LocalRecord, MaintenanceRecord } from "./types"

/** 记费用表单里「保养」一组的内容：备注是保养的说明，费用和保养用同一段（导出时小熊的费用备注由它和里程、项目生成） */
export type MaintenanceInput = { odometer: number; items: string[]; remark: string }

/** 这笔费用的保养记录；没有时 null */
export function maintenanceOf(records: LocalRecord[], expenseId: string): MaintenanceRecord | null {
  return records.find((r): r is MaintenanceRecord => r.kind === "maintenance" && r.expense_id === expenseId) ?? null
}

/**
 * 保存费用以后：是维修保养、填了项目时存（或更新）它的保养记录，时间、金额跟着费用；没填项目、换了类别或 input 为 null 时删掉。
 * 导入的保养留着 xxyh_raw 和其他字段
 */
export function putMaintenance(ledger: LedgerFile, expenseId: string, input: MaintenanceInput | null): LedgerFile {
  const e = ledger.records.find((r): r is ExpenseRecord => r.kind === "expense" && r.id === expenseId)
  const old = maintenanceOf(ledger.records, expenseId)
  if (!e || !input || !input.items.length || e.category_id !== MAINTENANCE_CATEGORY) {
    return old ? { ...ledger, records: ledger.records.filter(r => r.id !== old.id) } : ledger
  }
  const rec: MaintenanceRecord = {
    ...(old ?? {}), kind: "maintenance", id: old?.id ?? newId("m"), vehicle_id: e.vehicle_id,
    ts: e.ts, odometer: input.odometer, items: input.items, amount: e.amount, remark: input.remark, expense_id: e.id,
  }
  return { ...ledger, records: old ? ledger.records.map(r => (r.id === old.id ? rec : r)) : [...ledger.records, rec] }
}

/** 这辆车用过的保养项目：按用过的次数排，次数一样时最近用过的在前 */
export function usedItems(records: LocalRecord[], vehicleId: string): string[] {
  const stats = new Map<string, { count: number; last: number }>()
  for (const r of records) {
    if (r.kind !== "maintenance" || r.vehicle_id !== vehicleId) continue
    for (const name of r.items) {
      const s = stats.get(name) ?? { count: 0, last: 0 }
      stats.set(name, { count: s.count + 1, last: Math.max(s.last, r.ts) })
    }
  }
  return [...stats.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).map(([name]) => name)
}
