// 小熊云备份 ⇄ 油记记录（纯函数）
import { bd09ToWgs84, LngLat } from "../../common/geo"
import {
  ExpenseCategory, ExpenseData, ExpenseRecord, FuelData, FuelRecord, MaintenanceRecord, Station,
} from "../../common/types"
import { XxyhBackup, XxyhCar, XxyhExpense, XxyhFuel, XxyhMaintain, XxyhStation } from "./types"

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round3 = (n: number) => Math.round(n * 1000) / 1000

export const carKey = (car: XxyhCar): string => String(car.uuid)

export type RecordKind = "f" | "e" | "m"

/** 油记里小熊记录的 id：x:<车辆>:<类型>:<date>，同一时间的第二条起加 #n */
export function xxyhRecordId(car: string, kind: RecordKind, date: number, n = 1): string {
  return `x:${car}:${kind}:${date}${n > 1 ? `#${n}` : ""}`
}

export function parseXxyhRecordId(id: string): { car: string; kind: RecordKind; date: number; n: number } | null {
  const m = /^x:(.+):([fem]):(-?\d+)(?:#(\d+))?$/.exec(id)
  if (!m) return null
  return { car: m[1], kind: m[2] as RecordKind, date: Number(m[3]), n: m[4] ? Number(m[4]) : 1 }
}

export const isRefuel = (r: XxyhFuel) => Number(r.replenishType ?? 1) === 1

export function fuelFromXxyh(r: XxyhFuel): FuelData {
  const price = num(r.price)
  const yuan = num(r.yuan)
  const fueled = num(r.fueledLiter)
  // 旧记录只存了金额和单价（fueledLiter 为 0）
  const liters = fueled > 0 ? fueled : price > 0 ? yuan / price : 0
  const pay = num(r.payYuan)
  return {
    ts: num(r.date),
    odometer: num(r.odometer),
    liters: round3(liters),
    price,
    amount: yuan,
    paid: pay > 0 ? pay : yuan,
    grade: r.type == null ? null : num(r.type),
    full: !!r.gassup,
    light_on: !!r.lightOn,
    missed_before: !!r.forget,
    station_id: r.stationId ? String(r.stationId) : null,
    remark: String(r.remark ?? ""),
  }
}

export function expenseFromXxyh(r: XxyhExpense): ExpenseData {
  return { ts: num(r.date), category_id: r.type == null ? 100003 : num(r.type), amount: num(r.expense), remark: String(r.description ?? "") }
}

export function maintenanceFromXxyh(r: XxyhMaintain): Omit<MaintenanceRecord, "kind" | "id" | "vehicle_id"> {
  const items = [r.maintains, r.customMaintains]
    .map(s => String(s ?? ""))
    .join(",")
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
    .join("、")
  return { ts: num(r.dateTime), odometer: num(r.currentMileage), items, amount: num(r.spend), remark: String(r.message ?? "") }
}

export function stationFromXxyh(s: XxyhStation): Station {
  const p: LngLat = [num(s.longitudeE6) / 1e6, num(s.latitudeE6) / 1e6]
  // 没有坐标类型的是百度坐标
  const w = s.coordinate_type === "wgs84" ? p : bd09ToWgs84(p)
  return {
    id: String(s.id),
    name: String(s.name ?? ""),
    address: String(s.address ?? ""),
    province: String(s.province ?? ""),
    city: String(s.city ?? ""),
    district: String(s.area ?? ""),
    lng: w[0],
    lat: w[1],
    last_used_ts: num(s.timeStamp),
  }
}

/** 与小熊 App「自定义」新建油站相同的 id 算法 */
export function stationIdFor(lng: number, lat: number): string {
  const la = Math.round(lat * 1e6)
  const lo = Math.round(lng * 1e6)
  return String((BigInt(la + 90000000) << BigInt(30)) + BigInt(lo + 180000000))
}

export function newXxyhStation(st: Station, ts: number): XxyhStation {
  const la = Math.round(st.lat * 1e6)
  const lo = Math.round(st.lng * 1e6)
  return {
    longitudeE6: lo, address: st.address || "", phoneNum: "", src: "customized", timeStamp: ts,
    id: st.id, coordinate_type: "wgs84", isCustom: true,
    city: st.city || "", area: st.district || "", province: st.province || "", name: st.name, sType: 1, latitudeE6: la,
  }
}

/** 已有记录里 carId 是数字，与车辆 uuid（字符串）类型不同；沿用已有记录的写法 */
function carIdOf(car: XxyhCar): number | string {
  const known = [...(car.fuelRecords || []), ...(car.expenseRecords || [])].find(r => r.carId != null)
  if (known) return known.carId as number | string
  return /^\d+$/.test(String(car.uuid)) ? Number(car.uuid) : car.uuid
}

const nextWc = (list: Array<{ wc_id?: number }>) => list.reduce((m, r) => Math.max(m, num(r.wc_id)), 0) + 1

/** 新加油记录：与油猴脚本 v0.3.7 相同的格式（已在官方 App 和网页版验证） */
export function newXxyhFuel(car: XxyhCar, d: FuelData): XxyhFuel {
  return {
    distance: 0, remarkImages: [], carId: carIdOf(car), type: d.grade ?? 0, fCspt: 0, priceDiff: 0,
    lightOn: d.light_on, consumption: 0, odometer: d.odometer, eCapacity: 0, replenishType: 1, isCumulative: false,
    ePercentBeforeCharge: 0, fueledLiter: d.liters, yuan: d.amount, stationId: d.station_id || "", price: d.price, gassup: d.full,
    fPercentBeforeFuel: 0, eCspt: 0, chargedKwh: 0, fCapacity: 0, fPercentAfterFuel: d.full ? 1 : 0, forget: d.missed_before,
    payYuan: d.paid, wc_id: nextWc(car.fuelRecords || []), remark: d.remark, date: d.ts, ePercentAfterCharge: 0,
  }
}

export function newXxyhExpense(car: XxyhCar, d: ExpenseData): XxyhExpense {
  return {
    type: d.category_id, remarkImages: [], description: d.remark, carId: carIdOf(car),
    expense: d.amount, date: d.ts, wc_id: nextWc(car.expenseRecords || []),
  }
}

const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) < eps

/** 只写入值确实变化的字段，保留原记录的其他字段和写法 */
export function patchXxyhFuel(raw: XxyhFuel, d: FuelData): void {
  const cur = fuelFromXxyh(raw)
  if (cur.ts !== d.ts) raw.date = d.ts
  if (cur.odometer !== d.odometer) raw.odometer = d.odometer
  if (!near(cur.liters, d.liters)) raw.fueledLiter = d.liters
  if (!near(cur.price, d.price)) raw.price = d.price
  if (!near(cur.amount, d.amount)) raw.yuan = d.amount
  if (!near(cur.paid, d.paid)) raw.payYuan = d.paid
  if (cur.grade !== d.grade && d.grade != null) raw.type = d.grade
  if (cur.full !== d.full) { raw.gassup = d.full; raw.fPercentAfterFuel = d.full ? 1 : 0 }
  if (cur.light_on !== d.light_on) raw.lightOn = d.light_on
  if (cur.missed_before !== d.missed_before) raw.forget = d.missed_before
  if (cur.station_id !== d.station_id) raw.stationId = d.station_id || ""
  if (cur.remark !== d.remark) raw.remark = d.remark
}

export function patchXxyhExpense(raw: XxyhExpense, d: ExpenseData): void {
  const cur = expenseFromXxyh(raw)
  if (cur.ts !== d.ts) raw.date = d.ts
  if (cur.category_id !== d.category_id) raw.type = d.category_id
  if (!near(cur.amount, d.amount)) raw.expense = d.amount
  if (cur.remark !== d.remark) raw.description = d.remark
}

export type XxyhCarInfo = { uuid: string; name: string; fuel_count: number; expense_count: number }

export function carsOf(doc: XxyhBackup | null): XxyhCarInfo[] {
  return (doc?.cars || []).map(c => ({
    uuid: carKey(c),
    name: String(c.name || "车辆"),
    fuel_count: (c.fuelRecords || []).filter(isRefuel).length,
    expense_count: (c.expenseRecords || []).length,
  }))
}

export type MappedBackup = {
  records: Array<FuelRecord | ExpenseRecord | MaintenanceRecord>
  stations: Station[]
  categories: ExpenseCategory[]
}

/** 把备份映射成油记记录。vehicleOf 返回小熊车辆关联的油记车辆 id，没有关联的车辆跳过 */
export function mapBackup(doc: XxyhBackup, vehicleOf: (car: string) => string | null): MappedBackup {
  const records: MappedBackup["records"] = []
  for (const car of doc.cars || []) {
    const key = carKey(car)
    const vehicle_id = vehicleOf(key)
    if (!vehicle_id) continue
    const seen = new Map<string, number>()
    const idFor = (kind: RecordKind, date: number) => {
      const k = `${kind}${date}`
      const n = (seen.get(k) || 0) + 1
      seen.set(k, n)
      return xxyhRecordId(key, kind, date, n)
    }
    for (const r of car.fuelRecords || []) {
      if (!isRefuel(r)) continue
      const d = fuelFromXxyh(r)
      records.push({ ...d, kind: "fuel", id: idFor("f", d.ts), vehicle_id })
    }
    for (const r of car.expenseRecords || []) {
      const d = expenseFromXxyh(r)
      records.push({ ...d, kind: "expense", id: idFor("e", d.ts), vehicle_id })
    }
    for (const r of car.maintainRecords || []) {
      const d = maintenanceFromXxyh(r)
      records.push({ ...d, kind: "maintenance", id: idFor("m", d.ts), vehicle_id })
    }
  }
  const stations = (doc.myStations?.stations || []).map(stationFromXxyh)
  const categories = (doc.expenseTypes || []).map(t => ({ id: num(t._id), name: String(t.name || ""), description: String(t.description || "") }))
  return { records, stations, categories }
}
