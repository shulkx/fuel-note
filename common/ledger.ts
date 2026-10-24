// 账本的纯逻辑（2.0 设计第 3、4 节）：所有车辆的记录都存在本机；记录有固定的 id，保险、权益使用、保养按费用的 id 关联。
import { newId } from "./ids"
import {
  ExpenseCategory, ExpenseData, ExpenseRecord, FuelData, FuelRecord, InsuranceYear, LedgerFile, LedgerRecord, Station, Vehicle, VehicleProfile,
} from "./types"
import { expenseFor } from "./insurance"
import { XxyhState } from "../sync/xxyh/types"

export type AppData = { ledger: LedgerFile; xxyh: XxyhState }

export function makeAppData(ledger: LedgerFile, xxyh: XxyhState): AppData {
  return { ledger, xxyh }
}

export function vehicleById(data: AppData, id: string | null): Vehicle | null {
  return data.ledger.vehicles.find(v => v.id === id) || null
}

/** 没有隐藏的车辆（车辆菜单、统计、小组件只用这些） */
export function visibleVehicles(data: AppData): Vehicle[] {
  return data.ledger.vehicles.filter(v => !v.hidden)
}

/** 当前车辆；设置里的车辆被隐藏或删除时，用第一辆没有隐藏的 */
export function currentVehicle(data: AppData): Vehicle | null {
  const v = vehicleById(data, data.ledger.settings.current_vehicle_id)
  if (v && !v.hidden) return v
  return visibleVehicles(data)[0] || data.ledger.vehicles[0] || null
}

/** 隐藏或恢复一辆车。至少保留一辆没有隐藏的车辆；隐藏当前车辆时切到另一辆（设计文档 17.7 节） */
export function setHidden(ledger: LedgerFile, id: string, hidden: boolean): LedgerFile {
  const v = ledger.vehicles.find(x => x.id === id)
  if (!v) throw new Error("找不到车辆")
  if (hidden && !ledger.vehicles.some(x => x.id !== id && !x.hidden)) throw new Error("至少保留一辆没有隐藏的车辆")
  const vehicles = ledger.vehicles.map(x => (x.id === id ? { ...x, hidden } : x))
  let current = ledger.settings.current_vehicle_id
  if (hidden && current === id) current = vehicles.find(x => !x.hidden)?.id ?? null
  return { ...ledger, vehicles, settings: { ...ledger.settings, current_vehicle_id: current } }
}

/** 删除一辆车会一起删掉的东西（2.0 设计第 4 节）：记录、保险年度（调用方删原件）、权益卡和它们的使用记录 */
export type VehicleDeletion = { ledger: LedgerFile; records: number; insurance: string[]; perks: number }

/** 删除一辆车，连同它的记录、保险年度、权益卡和使用记录；至少保留一辆没有隐藏的车，删的是当前车辆时切到另一辆 */
export function vehicleDeletion(ledger: LedgerFile, id: string): VehicleDeletion {
  let vehicles = ledger.vehicles.filter(x => x.id !== id)
  if (vehicles.length && vehicles.every(x => x.hidden)) vehicles = vehicles.map((x, i) => (i === 0 ? { ...x, hidden: false } : x))
  const records = ledger.records.filter(r => r.vehicle_id === id).length
  const insurance = ledger.insurance.filter(y => y.vehicle_id === id).map(y => y.id)
  const perkIds = new Set(ledger.perks.filter(p => p.vehicle_id === id).map(p => p.id))
  const current = ledger.settings.current_vehicle_id
  const next: LedgerFile = {
    ...ledger, vehicles, records: ledger.records.filter(r => r.vehicle_id !== id),
    insurance: ledger.insurance.filter(y => y.vehicle_id !== id),
    perks: ledger.perks.filter(p => !perkIds.has(p.id)),
    perk_uses: ledger.perk_uses.filter(u => !perkIds.has(u.perk_id)),
    settings: { ...ledger.settings, current_vehicle_id: current !== id && vehicles.some(x => x.id === current) ? current : vehicles.find(x => !x.hidden)?.id ?? null },
  }
  return { ledger: next, records, insurance, perks: perkIds.size }
}

/** 一辆车的全部记录，按时间倒序 */
export function vehicleRecords(data: AppData, vehicle: Vehicle): LedgerRecord[] {
  return data.ledger.records.filter(r => r.vehicle_id === vehicle.id).sort((a, b) => b.ts - a.ts)
}

export function fuelRecords(data: AppData, vehicle: Vehicle): FuelRecord[] {
  return vehicleRecords(data, vehicle).filter((r): r is FuelRecord => r.kind === "fuel")
}

/** 选油站的候选：所有车共用我的油站 */
export function stationsFor(data: AppData, _vehicle: Vehicle | null): Station[] {
  return data.ledger.stations
}

export function categoriesFor(data: AppData): ExpenseCategory[] {
  return data.ledger.expense_categories
}

export function categoryName(data: AppData, id: number): string {
  return categoriesFor(data).find(c => c.id === id)?.name || "其他"
}

/** 最近 10 次最常加的标号 */
export function usualGrade(data: AppData, vehicle: Vehicle): number | null {
  const counts = new Map<number, number>()
  for (const r of fuelRecords(data, vehicle).slice(0, 10)) if (r.grade != null) counts.set(r.grade, (counts.get(r.grade) || 0) + 1)
  let best: number | null = null
  for (const [g, n] of counts) if (best == null || n > (counts.get(best) || 0)) best = g
  return best ?? vehicle.default_grade
}

// ---------- 修改 ----------

export function toFuelData(r: FuelData): FuelData {
  return {
    ts: r.ts, odometer: r.odometer, liters: r.liters, price: r.price, amount: r.amount, paid: r.paid, grade: r.grade,
    full: r.full, light_on: r.light_on, missed_before: r.missed_before, station_id: r.station_id, remark: r.remark,
  }
}

export function toExpenseData(r: ExpenseData): ExpenseData {
  return { ts: r.ts, category_id: r.category_id, amount: r.amount, remark: r.remark }
}

/** 一次修改的结果。recordId：新建或修改的记录 id；removedInsurance：一起删掉的保险年度（用来删保单原件） */
export type Change = { ledger: LedgerFile; recordId?: string | null; removedInsurance?: string[] }

/** 不改记录的修改（只改保险、权益等）：复制一份账本 */
export function unchanged(data: AppData): Change {
  return { ledger: JSON.parse(JSON.stringify(data.ledger)) }
}

function upsertStation(ledger: LedgerFile, station: Station, ts: number): void {
  const s = ledger.stations.find(x => x.id === station.id)
  if (s) s.last_used_ts = Math.max(s.last_used_ts, ts)
  else ledger.stations.push({ ...station, last_used_ts: ts })
}

/** 保存加油记录。recordId 为 null 表示新增；newStation 是这次要新建的油站。编辑时保留表单以外的字段（小熊的原样） */
export function putFuel(data: AppData, vehicle: Vehicle, recordId: string | null, fuel: FuelData, newStation: Station | null): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  if (newStation) upsertStation(ledger, newStation, fuel.ts)
  else if (fuel.station_id) {
    const s = ledger.stations.find(x => x.id === fuel.station_id)
    if (s) s.last_used_ts = Math.max(s.last_used_ts, fuel.ts)
  }
  const before = recordId ? ledger.records.find((r): r is FuelRecord => r.id === recordId && r.kind === "fuel") : undefined
  const rec: FuelRecord = { ...before, ...toFuelData(fuel), kind: "fuel", id: recordId || newId("f"), vehicle_id: vehicle.id }
  ledger.records = before ? ledger.records.map(r => (r.id === recordId ? rec : r)) : [...ledger.records, rec]
  return { ledger, recordId: rec.id }
}

/**
 * 保存费用。store：undefined 不改门店，null 去掉门店，否则是门店的 id。编辑时保留表单以外的字段（小熊的原样）
 */
export function putExpense(data: AppData, vehicle: Vehicle, recordId: string | null, expense: ExpenseData, store?: string | null): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const before = recordId ? ledger.records.find((r): r is ExpenseRecord => r.id === recordId && r.kind === "expense") : undefined
  const { store_id: oldStore, ...rest } = before ?? ({} as Partial<ExpenseRecord>)
  const storeId = store === undefined ? oldStore : store ?? undefined
  const rec: ExpenseRecord = { ...rest, ...toExpenseData(expense), kind: "expense", id: recordId || newId("e"), vehicle_id: vehicle.id, ...(storeId ? { store_id: storeId } : {}) }
  ledger.records = before ? ledger.records.map(r => (r.id === recordId ? rec : r)) : [...ledger.records, rec]
  return { ledger, recordId: rec.id }
}

/**
 * 删除一条记录。删的是费用时：关联了它的保险年度一起删除（设计文档 20.4 节），用在它上面的权益使用一起删除（剩余恢复），
 * 保养记录对它的关联去掉
 */
export function removeRecord(data: AppData, record: LedgerRecord): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  ledger.records = ledger.records.filter(r => r.id !== record.id)
  if (record.kind !== "expense") return { ledger, removedInsurance: [] }
  const years = ledger.insurance.filter(y => y.expense_id === record.id).map(y => y.id)
  ledger.insurance = ledger.insurance.filter(y => !years.includes(y.id))
  ledger.perk_uses = ledger.perk_uses.filter(u => u.expense_id !== record.id)
  ledger.records = ledger.records.map(r => {
    if (r.kind !== "maintenance" || r.expense_id !== record.id) return r
    const { expense_id: _gone, ...rest } = r
    return rest
  })
  return { ledger, removedInsurance: years }
}

// ---------- 保险（设计文档 20.4 节） ----------

/**
 * 保存一年的保险，并新记或更新对应的「保险和交通规费」费用（按 expense_id）。新记时备注写「2026 车险 · 保险公司」，之后备注不再改。
 * amount 为 keep 时（补到已有的费用、保留原金额）金额不动，只跟着付款日期改日期
 */
export function putInsurance(data: AppData, vehicle: Vehicle, year: InsuranceYear, amount: "total" | "keep"): Change & { year: InsuranceYear } {
  const existing = year.expense_id
    ? data.ledger.records.find((r): r is ExpenseRecord => r.kind === "expense" && r.id === year.expense_id && r.vehicle_id === vehicle.id)
    : undefined
  let next: InsuranceYear = { ...year, vehicle_id: vehicle.id, expense_id: existing ? existing.id : null }
  let c: Change
  if (existing && amount === "keep") {
    c = existing.ts === next.paid_ts ? unchanged(data) : putExpense(data, vehicle, existing.id, { ...toExpenseData(existing), ts: next.paid_ts })
  } else {
    const fresh = expenseFor(next)
    const exp: ExpenseData = existing ? { ...fresh, remark: existing.remark } : fresh
    const same = existing && existing.ts === exp.ts && existing.amount === exp.amount && existing.category_id === exp.category_id && existing.remark === exp.remark
    c = same ? unchanged(data) : putExpense(data, vehicle, existing ? existing.id : null, exp)
    if (!existing) next = { ...next, expense_id: c.recordId ?? null }
  }
  c.ledger.insurance = [...c.ledger.insurance.filter(y => y.id !== next.id), next]
  return { ...c, year: next }
}

/** 删除一年的保险；withExpense 时连对应的费用一起删除 */
export function removeInsurance(data: AppData, id: string, withExpense: boolean): Change {
  const year = data.ledger.insurance.find(y => y.id === id)
  if (!year) throw new Error("找不到这一年的保险")
  const record = withExpense && year.expense_id ? data.ledger.records.find(r => r.id === year.expense_id) : undefined
  const c = record ? removeRecord(data, record) : unchanged(data)
  c.ledger.insurance = c.ledger.insurance.filter(y => y.id !== id)
  return { ...c, removedInsurance: [id] }
}

export const EMPTY_PROFILE: VehicleProfile = {
  model: null, model_name: null, pinpai: null, chexi: null, vehicle_type: null, replenish_mode: null, gas_type: null, buy_date: null,
}
