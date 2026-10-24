// 1.x 的备份 → 2.0（2.0 设计第 5 节，纯函数）。只在电脑上用（tools/migrate_v2.ts），不进发布包。
// 规则照 1.7 的数据格式写，以后不改。只换 id 和关联，备注原样不动（不从备注里拆门店：数据跟着功能走，不为旧数据写规则）。
import { BackupFile, makeBackup } from "../common/backup"
import { md5 } from "../common/hash"
import { ledgerProblems, normalizeLedger } from "../common/ledger_file"
import {
  ExpenseRecord, FuelRecord, InsuranceYear, LedgerFile, LocalRecord, Perk, PerkUse, Station, Store, Vehicle,
} from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhCar, XxyhState } from "../sync/xxyh/types"
import { carKey, carProfile, isRefuel } from "../sync/xxyh/mapping"
import { mergeCategories, mergeStations, recordsFromCar } from "../sync/xxyh/import"

// ---------- 1.x 的格式（只列出用到的字段） ----------

type V1Vehicle = Vehicle & { former_xxyh_car?: string }
type V1Use = Omit<PerkUse, "expense_id"> & { expense_ts: number | null }
type V1Ledger = {
  schema_version: 1
  vehicles: V1Vehicle[]
  records: Array<FuelRecord | ExpenseRecord>
  stations: Station[]
  expense_categories: LedgerFile["expense_categories"]
  settings: Record<string, unknown>
  insurance?: InsuranceYear[]
  stores?: Store[]
  perks?: Perk[]
  perk_uses?: V1Use[]
  [key: string]: unknown
}
type V1Xxyh = { schema_version: 1; account_id: string | null; nickname: string | null; base_version: number | null; base: XxyhBackup | null; ops: unknown[] }
export type V1Backup = { format: string; version: number; app_version: string; created_at: string; ledger: V1Ledger; xxyh: V1Xxyh }

export type MigrationReport = {
  vehicles: Array<{ name: string; fuel: number; expense: number; maintenance: number; paired: number }>
  insurance: Array<{ id: string; ok: boolean; detail: string }>
  uses: { total: number; matched: number; unmatched: string[] }
  problems: string[]
}

// ---------- 1.7 的编号 ----------

const fixedId = (prefix: string, seed: string) => `${prefix}_${md5(seed).slice(0, 12)}`

/** 1.x 给小熊记录编的 id：x:<车>:<f|e|m>:<时间>，同一时刻的第二条起加 #n（和 1.7 的 mapBackup 相同） */
function legacyIds(car: XxyhCar): string[] {
  const key = carKey(car)
  const seen = new Map<string, number>()
  const idFor = (kind: string, date: number) => {
    const k = `${kind}${date}`
    const n = (seen.get(k) || 0) + 1
    seen.set(k, n)
    return `x:${key}:${kind}:${date}${n > 1 ? `#${n}` : ""}`
  }
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return [
    ...(car.fuelRecords || []).filter(isRefuel).map(r => idFor("f", num(r.date))),
    ...(car.expenseRecords || []).map(r => idFor("e", num(r.date))),
    ...(car.maintainRecords || []).map(r => idFor("m", num(r.dateTime))),
  ]
}

const yearLabel = (y: InsuranceYear) => {
  const starts = y.policies.map(p => p.start_ts).filter(t => Number.isFinite(t))
  return starts.length ? `${new Date(Math.min(...starts) + 8 * 3600e3).getUTCFullYear()} 年的保险` : `保险 ${y.id}`
}

export function migrateV1(input: V1Backup, appVersion: string): { backup: BackupFile; report: MigrationReport } {
  if (input.format !== "fuelnote-backup" || input.version !== 1) throw new Error("不是 1.x 的油记备份")
  const v1 = input.ledger
  if (v1.schema_version !== 1) throw new Error("备份里的账本不是 1.x 的格式")
  const x = input.xxyh
  if (x.ops && x.ops.length) throw new Error(`备份里有 ${x.ops.length} 条没上传的修改，请先在油记里「立即同步」再备份`)
  const base = x.base
  const report: MigrationReport = { vehicles: [], insurance: [], uses: { total: 0, matched: 0, unmatched: [] }, problems: [] }

  const ledger = normalizeLedger({
    ...v1,
    schema_version: 2,
    vehicles: v1.vehicles.map(v => {
      const { former_xxyh_car: _gone, ...rest } = v
      return rest
    }),
    records: v1.records.map(r => ({ ...r })),
    stations: v1.stations.map(s => ({ ...s })),
    insurance: (v1.insurance ?? []).map(y => ({ ...y })),
    stores: (v1.stores ?? []).map(s => ({ ...s })),
    perks: (v1.perks ?? []).map(p => ({ ...p })),
    perk_uses: [],
  })
  delete (ledger as unknown as Record<string, unknown>).xxyh_ignored_cars

  // 小熊车辆：云端记录变成本机记录，记下 1.x 编号到新 id 的对应
  const idMap = new Map<string, string>()
  for (const v of ledger.vehicles) {
    if (!v.xxyh_car) continue
    const car = base?.cars.find(c => carKey(c) === v.xxyh_car)
    if (!car) {
      report.problems.push(`「${v.name}」在小熊里找不到对应的车，没有记录可转`)
      continue
    }
    const counters = { f: 0, e: 0, m: 0 }
    const records = recordsFromCar(car, v.id, k => fixedId(k, `${v.xxyh_car}:${k}:${counters[k]++}`))
    legacyIds(car).forEach((old, i) => idMap.set(old, records[i].id))
    ledger.records.push(...records)
    if (!v.profile) v.profile = carProfile(car)
    report.vehicles.push({
      name: v.name,
      fuel: records.filter(r => r.kind === "fuel").length,
      expense: records.filter(r => r.kind === "expense").length,
      maintenance: records.filter(r => r.kind === "maintenance").length,
      paired: records.filter(r => r.kind === "maintenance" && r.expense_id).length,
    })
  }
  if (base) {
    mergeStations(ledger, base)
    mergeCategories(ledger, base)
  }
  const expenses = ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense")
  const byId = new Map(expenses.map(e => [e.id, e]))

  // 保险：1.x 的费用编号换成新 id
  for (const y of ledger.insurance) {
    if (!y.expense_id) {
      report.insurance.push({ id: y.id, ok: false, detail: `${yearLabel(y)}没有对应的费用` })
      continue
    }
    const id = y.expense_id.startsWith("x:") ? idMap.get(y.expense_id) ?? null : y.expense_id
    const e = id ? byId.get(id) : undefined
    if (!e) {
      report.insurance.push({ id: y.id, ok: false, detail: `${yearLabel(y)}对应的费用找不到` })
      y.expense_id = null
      continue
    }
    y.expense_id = e.id
    report.insurance.push({ id: y.id, ok: e.category_id === 100002, detail: e.category_id === 100002 ? yearLabel(y) : `${yearLabel(y)}对应的费用不是「保险和交通规费」` })
  }

  // 权益使用：按费用的时间找那一笔
  const perkVehicle = new Map(ledger.perks.map(p => [p.id, p.vehicle_id]))
  for (const u of v1.perk_uses ?? []) {
    report.uses.total++
    const { expense_ts, ...rest } = u
    let expense_id: string | null = null
    if (expense_ts != null) {
      const hits = expenses.filter(e => e.ts === expense_ts && e.vehicle_id === perkVehicle.get(u.perk_id))
      if (hits.length === 1) {
        expense_id = hits[0].id
        report.uses.matched++
      } else report.uses.unmatched.push(`使用记录 ${u.id}：对上 ${hits.length} 笔费用`)
    } else report.uses.matched++
    ledger.perk_uses.push({ ...rest, expense_id })
  }

  report.problems.push(...ledgerProblems(ledger))
  const xxyh: XxyhState = { ...emptyXxyhState(), account_id: x.account_id, nickname: x.nickname, last_version: x.base_version }
  const now = Date.parse(input.created_at)
  const backup = makeBackup(ledger, xxyh, base, appVersion, Number.isFinite(now) ? now : 0, null)
  return { backup, report }
}

/** 转换前后的条数：每辆车每种记录（2.0 设计第 5 节第 3 步） */
export function recordCounts(records: LocalRecord[]): Record<string, { fuel: number; expense: number; maintenance: number }> {
  const out: Record<string, { fuel: number; expense: number; maintenance: number }> = {}
  for (const r of records) {
    const c = out[r.vehicle_id] ?? (out[r.vehicle_id] = { fuel: 0, expense: 0, maintenance: 0 })
    c[r.kind]++
  }
  return out
}
