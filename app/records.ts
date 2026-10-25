// 车辆、记录、保险、权益的写入：纯逻辑在 common/ledger.ts、common/perk_ledger.ts，这里保存文件、删保单原件
import { newId } from "../common/ids"
import { AppData, putExpense, putFuel, putInsurance, removeInsurance, removeRecord, setHidden, vehicleDeletion } from "../common/ledger"
import {
  addPerks, BatchFields, ExpenseExtras, putExpenseWithPerks, putPerk, putStore, putUse, PurchaseExpense, removePerks, removeStore, removeUse, updateBatch,
} from "../common/perk_ledger"
import { yearFiles } from "../common/insurance"
import { MaintenanceInput, putMaintenance } from "../common/maintenance"
import { ExpenseData, FuelData, InsuranceYear, LedgerRecord, Perk, PerkUse, ProviderLink, Station, Store, Vehicle, VehicleProfile } from "../common/types"
import { removePolicyFile } from "../platform/storage"
import { commit, dropPolicyFiles } from "./store"

// ---------- 车辆 ----------

export type NewVehicle = { name: string; grade: number | null; profile: VehicleProfile | null; provider: ProviderLink | null }

/** 添加车辆并切换到它（设计文档 17.4 节）。关联车辆数据时，原来关联这辆远端车的车辆解除关联 */
export function addVehicle(data: AppData, input: NewVehicle): AppData {
  const v: Vehicle = {
    id: newId("v"), name: input.name.trim() || "我的车", default_grade: input.grade, created_ts: Date.now(), xxyh_car: null, provider: input.provider,
    ...(input.profile ? { profile: input.profile } : {}),
  }
  const others = input.provider
    ? data.ledger.vehicles.map(x => (x.provider && x.provider.id === input.provider!.id && x.provider.vehicle_id === input.provider!.vehicle_id ? { ...x, provider: null } : x))
    : data.ledger.vehicles
  return commit(data, { ...data.ledger, vehicles: [...others, v], settings: { ...data.ledger.settings, current_vehicle_id: v.id } })
}

export function setVehicleHidden(data: AppData, id: string, hidden: boolean): AppData {
  return commit(data, setHidden(data.ledger, id, hidden))
}

/** 车辆资料（添加时填的，或从小熊导入时复制的） */
export function vehicleProfile(_data: AppData, v: Vehicle): VehicleProfile | null {
  return v.profile ?? null
}

export function updateVehicle(data: AppData, v: Vehicle): AppData {
  return commit(data, { ...data.ledger, vehicles: data.ledger.vehicles.map(x => (x.id === v.id ? v : x)) })
}

/** 删除前给确认框看的条数（同 vehicleDeletion） */
export function vehicleDeletionCounts(data: AppData, id: string): { records: number; insurance: number; perks: number } {
  const d = vehicleDeletion(data.ledger, id)
  return { records: d.records, insurance: d.insurance.length, perks: d.perks }
}

/** 删除车辆，连同记录、保险年度和原件、权益卡和使用记录（2.0 设计第 4 节） */
export function deleteVehicle(data: AppData, id: string): AppData {
  if (!data.ledger.vehicles.some(x => x.id === id)) return data
  const d = vehicleDeletion(data.ledger, id)
  const next = commit(data, d.ledger)
  dropPolicyFiles(d.insurance)
  return next
}

// ---------- 记录 ----------

export function saveFuel(data: AppData, vehicle: Vehicle, recordId: string | null, fuel: FuelData, newStation: Station | null): AppData {
  return commit(data, putFuel(data, vehicle, recordId, fuel, newStation).ledger)
}

/**
 * 保存费用。extras：记费用表单里选的门店和用的权益（1.7）：expense 的金额是实付，备注是用户写的内容。
 * maintenance：表单里「保养」一组（2.1）——维修保养、填了项目时存它的保养记录，null 时删掉；不传时不动保养记录
 */
export function saveExpense(data: AppData, vehicle: Vehicle, recordId: string | null, expense: ExpenseData, extras: ExpenseExtras | null = null,
  maintenance?: MaintenanceInput | null): AppData {
  const c = extras ? putExpenseWithPerks(data, vehicle, recordId, expense, extras) : putExpense(data, vehicle, recordId, expense)
  return commit(data, maintenance === undefined ? c.ledger : putMaintenance(c.ledger, c.recordId!, maintenance))
}

export function deleteRecord(data: AppData, record: LedgerRecord): AppData {
  const c = removeRecord(data, record)
  const next = commit(data, c.ledger)
  dropPolicyFiles(c.removedInsurance)
  return next
}

// ---------- 保险（设计文档第 20 节） ----------

/**
 * 保存一年的保险，费用跟着新记或修改（amount 为 keep 时只关联、不改已有费用的金额）。
 * 编辑时换掉或去掉的保单原件和附件一并删除。返回保存后的那一年
 */
export function saveInsurance(data: AppData, vehicle: Vehicle, year: InsuranceYear, amount: "total" | "keep"): { data: AppData; year: InsuranceYear } {
  const before = data.ledger.insurance.find(y => y.id === year.id)
  const c = putInsurance(data, vehicle, year, amount)
  const next = commit(data, c.ledger)
  if (before) {
    const keep = new Set(yearFiles(year))
    for (const f of yearFiles(before)) if (!keep.has(f)) removePolicyFile(f)
  }
  return { data: next, year: c.year }
}

/** 删除一年的保险和它的原件；withExpense 时连对应的费用一起删除 */
export function deleteInsurance(data: AppData, id: string, withExpense: boolean): AppData {
  const c = removeInsurance(data, id, withExpense)
  const next = commit(data, c.ledger)
  dropPolicyFiles(c.removedInsurance)
  return next
}

// ---------- 权益（权益设计 docs/specs/2026-10-23-benefits-wallet.md，1.7） ----------

/** 添加一批卡；purchase 时另记一笔维修保养费用（套餐的买价，只记这一次） */
export function savePerks(data: AppData, vehicle: Vehicle, perks: Perk[], purchase: PurchaseExpense | null): AppData {
  return commit(data, addPerks(data, vehicle, perks, purchase).ledger)
}

/** 修改一张卡（也可以新加一张）；不合规时抛错 */
export function savePerk(data: AppData, vehicle: Vehicle, perk: Perk): AppData {
  return commit(data, putPerk(data, vehicle, perk).ledger)
}

/** 改一批：写进这一批的每一张卡 */
export function saveBatch(data: AppData, vehicle: Vehicle, key: string, fields: BatchFields): AppData {
  return commit(data, updateBatch(data, vehicle, key, fields).ledger)
}

/** 删除几张卡和它们的使用记录；记过的费用不动 */
export function deletePerks(data: AppData, vehicle: Vehicle, ids: string[]): AppData {
  return commit(data, removePerks(data, vehicle, ids).ledger)
}

/** 记一次使用（没有费用）或修改 */
export function saveUse(data: AppData, use: PerkUse): AppData {
  return commit(data, putUse(data, use).ledger)
}

/** 删除一次使用（记一次使用的，或那笔费用已经不在的） */
export function deleteUse(data: AppData, id: string): AppData {
  return commit(data, removeUse(data, id).ledger)
}

/** 新建或修改我的门店；返回保存后的那一家 */
export function saveStore(data: AppData, store: Store): { data: AppData; store: Store } {
  const c = putStore(data, store)
  return { data: commit(data, c.ledger), store: c.store }
}

export function deleteStore(data: AppData, id: string): AppData {
  return commit(data, removeStore(data, id).ledger)
}
