// 账本的纯逻辑：合并本机数据与小熊映射、把修改变成本机写入或小熊操作、断开与关联
import { newId } from "./ids"
import {
  ExpenseCategory, ExpenseData, ExpenseRecord, FuelData, FuelRecord, InsuranceYear, LedgerFile, LedgerRecord, LocalRecord,
  MaintenanceRecord, Station, Vehicle, VehicleProfile,
} from "./types"
import { maintenanceExpenses } from "./expense_stats"
import { expenseFor, insuranceForRecord, INSURANCE_CATEGORY, yearTotal } from "./insurance"
import { carKey, carsOf, mapBackup, newCarUuid, parseXxyhRecordId, xxyhRecordId, XxyhCarInfo } from "../sync/xxyh/mapping"
import { applyOps, OpConflict } from "../sync/xxyh/ops"
import { gradeOf } from "../sync/xxyh/catalog"
import { XxyhBackup, XxyhOp, XxyhState } from "../sync/xxyh/types"

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

/** 删除一辆车会一起删掉的东西（2.0 设计第 4 节）：本机记录、保险年度（调用方删原件）、权益卡和它们的使用记录 */
export type VehicleDeletion = { ledger: LedgerFile; records: number; insurance: string[]; perks: number }

/** 删除一辆车，连同它的记录、保险年度、权益卡和使用记录；至少保留一辆没有隐藏的车，删的是当前车辆时切到另一辆 */
export function vehicleDeletion(ledger: LedgerFile, id: string): VehicleDeletion {
  let vehicles = ledger.vehicles.filter(x => x.id !== id)
  if (vehicles.length && vehicles.every(x => x.hidden)) vehicles = vehicles.map((x, i) => (i === 0 ? { ...x, hidden: false } : x))
  const records = ledger.records.filter(r => r.vehicle_id === id).length
  const insurance = (ledger.insurance ?? []).filter(y => y.vehicle_id === id).map(y => y.id)
  const perkIds = new Set((ledger.perks ?? []).filter(p => p.vehicle_id === id).map(p => p.id))
  const current = ledger.settings.current_vehicle_id
  const next: LedgerFile = {
    ...ledger, vehicles, records: ledger.records.filter(r => r.vehicle_id !== id),
    settings: { ...ledger.settings, current_vehicle_id: current !== id && vehicles.some(x => x.id === current) ? current : vehicles.find(x => !x.hidden)?.id ?? null },
    ...(ledger.insurance ? { insurance: ledger.insurance.filter(y => y.vehicle_id !== id) } : {}),
    ...(ledger.perks ? { perks: ledger.perks.filter(p => !perkIds.has(p.id)) } : {}),
    ...(ledger.perk_uses ? { perk_uses: ledger.perk_uses.filter(u => !perkIds.has(u.perk_id)) } : {}),
  }
  return { ledger: next, records, insurance, perks: perkIds.size }
}

const isLinked = (data: AppData, v: Vehicle) => !!(v.xxyh_car && data.xxyh.base)

/** 一辆车的全部记录，按时间倒序 */
export function vehicleRecords(data: AppData, vehicle: Vehicle): LedgerRecord[] {
  const out: LedgerRecord[] = isLinked(data, vehicle)
    ? data.mirror.records.filter(r => r.vehicle_id === vehicle.id).map(r => ({ ...r, origin: "xxyh" as const, pending: data.mirror.pendingIds.has(r.id) }))
    : data.ledger.records.filter(r => r.vehicle_id === vehicle.id).map(r => ({ ...r, origin: "local" as const, pending: false }))
  return out.sort((a, b) => b.ts - a.ts)
}

export function fuelRecords(data: AppData, vehicle: Vehicle): Array<FuelRecord & LedgerRecord> {
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

/**
 * 一次修改的结果。recordId：本机新建或修改的记录 id（小熊车辆的 id 随日期变化，保存后再找，为 null）；
 * removedInsurance：一起删掉的保险年度（用来删保单原件）
 */
export type Change = { ledger: LedgerFile; xxyh: XxyhState; linked: boolean; recordId?: string | null; removedInsurance?: string[] }

/** 不改记录的修改（只改本机的保险、权益等）：复制一份账本和小熊状态 */
export function unchanged(data: AppData): Change {
  return { ledger: JSON.parse(JSON.stringify(data.ledger)), xxyh: { ...data.xxyh, ops: data.xxyh.ops.slice() }, linked: false }
}

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
    return { ledger, xxyh, linked: true, recordId: null }
  }
  const rec: ExpenseRecord = { ...expense, kind: "expense", id: recordId || newId("e"), vehicle_id: vehicle.id }
  ledger.records = recordId ? ledger.records.map(r => (r.id === recordId ? rec : r)) : [...ledger.records, rec]
  return { ledger, xxyh, linked: false, recordId: rec.id }
}

/** 删除一条记录；删的是关联了保险的费用时，那一年的保险一起删除（设计文档 20.4 节） */
export function removeRecord(data: AppData, vehicle: Vehicle, record: LedgerRecord, now = Date.now()): Change {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  let linked = false
  if (record.origin === "xxyh") {
    const parsed = parseXxyhRecordId(record.id)
    if (!parsed || record.kind === "maintenance") throw new Error("这条记录不能删除")
    xxyh.ops.push({ type: record.kind === "fuel" ? "delete_fuel" : "delete_expense", car: vehicle.xxyh_car!, key: parsed.date, n: parsed.n, at: now })
    linked = true
  } else {
    ledger.records = ledger.records.filter(r => r.id !== record.id)
  }
  const year = record.kind === "expense" ? insuranceForRecord(ledger.insurance, record.id) : null
  if (year) ledger.insurance = (ledger.insurance ?? []).filter(y => y.id !== year.id)
  // 这笔费用上用的权益一起撤销，剩余恢复（使用记录按费用的时间对应，权益设计第 4 节）
  if (record.kind === "expense" && ledger.perk_uses?.length) {
    const ids = new Set((ledger.perks ?? []).filter(p => p.vehicle_id === vehicle.id).map(p => p.id))
    ledger.perk_uses = ledger.perk_uses.filter(u => !(u.expense_ts === record.ts && ids.has(u.perk_id)))
  }
  return { ledger, xxyh, linked, removedInsurance: year ? [year.id] : [] }
}

// ---------- 保险（设计文档 20.4 节） ----------

/** 用户自己没改过的备注（油记写的「2026 车险 · 中国平安」）：保存时换成新的 */
const GENERATED_REMARK = /^\d{4} 车险( · |$)/

/**
 * 保存一年的保险，并新记或更新对应的「保险和交通规费」费用。
 * amount 为 keep 时（补到已有的费用、保留原金额）金额和备注不动，只跟着付款日期改日期。
 * 小熊车辆新记的费用 id 要等保存后才知道，这时 expense_id 为 null，由 linkInsuranceExpenses 补上；改了日期的同理（id 随日期变）。
 */
export function putInsurance(data: AppData, vehicle: Vehicle, year: InsuranceYear, amount: "total" | "keep", now = Date.now()): Change & { year: InsuranceYear } {
  const existing = year.expense_id
    ? vehicleRecords(data, vehicle).find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.id === year.expense_id)
    : undefined
  let next: InsuranceYear = { ...year, vehicle_id: vehicle.id, expense_id: existing ? existing.id : null }
  let c: Change
  if (existing && amount === "keep") {
    c = existing.ts === next.paid_ts ? unchanged(data) : putExpense(data, vehicle, existing.id, { ...toExpenseData(existing), ts: next.paid_ts }, now)
  } else {
    const fresh = expenseFor(next)
    const exp: ExpenseData = existing
      ? { ...fresh, remark: GENERATED_REMARK.test(existing.remark) ? fresh.remark : existing.remark }
      : fresh
    const same = existing && existing.ts === exp.ts && existing.amount === exp.amount && existing.category_id === exp.category_id && existing.remark === exp.remark
    c = same ? unchanged(data) : putExpense(data, vehicle, existing ? existing.id : null, exp, now)
    if (!existing) next = { ...next, expense_id: c.recordId ?? null }
  }
  c.ledger.insurance = [...(c.ledger.insurance ?? []).filter(y => y.id !== next.id), next]
  return { ...c, year: next }
}

/**
 * 保存后核对每一年关联的费用：小熊车辆新记的费用、改了日期的费用（id 随日期变）按时间和类别找回，
 * 同一时刻有几笔时优先金额等于合计的（保留原金额的那一年金额不等于合计，也要找得回）；
 * 找不到的（在别处删了）清掉关联。没有变化时返回 null
 */
export function linkInsuranceExpenses(data: AppData): LedgerFile | null {
  const years = data.ledger.insurance ?? []
  let changed = false
  const next = years.map(y => {
    const v = vehicleById(data, y.vehicle_id)
    if (!v) return y
    const records = vehicleRecords(data, v)
    if (y.expense_id && records.some(r => r.id === y.expense_id)) return y
    const total = yearTotal(y)
    const taken = new Set(years.filter(o => o.id !== y.id).map(o => o.expense_id))
    const same = records.filter((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.category_id === INSURANCE_CATEGORY && r.ts === y.paid_ts && !taken.has(r.id))
    const hit = same.find(r => Math.abs(r.amount - total) < 0.005) ?? same[0]
    const id = hit ? hit.id : null
    if (id === y.expense_id) return y
    changed = true
    return { ...y, expense_id: id }
  })
  return changed ? { ...data.ledger, insurance: next } : null
}

/** 删除一年的保险；withExpense 时连对应的费用一起删除 */
export function removeInsurance(data: AppData, vehicle: Vehicle, id: string, withExpense: boolean, now = Date.now()): Change {
  const year = (data.ledger.insurance ?? []).find(y => y.id === id)
  if (!year) throw new Error("找不到这一年的保险")
  const record = withExpense && year.expense_id ? vehicleRecords(data, vehicle).find(r => r.id === year.expense_id) : undefined
  const c = record ? removeRecord(data, vehicle, record, now) : unchanged(data)
  c.ledger.insurance = (c.ledger.insurance ?? []).filter(y => y.id !== id)
  return { ...c, removedInsurance: [id] }
}

// ---------- 关联与断开 ----------

/** 小熊的车 → 油记车辆：名称，默认标号按车型的标号 */
export function vehicleForCar(car: XxyhCarInfo, now: number): Vehicle {
  return { id: newId("v"), name: car.name, default_grade: gradeOf(car.profile.gas_type), created_ts: now, xxyh_car: car.uuid, provider: null }
}

/**
 * 连接或拉取后：油记里还没有车辆时（第一次连接），小熊里的车全部加入；
 * 之后新出现的车不自动加入，由用户在「设置 › 小熊油耗」里添加或忽略（设计文档 17.8 节）
 */
export function vehiclesForCars(ledger: LedgerFile, cars: XxyhCarInfo[], now = Date.now()): LedgerFile {
  const next: LedgerFile = JSON.parse(JSON.stringify(ledger))
  if (!next.vehicles.length) {
    const ignored = new Set(next.xxyh_ignored_cars || [])
    for (const car of cars) if (!ignored.has(car.uuid)) next.vehicles.push(vehicleForCar(car, now))
  }
  if (!vehicleIdValid(next, next.settings.current_vehicle_id)) next.settings.current_vehicle_id = next.vehicles.find(v => !v.hidden)?.id ?? next.vehicles[0]?.id ?? null
  return next
}

/** 小熊里还没有加到油记、也没有被忽略的车 */
export function newCars(ledger: LedgerFile, cars: XxyhCarInfo[]): XxyhCarInfo[] {
  const ignored = new Set(ledger.xxyh_ignored_cars || [])
  return cars.filter(c => !ignored.has(c.uuid) && !ledger.vehicles.some(v => v.xxyh_car === c.uuid))
}

/** 把小熊里新出现的车加到油记 */
export function addCarVehicle(ledger: LedgerFile, car: XxyhCarInfo, now = Date.now()): LedgerFile {
  if (ledger.vehicles.some(v => v.xxyh_car === car.uuid)) return ledger
  const ignored = (ledger.xxyh_ignored_cars || []).filter(u => u !== car.uuid)
  return { ...ledger, vehicles: [...ledger.vehicles, vehicleForCar(car, now)], xxyh_ignored_cars: ignored }
}

/** 忽略或恢复小熊里的一辆车（忽略的车拉取时不再列为新车） */
export function setCarIgnored(ledger: LedgerFile, uuid: string, ignored: boolean): LedgerFile {
  const list = (ledger.xxyh_ignored_cars || []).filter(u => u !== uuid)
  return { ...ledger, xxyh_ignored_cars: ignored ? [...list, uuid] : list }
}

const vehicleIdValid = (l: LedgerFile, id: string | null) => !!id && l.vehicles.some(v => v.id === id)

/**
 * 本机车辆 → 小熊（设计文档 17.5 节）：在小熊新建一辆车（add_car），这辆车的全部本机记录变成新增操作，并移出本机文件。
 * 新车是空的，不需要判断重复；云端原有的车和记录都不动。不做合并。
 */
export function convertToXxyh(data: AppData, vehicleId: string, uuid: string, now = Date.now()): Change {
  const base = data.xxyh.base
  if (!base) throw new Error("没有连接小熊油耗")
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  const v = ledger.vehicles.find(x => x.id === vehicleId)
  if (!v) throw new Error("找不到车辆")
  if (v.xxyh_car) throw new Error("这辆车已经在小熊油耗")
  const xxyh: XxyhState = { ...data.xxyh, ops: data.xxyh.ops.slice() }
  xxyh.ops.push({ type: "add_car", car: uuid, name: v.name, profile: v.profile ?? EMPTY_PROFILE, at: now })
  const cloudStations = new Set((base.myStations?.stations || []).map(s => String(s.id)))
  for (const r of ledger.records.filter(x => x.vehicle_id === vehicleId).sort((a, b) => a.ts - b.ts)) {
    if (r.kind === "fuel") {
      const fuel = toFuelData(r)
      const st = fuel.station_id && !cloudStations.has(fuel.station_id) ? ledger.stations.find(s => s.id === fuel.station_id) || null : null
      xxyh.ops.push({ type: "put_fuel", car: uuid, key: null, data: fuel, station: st, at: now })
    } else {
      xxyh.ops.push({ type: "put_expense", car: uuid, key: null, data: toExpenseData(r), at: now })
    }
  }
  ledger.records = ledger.records.filter(x => x.vehicle_id !== vehicleId)
  v.xxyh_car = uuid
  delete v.profile // 以云端的车为准
  delete v.former_xxyh_car
  return { ledger, xxyh, linked: true }
}
/** 转为小熊车辆用的 uuid：云端删除后转为本机的车，云端还没有原来的 uuid 时用回它（真正的恢复）；否则新建一个 */
export function carUuidFor(v: Vehicle, taken: Set<string>, random?: () => number): string {
  if (v.former_xxyh_car && !taken.has(v.former_xxyh_car)) return v.former_xxyh_car
  return newCarUuid(taken, random)
}

/** 云端删除的车：上一个版本里有、最新版本里没有，而且油记里有车辆关联（还没上传的新车不在旧版本里，不算） */
export function deletedCars(oldBase: XxyhBackup | null, newBase: XxyhBackup | null, ledger: LedgerFile): string[] {
  if (!oldBase || !newBase) return []
  const now = new Set((newBase.cars || []).map(carKey))
  return (oldBase.cars || []).map(carKey).filter(u => !now.has(u) && ledger.vehicles.some(v => v.xxyh_car === u))
}

/**
 * 云端删除的车自动转为本机车辆（设计文档 17.12 节）：用删除前的数据（旧版本 + 待上传的修改）复制成本机记录，
 * 车型等资料带过来，记下原来的 uuid 以便恢复；这些车的待上传修改已经并进本机记录，从新状态里去掉。
 * old 是拉取前的数据，next 是拉取后的小熊状态
 */
export function convertDeletedCars(old: AppData, next: XxyhState): { ledger: LedgerFile; xxyh: XxyhState; converted: Array<{ name: string; records: number }> } {
  const gone = new Set(deletedCars(old.xxyh.base, next.base, old.ledger))
  if (!gone.size) return { ledger: old.ledger, xxyh: next, converted: [] }
  const ledger: LedgerFile = JSON.parse(JSON.stringify(old.ledger))
  const vehicles = ledger.vehicles.filter(v => v.xxyh_car && gone.has(v.xxyh_car))
  materialize(old, ledger, new Set(vehicles.map(v => v.id)))
  const converted = vehicles.map(v => {
    const uuid = v.xxyh_car!
    v.profile = old.mirror.cars.find(c => c.uuid === uuid)?.profile ?? null
    v.former_xxyh_car = uuid
    v.xxyh_car = null
    return { name: v.name, records: ledger.records.filter(r => r.vehicle_id === v.id).length }
  })
  return { ledger, xxyh: { ...next, ops: next.ops.filter(op => !gone.has(op.car)) }, converted }
}

/**
 * 同步要等网络，途中可能又改了数据：把同步的结果放到现在的数据上，不用开始那一刻的数据覆盖。
 * start 是开始同步时的数据，latest 是现在的数据，result 是同步后的小熊状态，pushed 是这次上传掉的修改（没上传时 null），
 * changed：拉到了新版本（处理云端删除的车、补上新车）。现在的数据里，上传掉的修改去掉，途中新加的保留。
 * 途中断开了小熊或换了账号时返回 null，丢掉这次结果
 */
export function rebaseSync(start: AppData, latest: AppData, result: XxyhState, pushed: XxyhOp[] | null, changed: boolean, now = Date.now()): { ledger: LedgerFile; xxyh: XxyhState } | null {
  if (!latest.xxyh.base || latest.xxyh.account_id !== start.xxyh.account_id) return null
  const done = new Set((pushed ?? []).map(op => JSON.stringify(op)))
  const next: XxyhState = { ...result, ops: latest.xxyh.ops.filter(op => !done.has(JSON.stringify(op))) }
  if (!changed) return { ledger: latest.ledger, xxyh: next }
  const del = convertDeletedCars(latest, next)
  return { ledger: vehiclesForCars(del.ledger, makeAppData(del.ledger, del.xxyh).mirror.cars, now), xxyh: del.xxyh }
}

/** 云端删除的提示（只有「知道了」，不放重新上传的按钮，避免误恢复有意删除的车） */
export function deletedCarsNotice(converted: Array<{ name: string; records: number }>): string | null {
  if (!converted.length) return null
  return converted.map(c => `「${c.name}」已从小熊云端删除，油记已把它转为本机车辆，${c.records} 条记录都在。`).join("\n")
    + "\n需要时可以在车辆页「转为小熊车辆」重新上传。"
}

export const EMPTY_PROFILE: VehicleProfile = {
  model: null, model_name: null, pinpai: null, chexi: null, vehicle_type: null, replenish_mode: null, gas_type: null, buy_date: null,
}

/** 显示的小熊记录（含待上传）→ 本机记录；保养转成「维修保养」费用 */
function materialize(data: AppData, ledger: LedgerFile, vehicleIds: Set<string>): void {
  const records: LocalRecord[] = []
  const mine = data.mirror.records.filter(r => vehicleIds.has(r.vehicle_id))
  // 有对应费用的保养（小熊同时写的那笔「维修保养」）不再转一笔，否则花费算两次（设计文档 21.4 节）
  const paired = maintenanceExpenses(mine)
  for (const r of mine) {
    if (r.kind === "fuel") records.push({ ...r, id: newId("f") })
    else if (r.kind === "expense") records.push({ ...r, id: newId("e") })
    else if (!paired.has(r.id)) records.push({
      kind: "expense", id: newId("e"), vehicle_id: r.vehicle_id, ts: r.ts, category_id: 100001, amount: r.amount,
      remark: [r.remark, r.items && `保养项目：${r.items}`, r.odometer && `里程：${r.odometer} 公里`].filter(Boolean).join("\n"),
    })
  }
  ledger.records.push(...records)
  const used = new Set(records.map(r => (r.kind === "fuel" ? r.station_id : null)).filter((x): x is string => !!x))
  for (const s of data.mirror.stations) if (used.has(s.id) && !ledger.stations.some(x => x.id === s.id)) ledger.stations.push(s)
  for (const c of data.mirror.categories) if (!ledger.expense_categories.some(x => x.id === c.id)) ledger.expense_categories.push(c)
}

/**
 * 小熊车辆 → 本机（设计文档 17.6 节）：这辆车显示的记录复制成本机记录，车型等资料复制到车辆上；云端不动。
 * 这辆车记入忽略列表，之后拉取不再列为新车。还有待上传的修改时先上传。
 */
export function convertToLocal(data: AppData, vehicleId: string): LedgerFile {
  const v0 = data.ledger.vehicles.find(x => x.id === vehicleId)
  if (!v0 || !v0.xxyh_car) throw new Error("这辆车不在小熊油耗")
  const uuid = v0.xxyh_car
  if (data.xxyh.ops.some(op => op.car === uuid)) throw new Error("这辆车还有没上传的修改，请先上传")
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  materialize(data, ledger, new Set([vehicleId]))
  const v = ledger.vehicles.find(x => x.id === vehicleId)!
  v.xxyh_car = null
  v.profile = data.mirror.cars.find(c => c.uuid === uuid)?.profile ?? null
  ledger.xxyh_ignored_cars = [...(ledger.xxyh_ignored_cars || []).filter(u => u !== uuid), uuid]
  return ledger
}

/** 断开小熊：把当前显示的数据（含待上传修改）复制成本机数据。没有对应费用的保养记录转成「维修保养」费用 */
export function materializeAll(data: AppData): LedgerFile {
  const ledger: LedgerFile = JSON.parse(JSON.stringify(data.ledger))
  materialize(data, ledger, new Set(ledger.vehicles.filter(v => v.xxyh_car).map(v => v.id)))
  for (const s of data.mirror.stations) if (!ledger.stations.some(x => x.id === s.id)) ledger.stations.push(s)
  for (const v of ledger.vehicles) v.xxyh_car = null
  return ledger
}
