// 账本的纯逻辑：合并本机数据与小熊映射、把修改变成本机写入或小熊操作、断开与关联
import { newId } from "./ids"
import {
  ExpenseCategory, ExpenseData, ExpenseRecord, FuelData, FuelRecord, LedgerFile, LedgerRecord, LocalRecord,
  MaintenanceRecord, Station, Vehicle,
} from "./types"
import { carKey, carsOf, mapBackup, parseXxyhRecordId, xxyhRecordId, XxyhCarInfo } from "../sync/xxyh/mapping"
import { applyOps, OpConflict } from "../sync/xxyh/ops"
import { XxyhOp, XxyhState } from "../sync/xxyh/types"

export type Mirror = {
  records: Array<FuelRecord | ExpenseRecord | MaintenanceRecord>
  stations: Station[]
  categories: ExpenseCategory[]
  conflicts: OpConflict[]
  pendingIds: Set<string>
  cars: XxyhCarInfo[]
}

export type AppData = { ledger: LedgerFile; xxyh: XxyhState; mirror: Mirror }

export function computeMirror(ledger: LedgerFile, xxyh: XxyhState): Mirror {
  if (!xxyh.base) return { records: [], stations: [], categories: [], conflicts: [], pendingIds: new Set(), cars: [] }
  const applied = applyOps(xxyh.base, xxyh.ops)
  const vehicleOf = (car: string) => ledger.vehicles.find(v => v.xxyh_car === car)?.id ?? null
  const mapped = mapBackup(applied.doc, vehicleOf)
  const pendingIds = new Set<string>()
  for (const op of xxyh.ops) {
    if (op.type === "put_fuel") pendingIds.add(xxyhRecordId(op.car, "f", op.data.ts))
    if (op.type === "put_expense") pendingIds.add(xxyhRecordId(op.car, "e", op.data.ts))
  }
  return { ...mapped, conflicts: applied.conflicts, pendingIds, cars: carsOf(applied.doc) }
}

export function makeAppData(ledger: LedgerFile, xxyh: XxyhState): AppData {
  return { ledger, xxyh, mirror: computeMirror(ledger, xxyh) }
}

export function vehicleById(data: AppData, id: string | null): Vehicle | null {
  return data.ledger.vehicles.find(v => v.id === id) || null
}

export function currentVehicle(data: AppData): Vehicle | null {
  return vehicleById(data, data.ledger.settings.current_vehicle_id) || data.ledger.vehicles[0] || null
}

const isLinked = (data: AppData, v: Vehicle) => !!(v.xxyh_car && data.xxyh.base)

/** 一辆车的全部记录，按时间倒序 */
export function vehicleRecords(data: AppData, vehicle: Vehicle): LedgerRecord[] {
  const out: LedgerRecord[] = isLinked(data, vehicle)
    ? data.mirror.records.filter(r => r.vehicle_id === vehicle.id).map(r => ({ ...r, origin: "xxyh" as const, pending: data.mirror.pendingIds.has(r.id) }))
    : data.ledger.records.filter(r => r.vehicle_id === vehicle.id).map(r => ({ ...r, origin: "local" as const, pending: false }))
  return out.sort((a, b) => b.ts - a.ts)
}

export function fuelRecords(data: AppData, vehicle: Vehicle): FuelRecord[] {
  return vehicleRecords(data, vehicle).filter((r): r is FuelRecord & LedgerRecord => r.kind === "fuel")
}

export function stationsFor(data: AppData, vehicle: Vehicle | null): Station[] {
  return vehicle && isLinked(data, vehicle) ? data.mirror.stations : data.ledger.stations
}

export function categoriesFor(data: AppData): ExpenseCategory[] {
  return data.xxyh.base && data.mirror.categories.length ? data.mirror.categories : data.ledger.expense_categories
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

export function pendingCount(data: AppData): number {
  return data.xxyh.ops.length
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

export type Change = { ledger: LedgerFile; xxyh: XxyhState; linked: boolean }

function upsertLocalStation(ledger: LedgerFile, station: Station, ts: number): void {
  const s = ledger.stations.find(x => x.id === station.id)
  if (s) s.last_used_ts = Math.max(s.last_used_ts, ts)
  else ledger.stations.push({ ...station, last_used_ts: ts })
}

/** 保存加油记录。recordId 为 null 表示新增；newStation 是这次要新建的油站 */
export function putFuel(data: AppData, vehicle: Vehicle, recordId: string | null, fuel: FuelData, newStation: Station | null, now = Date.now()): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  if (isLinked(data, vehicle)) {
    const parsed = recordId ? parseXxyhRecordId(recordId) : null
    const op: XxyhOp = { type: "put_fuel", car: vehicle.xxyh_car!, key: parsed ? parsed.date : null, n: parsed?.n, data: fuel, station: newStation, at: now }
    xxyh.ops.push(op)
    return { ledger, xxyh, linked: true }
  }
  if (newStation) upsertLocalStation(ledger, newStation, fuel.ts)
  else if (fuel.station_id) {
    const s = ledger.stations.find(x => x.id === fuel.station_id)
    if (s) s.last_used_ts = Math.max(s.last_used_ts, fuel.ts)
  }
  const rec: FuelRecord = { ...fuel, kind: "fuel", id: recordId || newId("f"), vehicle_id: vehicle.id }
  ledger.records = recordId ? ledger.records.map(r => (r.id === recordId ? rec : r)) : [...ledger.records, rec]
  return { ledger, xxyh, linked: false }
}

export function putExpense(data: AppData, vehicle: Vehicle, recordId: string | null, expense: ExpenseData, now = Date.now()): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  if (isLinked(data, vehicle)) {
    const parsed = recordId ? parseXxyhRecordId(recordId) : null
    xxyh.ops.push({ type: "put_expense", car: vehicle.xxyh_car!, key: parsed ? parsed.date : null, n: parsed?.n, data: expense, at: now })
    return { ledger, xxyh, linked: true }
  }
  const rec: ExpenseRecord = { ...expense, kind: "expense", id: recordId || newId("e"), vehicle_id: vehicle.id }
  ledger.records = recordId ? ledger.records.map(r => (r.id === recordId ? rec : r)) : [...ledger.records, rec]
  return { ledger, xxyh, linked: false }
}

export function removeRecord(data: AppData, vehicle: Vehicle, record: LedgerRecord, now = Date.now()): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  if (record.origin === "xxyh") {
    const parsed = parseXxyhRecordId(record.id)
    if (!parsed || record.kind === "maintenance") throw new Error("这条记录不能删除")
    xxyh.ops.push({ type: record.kind === "fuel" ? "delete_fuel" : "delete_expense", car: vehicle.xxyh_car!, key: parsed.date, n: parsed.n, at: now })
    return { ledger, xxyh, linked: true }
  }
  ledger.records = ledger.records.filter(r => r.id !== record.id)
  return { ledger, xxyh, linked: false }
}

// ---------- 关联与断开 ----------

/** 连接小熊后：小熊里每辆还没关联的车新建一辆油记车辆 */
export function vehiclesForCars(ledger: LedgerFile, cars: XxyhCarInfo[], now = Date.now()): LedgerFile {
  const next: LedgerFile = JSON.parse(JSON.stringify(ledger))
  for (const car of cars) {
    if (next.vehicles.some(v => v.xxyh_car === car.uuid)) continue
    next.vehicles.push({ id: newId("v"), name: car.name, default_grade: null, created_ts: now, xxyh_car: car.uuid, provider: null })
  }
  if (!vehicleIdValid(next, next.settings.current_vehicle_id)) next.settings.current_vehicle_id = next.vehicles[0]?.id ?? null
  return next
}

const vehicleIdValid = (l: LedgerFile, id: string | null) => !!id && l.vehicles.some(v => v.id === id)

/**
 * 把本机车辆关联到小熊车辆：本机记录全部变成新增操作（云端已有相同时间的跳过），并移出本机文件。
 */
export function linkLocalVehicle(data: AppData, vehicleId: string, car: string, now = Date.now()): Change & { added: number; skipped: number } {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  const base = data.xxyh.base
  const rawCar = base?.cars.find(c => carKey(c) === car)
  if (!rawCar) throw new Error("云端没有这辆车")
  const v = ledger.vehicles.find(x => x.id === vehicleId)
  if (!v) throw new Error("找不到车辆")
  const taken = new Set([...(rawCar.fuelRecords || []).map(r => `f${r.date}`), ...(rawCar.expenseRecords || []).map(r => `e${r.date}`)])
  const cloudStations = new Set((base!.myStations?.stations || []).map(s => String(s.id)))
  let added = 0
  let skipped = 0
  for (const r of ledger.records.filter(x => x.vehicle_id === vehicleId).sort((a, b) => a.ts - b.ts)) {
    if (taken.has(`${r.kind === "fuel" ? "f" : "e"}${r.ts}`)) { skipped++; continue }
    if (r.kind === "fuel") {
      const fuel = toFuelData(r)
      const st = fuel.station_id && !cloudStations.has(fuel.station_id) ? ledger.stations.find(s => s.id === fuel.station_id) || null : null
      xxyh.ops.push({ type: "put_fuel", car, key: null, data: fuel, station: st, at: now })
    } else {
      xxyh.ops.push({ type: "put_expense", car, key: null, data: toExpenseData(r), at: now })
    }
    added++
  }
  ledger.records = ledger.records.filter(x => x.vehicle_id !== vehicleId)
  v.xxyh_car = car
  return { ledger, xxyh, linked: true, added, skipped }
}

/** 断开小熊：把当前显示的数据（含待上传修改）复制成本机数据。保养记录转成「维修保养」费用 */
export function materializeAll(data: AppData): LedgerFile {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const records: LocalRecord[] = []
  for (const r of data.mirror.records) {
    const v = ledger.vehicles.find(x => x.id === r.vehicle_id)
    if (!v || !v.xxyh_car) continue
    if (r.kind === "fuel") records.push({ ...r, id: newId("f") })
    else if (r.kind === "expense") records.push({ ...r, id: newId("e") })
    else records.push({
      kind: "expense", id: newId("e"), vehicle_id: r.vehicle_id, ts: r.ts, category_id: 100001, amount: r.amount,
      remark: [r.remark, r.items && `保养项目：${r.items}`, r.odometer && `里程：${r.odometer} 公里`].filter(Boolean).join("\n"),
    })
  }
  ledger.records.push(...records)
  for (const s of data.mirror.stations) if (!ledger.stations.some(x => x.id === s.id)) ledger.stations.push(s)
  for (const c of data.mirror.categories) if (!ledger.expense_categories.some(x => x.id === c.id)) ledger.expense_categories.push(c)
  for (const v of ledger.vehicles) v.xxyh_car = null
  return ledger
}
