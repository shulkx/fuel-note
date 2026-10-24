// 1.x 的备份 → 2.0（2.0 设计第 5 节，纯函数）。只在电脑上用（tools/migrate_v2.ts），不进发布包。
// 规则照 1.7 的数据格式写，以后不改：下面几个「1.7 的写法」是从当时的 perks.ts、stores.ts 原样留下来的。
import { BackupFile, makeBackup } from "../common/backup"
import { md5 } from "../common/hash"
import { ledgerProblems, normalizeLedger } from "../common/ledger_file"
import {
  ExpenseRecord, FuelRecord, InsuranceYear, LedgerFile, LocalRecord, Perk, PerkUse, Station, Store, Vehicle,
} from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhCar, XxyhState } from "../sync/xxyh/types"
import { carKey, carProfile, isRefuel } from "../sync/xxyh/mapping"
import { mergeCategories, mergeStations, recordsFromCar } from "../sync/xxyh/import"
import { grouped } from "../common/format"

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

/**
 * 白名单：认不准的备注最后一行里，用户确认是店名的（split），要并成同一家的（rename：原名 → 用的名字），
 * 以及新建门店时填上的资料（details：用的名字 → 全称、地址、电话）
 */
export type StoreDetails = { full_name?: string; address?: string; phone?: string }
export type StoreList = { split: string[]; rename: Record<string, string>; details?: Record<string, StoreDetails> }

export type MigrationReport = {
  vehicles: Array<{ name: string; fuel: number; expense: number; maintenance: number; paired: number }>
  insurance: Array<{ id: string; ok: boolean; detail: string }>
  uses: { total: number; matched: number; unmatched: string[] }
  /** 拆出的门店：店名和笔数 */
  stores: Array<{ name: string; count: number }>
  /** 像店名、没有拆的最后一行：店名、笔数、例子（费用的时间） */
  pending: Array<{ name: string; count: number; ts: number[] }>
  problems: string[]
}

// ---------- 1.7 的写法 ----------

const normalizeName = (name: string) => name.replace(/\s+/g, "").replace(/（/g, "(").replace(/）/g, ")").toLowerCase()
const lastPart = (line: string) => line.split(" · ").pop()!.trim()
const USAGE_PART = /抵扣 ¥[\d,]+(\.\d+)?$|\s\d+(\.\d+)?\s?(次|面|张|瓶)$/

function looksLikeStore(s: string): boolean {
  return !!s && s.length <= 24 && !/[：:]/.test(s) && !/抵扣|¥|\d+\s*(次|面|张|瓶)$/.test(s) && !/^\d/.test(s)
}

/** 多行备注的最后一行（最后一个「 · 」后面）像店名时返回它 */
function remarkStore(remark: string): string | null {
  const lines = remark.split("\n").map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return null
  const s = lastPart(lines[lines.length - 1])
  return looksLikeStore(s) ? s : null
}

/** 1.7 写进备注的用量：「维修保养券抵扣 ¥1,000.00」「基础保养 1 次」 */
function useText(p: Perk, u: { used: number; deduct: number }): string {
  return u.deduct > 0 ? `${p.name}抵扣 ¥${grouped(u.deduct)}` : `${p.name} ${u.used} ${p.unit}`
}

// ---------- 转换 ----------

/** 固定的 id（同一份备份重复转换结果相同）：前缀 + 种子的 md5 */
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

export function migrateV1(input: V1Backup, list: StoreList, appVersion: string): { backup: BackupFile; report: MigrationReport } {
  if (input.format !== "fuelnote-backup" || input.version !== 1) throw new Error("不是 1.x 的油记备份")
  const v1 = input.ledger
  if (v1.schema_version !== 1) throw new Error("备份里的账本不是 1.x 的格式")
  const x = input.xxyh
  if (x.ops && x.ops.length) throw new Error(`备份里有 ${x.ops.length} 条没上传的修改，请先在油记里「立即同步」再备份`)
  const base = x.base
  const report: MigrationReport = { vehicles: [], insurance: [], uses: { total: 0, matched: 0, unmatched: [] }, stores: [], pending: [], problems: [] }

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

  // 门店：只拆有把握的（2.0 设计第 5 节第 2 步）
  const knownNames = new Map<string, string>()
  for (const s of ledger.stores) knownNames.set(normalizeName(s.name), s.name)
  for (const p of ledger.perks) if (p.store.trim()) knownNames.set(normalizeName(p.store), p.store.trim())
  const listed = new Map(list.split.map(n => [normalizeName(n), n]))
  const insured = new Set(ledger.insurance.map(y => y.expense_id).filter(Boolean))
  const storeIdOf = (name: string): string => {
    const shown = list.rename[name] ?? name
    let s = ledger.stores.find(x => normalizeName(x.name) === normalizeName(shown))
    if (!s) {
      const d = list.details?.[shown] ?? {}
      s = {
        id: fixedId("s", normalizeName(shown)), name: shown, full_name: d.full_name ?? "", address: d.address ?? "", phone: d.phone ?? "", lng: null, lat: null, source: "remark",
      }
      ledger.stores.push(s)
    }
    return s.id
  }
  const split = new Map<string, number>()
  const pending = new Map<string, { count: number; ts: number[] }>()
  for (const e of expenses) {
    if (insured.has(e.id)) continue
    const lines = e.remark.split("\n")
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    if (lines.length === 0) continue
    const last = lines[lines.length - 1].trim()
    const uses = ledger.perk_uses.filter(u => u.expense_id === e.id)
    const usage = uses.map(u => {
      const p = ledger.perks.find(x => x.id === u.perk_id)
      return p ? useText(p, u) : ""
    }).filter(Boolean).join(" · ")
    let store: string | null = null
    let ours = false
    if (usage && (last === usage || last.startsWith(`${usage} · `))) {
      ours = true
      store = last === usage ? null : last.slice(usage.length + 3).trim()
    } else {
      const name = normalizeName(lastPart(last))
      const parts = last.split(" · ")
      const usagePrefix = parts.length >= 2 && parts.slice(0, -1).every(p => USAGE_PART.test(p.trim()))
      const known = knownNames.get(name) ?? listed.get(name) ?? null
      if (known && (normalizeName(last) === name || usagePrefix)) {
        ours = true
        store = known
      }
    }
    if (ours) {
      e.remark = lines.slice(0, -1).join("\n").trim()
      if (store) {
        e.store_id = storeIdOf(store)
        const shown = list.rename[store] ?? store
        split.set(shown, (split.get(shown) || 0) + 1)
      }
      continue
    }
    const guess = remarkStore(e.remark)
    if (guess) {
      const p = pending.get(guess) ?? { count: 0, ts: [] }
      p.count++
      p.ts.push(e.ts)
      pending.set(guess, p)
    }
  }
  report.stores = [...split].map(([name, count]) => ({ name, count }))
  report.pending = [...pending].map(([name, p]) => ({ name, ...p }))

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
