// 小熊云备份 ⇄ 油记记录（纯函数）
import { bd09ToWgs84, LngLat } from "../../common/geo"
import { ExpenseCategory, ExpenseData, FuelData, MaintenanceRecord, Station, VehicleProfile } from "../../common/types"
import { XxyhBackup, XxyhCar, XxyhExpense, XxyhExpenseType, XxyhFuel, XxyhMaintain, XxyhStation } from "./types"

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}
const round3 = (n: number) => Math.round(n * 1000) / 1000

export const carKey = (car: XxyhCar): string => String(car.uuid)

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

/** 保养记录：maintains 和 customMaintains 按逗号切开、接在一起（拆不回两段，导出时没改过的照原样写回） */
export function maintenanceFromXxyh(r: XxyhMaintain): Pick<MaintenanceRecord, "ts" | "odometer" | "items" | "amount" | "remark"> {
  const items = [r.maintains, r.customMaintains]
    .map(s => String(s ?? ""))
    .join(",")
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
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

const ymd = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/**
 * 云端新建的车（设计文档 17.4 节）：字段取小熊 iOS App 建的车与网页版 addCar 的并集，两种客户端都认。
 * index 是原有车辆数（iOS 用 sortId，网页版用 sortKey）；selected 为 0，不改官方 App 的当前车辆
 */
export function newXxyhCar(uuid: string, name: string, p: VehicleProfile, index: number, at: number): XxyhCar {
  return {
    uuid,
    name,
    model: p.model ?? -1,
    vehicle_type: p.vehicle_type ?? 1,
    replenishMode: p.replenish_mode ?? 1,
    ...(p.gas_type ? { gasType: p.gas_type } : {}),
    ...(p.pinpai ? { pinpai: p.pinpai } : {}),
    ...(p.chexi ? { chexi: p.chexi } : {}),
    buyDate: p.buy_date ?? ymd(at),
    sortId: index,
    sortKey: index,
    selected: 0,
    avgConsumption: 0,
    odometerCorrection: 0,
    fuelRecords: [],
    expenseRecords: [],
    maintainRecords: [],
    incomeRecords: [],
    reminderRecords: [],
  }
}

/** 新车的 uuid：10 位数字字符串（与 iOS App 建的车相同），不与已有的重复 */
export function newCarUuid(taken: Set<string>, random: () => number = Math.random): string {
  for (;;) {
    const uuid = String(1 + Math.floor(random() * 9)) + Array.from({ length: 9 }, () => Math.floor(random() * 10)).join("")
    if (!taken.has(uuid)) return uuid
  }
}

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

/** 保养项目写回 maintains：每项后面跟一个逗号（小熊 App 的写法，「机油,机油滤清器,」） */
export const maintainsText = (items: string[]) => items.map(i => `${i},`).join("")

type MaintenanceData = Pick<MaintenanceRecord, "ts" | "odometer" | "items" | "amount" | "remark">

/** 只写入值确实变化的字段；项目改了时写进 maintains、清空 customMaintains（拼起来以后拆不回两段） */
export function patchXxyhMaintain(raw: XxyhMaintain, d: MaintenanceData): void {
  const cur = maintenanceFromXxyh(raw)
  if (cur.ts !== d.ts) raw.dateTime = d.ts
  if (cur.odometer !== d.odometer) raw.currentMileage = d.odometer
  if (cur.items.join("\n") !== d.items.join("\n")) { raw.maintains = maintainsText(d.items); raw.customMaintains = "" }
  if (!near(cur.amount, d.amount)) raw.spend = d.amount
  if (cur.remark !== d.remark) raw.message = d.remark
}

/** 新保养记录：字段和真实数据一致（2.1 设计第 11 节）；wc_id 由调用方给（这辆车保养记录的最大值 + 1），addTime 是导出时刻 */
export function newXxyhMaintain(car: XxyhCar, d: MaintenanceData, wc: number, at: number): XxyhMaintain {
  return {
    id: 0, wc_id: wc, carId: carIdOf(car), addTime: at, isCost: false, hasNotify: 0, remarkImages: [],
    dateTime: d.ts, currentMileage: d.odometer, maintains: maintainsText(d.items), customMaintains: "", spend: d.amount, message: d.remark,
  }
}

export type XxyhCarInfo = { uuid: string; name: string; fuel_count: number; expense_count: number; profile: VehicleProfile }

const posInt = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/**
 * 云端车辆的资料。iOS App 建的车有 buyDate、vehicle_type、replenishMode、model；
 * 网页版建的车还有 gasType、pinpai、chexi（设计文档 17.4 节）。model 为 -1 表示没选车型
 */
export function carProfile(c: XxyhCar): VehicleProfile {
  return {
    model: posInt(c.model),
    model_name: null,
    pinpai: posInt(c.pinpai),
    chexi: posInt(c.chexi),
    vehicle_type: posInt(c.vehicle_type),
    replenish_mode: posInt(c.replenishMode),
    gas_type: text(c.gasType),
    buy_date: typeof c.buyDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.buyDate) ? c.buyDate : null,
  }
}

export function carsOf(doc: XxyhBackup | null): XxyhCarInfo[] {
  return (doc?.cars || []).map(c => ({
    uuid: carKey(c),
    name: String(c.name || "车辆"),
    fuel_count: (c.fuelRecords || []).filter(isRefuel).length,
    expense_count: (c.expenseRecords || []).length,
    profile: carProfile(c),
  }))
}

/** 小熊的费用类别，按 sortId 排：记费用顶部的分段照这个顺序（设计文档 22.9 节）；没有 sortId 的排在后面，保持原来的先后 */
export function categoriesOf(doc: XxyhBackup): ExpenseCategory[] {
  const sortOf = (t: XxyhExpenseType) => (typeof t.sortId === "number" && Number.isFinite(t.sortId) ? t.sortId : Infinity)
  return (doc.expenseTypes || [])
    .map((t, i) => ({ t, i }))
    .sort((a, b) => sortOf(a.t) - sortOf(b.t) || a.i - b.i)
    .map(({ t }) => ({ id: num(t._id), name: String(t.name || ""), description: String(t.description || "") }))
}
