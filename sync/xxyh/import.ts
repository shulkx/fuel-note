// 从小熊云备份导入（2.0 设计第 8 节，纯函数）：选中的车变成油记车辆，记录带上小熊的原样（xxyh_raw）、用油记自己的 id；
// 保养记录和同一时刻的那笔费用配成一对（expense_id），之后按 id 配对。连接小熊时的导入和现有数据的转换脚本（tools/migrate_v2_core.ts）共用。
import { MAINTENANCE_CATEGORY } from "../../common/expense_stats"
import { newId } from "../../common/ids"
import { ExpenseRecord, FuelRecord, LedgerFile, LocalRecord, MaintenanceRecord, Vehicle, XxyhRaw } from "../../common/types"
import { gradeOf } from "./catalog"
import { carKey, carProfile, carsOf, categoriesOf, expenseFromXxyh, fuelFromXxyh, isRefuel, maintenanceFromXxyh, stationFromXxyh, XxyhCarInfo } from "./mapping"
import { XxyhBackup, XxyhCar } from "./types"

/** 原样的深拷贝：导出时以它为底，只覆盖改过的字段 */
const rawOf = (r: object): XxyhRaw => JSON.parse(JSON.stringify(r))

export type IdMaker = (kind: "f" | "e" | "m") => string

/**
 * 一辆小熊车的记录 → 油记记录。顺序固定：加油（不含充电）、费用、保养，各按云端里的先后（转换脚本按这个顺序对应 1.x 的编号）。
 * 一条保养配同一时刻的一笔费用，同一时刻有几笔时优先「维修保养」类别的（和 1.x 的 maintenanceExpenses 相同）
 */
export function recordsFromCar(car: XxyhCar, vehicleId: string, makeId: IdMaker = k => newId(k)): LocalRecord[] {
  const fuel: FuelRecord[] = (car.fuelRecords || []).filter(isRefuel)
    .map(r => ({ ...fuelFromXxyh(r), kind: "fuel", id: makeId("f"), vehicle_id: vehicleId, xxyh_raw: rawOf(r) }))
  const expenses: ExpenseRecord[] = (car.expenseRecords || [])
    .map(r => ({ ...expenseFromXxyh(r), kind: "expense", id: makeId("e"), vehicle_id: vehicleId, xxyh_raw: rawOf(r) }))
  const taken = new Set<string>()
  const maintenance: MaintenanceRecord[] = (car.maintainRecords || []).map(r => {
    const m = maintenanceFromXxyh(r)
    const same = expenses.filter(e => e.ts === m.ts && !taken.has(e.id))
    const e = same.find(x => x.category_id === MAINTENANCE_CATEGORY) ?? same[0]
    if (e) taken.add(e.id)
    return { ...m, kind: "maintenance", id: makeId("m"), vehicle_id: vehicleId, ...(e ? { expense_id: e.id } : {}), xxyh_raw: rawOf(r) }
  })
  return [...fuel, ...expenses, ...maintenance]
}

/** 小熊的车 → 油记车辆：名称、默认标号（按车型的标号）、车型资料；导出时写回这辆车 */
export function vehicleFromCar(car: XxyhCar, now: number, id = newId("v")): Vehicle {
  const profile = carProfile(car)
  return { id, name: String(car.name || "车辆"), default_grade: gradeOf(profile.gas_type), created_ts: now, xxyh_car: carKey(car), provider: null, profile }
}

/** 小熊里的油站全部复制过来；已有同一个 id 的不动 */
export function mergeStations(ledger: LedgerFile, doc: XxyhBackup): void {
  const have = new Set(ledger.stations.map(s => s.id))
  for (const s of (doc.myStations?.stations || []).map(stationFromXxyh)) if (!have.has(s.id)) ledger.stations.push(s)
}

/** 费用类别以小熊的为准（sortId 顺序、小熊的名称），再接上只在本机的 */
export function mergeCategories(ledger: LedgerFile, doc: XxyhBackup): void {
  const cloud = categoriesOf(doc)
  if (!cloud.length) return
  const ids = new Set(cloud.map(c => c.id))
  ledger.expense_categories = [...cloud, ...ledger.expense_categories.filter(c => !ids.has(c.id))]
}

export type ImportResult = { ledger: LedgerFile; added: Array<{ name: string; records: number }> }

/**
 * 导入选中的几辆小熊车（已经导入过的跳过）：车辆和记录；油站、类别补齐；还没有当前车辆时用第一辆。
 * 门店不从备注里拆（新用户的备注照原样留着）
 */
export function importCars(ledger: LedgerFile, doc: XxyhBackup, uuids: string[], now: number): ImportResult {
  const next: LedgerFile = JSON.parse(JSON.stringify(ledger))
  const added: ImportResult["added"] = []
  for (const car of doc.cars || []) {
    const uuid = carKey(car)
    if (!uuids.includes(uuid) || next.vehicles.some(v => v.xxyh_car === uuid)) continue
    const v = vehicleFromCar(car, now)
    const records = recordsFromCar(car, v.id)
    next.vehicles.push(v)
    next.records.push(...records)
    added.push({ name: v.name, records: records.length })
  }
  if (added.length) {
    mergeStations(next, doc)
    mergeCategories(next, doc)
  }
  if (!next.vehicles.some(v => v.id === next.settings.current_vehicle_id && !v.hidden)) {
    next.settings.current_vehicle_id = next.vehicles.find(v => !v.hidden)?.id ?? null
  }
  return { ledger: next, added }
}

/** 小熊里还没导入的车（「设置 › 小熊油耗」里列出来，可以单独导入一辆） */
export function carsNotImported(ledger: LedgerFile, doc: XxyhBackup | null): XxyhCarInfo[] {
  return carsOf(doc).filter(c => !ledger.vehicles.some(v => v.xxyh_car === c.uuid))
}
