// 导出到小熊（2.0 设计第 7 节，纯函数）：在云端最新版本上，把选了「导出到小熊的车」的车辆的加油、费用、保养换成油记的记录。
// 有 xxyh_raw 的以原样为底，只覆盖改过的字段（小熊的编号、备注图片、油记不认识的字段都留着）；没有的照小熊 App 的写法新建。
// 云端其他内容（其他车、充电、收入、提醒、车辆和顶层的其他字段）原样保留；油站补上油记有、云端没有的。
// 生成后用 validateExport 逐项检查，有问题就不上传。下载、上传和存快照在 app/xxyh_io.ts。
import { expenseUses, perkBook, PerkBook, usageLine } from "../../common/perks"
import { ExpenseRecord, FuelRecord, LedgerFile, LocalRecord, MaintenanceRecord, Vehicle, VehicleProfile, XxyhRaw } from "../../common/types"
import {
  carKey, expenseFromXxyh, fuelFromXxyh, isRefuel, maintainsText, maintenanceFromXxyh, newXxyhCar, newXxyhExpense, newXxyhFuel, newXxyhMaintain,
  newXxyhStation, patchXxyhExpense, patchXxyhFuel, patchXxyhMaintain,
} from "./mapping"
import { XxyhBackup, XxyhCar, XxyhExpense, XxyhFuel, XxyhMaintain } from "./types"

export type ExportKind = "fuel" | "expense" | "maintenance"
export const EXPORT_KINDS: ExportKind[] = ["fuel", "expense", "maintenance"]
const FIELD: Record<ExportKind, "fuelRecords" | "expenseRecords" | "maintainRecords"> = { fuel: "fuelRecords", expense: "expenseRecords", maintenance: "maintainRecords" }

type Row = Record<string, unknown>

/** 预览里的一条：标题（加油、费用类别、保养）、说明（备注第一行、项目、升数）、金额 */
export type ExportItem = { kind: ExportKind; ts: number; title: string; detail: string; amount: number }

export type KindChange = { count: number; added: ExportItem[]; modified: ExportItem[]; deleted: ExportItem[] }

export type CarExport = {
  vehicle_id: string
  vehicle_name: string
  uuid: string
  car_name: string
  /** 小熊里没有这辆车：在末尾新建 */
  created: boolean
  /** 换了导出目标：小熊这辆车原有的记录一条也对不上，导出会替换掉的条数（0 不提示） */
  replaces: number
  changes: Record<ExportKind, KindChange>
}

/** 小熊里在上次导入或导出之后的改动（导出会覆盖）：小熊里新记的、改过的（ours 是油记的那条）、删掉的（油记还有，导出后恢复） */
export type CloudEdit = { change: "added" | "modified" | "deleted"; item: ExportItem; ours: ExportItem | null }

export type ExportPlan = {
  doc: XxyhBackup
  cars: CarExport[]
  stations: { total: number; added: number }
  categories: number
  problems: string[]
  /** 云端版本不是上次的版本时：from → to，items 是能认出的改动（没有上次的快照时为 null）；版本相同时整个为 null */
  cloud_changed: { from: number | null; to: number; items: CloudEdit[] | null } | null
  /** 每条导出的记录写进云端的样子：上传成功后存回记录的 xxyh_raw，下次导出以它为底 */
  raws: Record<string, XxyhRaw>
}

export type ExportOptions = {
  now: number
  /** 云端的版本、上次导入或导出的版本和那时的快照：用来认出小熊里在这之后的改动 */
  cloudVersion?: number
  lastVersion?: number | null
  lastSnapshot?: XxyhBackup | null
}

// Scripting 把 .ts 也按 TSX 转译：泛型只用函数声明
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

/** 比较用的 JSON：键排好序（小熊服务端可能换了键的顺序），值为 undefined 的键不算 */
export function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`
  if (v && typeof v === "object") {
    const o = v as Row
    return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`
  }
  return JSON.stringify(v) ?? "null"
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)
const wcOf = (r: Row) => (r.wc_id == null ? null : String(r.wc_id))
const firstLine = (s: string) => s.split("\n").map(x => x.trim()).find(Boolean) ?? ""
const fuelDetail = (liters: number, odometer: number) => `${liters.toFixed(2)} L · ${Math.round(odometer).toLocaleString("en-US")} km`

const EMPTY_PROFILE: VehicleProfile = {
  model: null, model_name: null, pinpai: null, chexi: null, vehicle_type: null, replenish_mode: null, gas_type: null, buy_date: null,
}

type Ctx = { ledger: LedgerFile; book: PerkBook; categoryName: (id: number) => string; maintOf: Map<string, MaintenanceRecord> }

function itemOfCloud(kind: ExportKind, r: Row, ctx: Ctx): ExportItem {
  if (kind === "fuel") {
    const f = fuelFromXxyh(r as XxyhFuel)
    return { kind, ts: f.ts, title: "加油", detail: fuelDetail(f.liters, f.odometer), amount: f.paid }
  }
  if (kind === "expense") {
    const e = expenseFromXxyh(r as XxyhExpense)
    return { kind, ts: e.ts, title: ctx.categoryName(e.category_id), detail: firstLine(e.remark), amount: e.amount }
  }
  const m = maintenanceFromXxyh(r as XxyhMaintain)
  return { kind, ts: m.ts, title: "保养", detail: m.items.join("、"), amount: m.amount }
}

function itemOfRecord(r: LocalRecord, ctx: Ctx): ExportItem {
  if (r.kind === "fuel") return { kind: "fuel", ts: r.ts, title: "加油", detail: fuelDetail(r.liters, r.odometer), amount: r.paid }
  if (r.kind === "expense") return { kind: "expense", ts: r.ts, title: ctx.categoryName(r.category_id), detail: firstLine(r.remark), amount: r.amount }
  return { kind: "maintenance", ts: r.ts, title: "保养", detail: r.items.join("、"), amount: r.amount }
}

/**
 * 费用写进小熊的备注：用户写的备注；新记的保养那笔费用照小熊 App 加上「保养里程」「保养项目」两行；
 * 最后一行是用了的权益和门店（设计第 4 节），都没有时不加
 */
function exportRemark(e: ExpenseRecord, ctx: Ctx): string {
  let text = e.remark
  const m = ctx.maintOf.get(e.id)
  if (m && !m.xxyh_raw && !e.xxyh_raw) text = `${text ? `${text}\n` : ""}保养里程：${m.odometer}公里\n保养项目：${maintainsText(m.items)}\n`
  const store = e.store_id ? ctx.ledger.stores.find(s => s.id === e.store_id)?.name ?? null : null
  const line = usageLine(ctx.book.perks, expenseUses(ctx.book, e.vehicle_id, e.id), store)
  if (!line) return text
  const body = text.replace(/\s+$/, "")
  return body ? `${body}\n${line}` : line
}

function patch(base: Row, r: LocalRecord, ctx: Ctx): void {
  if (r.kind === "fuel") patchXxyhFuel(base as XxyhFuel, r)
  else if (r.kind === "expense") patchXxyhExpense(base as XxyhExpense, { ts: r.ts, category_id: r.category_id, amount: r.amount, remark: exportRemark(r, ctx) })
  else patchXxyhMaintain(base as XxyhMaintain, r)
}

function create(car: XxyhCar, r: LocalRecord, wc: number, ctx: Ctx, now: number, maintWc: Map<string, number>): Row {
  if (r.kind === "fuel") return { ...newXxyhFuel(car, r as FuelRecord), wc_id: wc }
  if (r.kind === "maintenance") return newXxyhMaintain(car, r, wc, now) as Row
  const row: Row = { ...newXxyhExpense(car, { ts: r.ts, category_id: r.category_id, amount: r.amount, remark: exportRemark(r, ctx) }), wc_id: wc }
  // 新记的保养那笔费用：maintain_id 写这条保养的编号（只记来源，小熊不读，映射文档第 5 节）
  const m = ctx.maintOf.get(r.id)
  const mw = m ? maintWc.get(m.id) : undefined
  if (mw != null) row.maintain_id = mw
  return row
}

/** 排序用的时间：加油、费用按 date，保养按 addTime（小熊 App 的顺序） */
const orderKey = (kind: ExportKind, r: Row) => num(kind === "maintenance" ? r.addTime : r.date)
const dateKey = (kind: ExportKind, r: Row) => num(kind === "maintenance" ? r.dateTime : r.date)

/** 油记的记录对上云端的哪一条：先按原样完全相同，再按 wc_id（小熊里改过这条）。返回 记录 id → 云端下标 */
function matchCloud(mine: LocalRecord[], cloud: Array<{ r: Row; i: number }>): Map<string, number> {
  const out = new Map<string, number>()
  const used = new Set<number>()
  const byCanon = new Map<string, number[]>()
  for (const c of cloud) byCanon.set(canon(c.r), [...(byCanon.get(canon(c.r)) ?? []), c.i])
  for (const r of mine) {
    if (!r.xxyh_raw) continue
    const i = byCanon.get(canon(r.xxyh_raw))?.find(j => !used.has(j))
    if (i != null) { out.set(r.id, i); used.add(i) }
  }
  for (const r of mine) {
    const w = r.xxyh_raw ? wcOf(r.xxyh_raw) : null
    if (w == null || out.has(r.id)) continue
    const c = cloud.find(x => !used.has(x.i) && wcOf(x.r) === w)
    if (c) { out.set(r.id, c.i); used.add(c.i) }
  }
  return out
}

/**
 * 一辆车一种记录：换成油记的记录。云端里对上的、日期没变的留在原来的位置；新增、恢复、改了日期的按时间插进去（同一时刻排在已有的后面）；
 * 加油里的充电记录原样留在原位
 */
function buildKind(kind: ExportKind, car: XxyhCar, mine: LocalRecord[], ctx: Ctx, now: number, maintWc: Map<string, number>) {
  const full = ((car[FIELD[kind]] as Row[] | undefined) ?? []).map((r, i) => ({ r, i }))
  const candidates = kind === "fuel" ? full.filter(x => isRefuel(x.r as XxyhFuel)) : full
  const match = matchCloud(mine, candidates)
  const matched = new Set(match.values())
  const usedWc = new Set<string>()
  for (const x of full) if (matched.has(x.i) || (kind === "fuel" && !isRefuel(x.r as XxyhFuel))) { const w = wcOf(x.r); if (w != null) usedWc.add(w) }
  let next = Math.max(0, ...full.map(x => num(x.r.wc_id)), ...mine.map(r => num(r.xxyh_raw?.wc_id))) + 1
  const anchored: Array<{ row: Row; at: number }> = []
  const floating: Row[] = []
  const change: KindChange = { count: mine.length, added: [], modified: [], deleted: [] }
  const raws: Array<[string, Row]> = []
  for (const x of full) if (kind === "fuel" && !isRefuel(x.r as XxyhFuel)) anchored.push({ row: clone(x.r), at: x.i })
  for (const r of mine) {
    const ci = match.get(r.id)
    const cloudRow = ci != null ? full[ci].r : null
    let row: Row
    if (r.xxyh_raw) {
      // 云端这条和原样相同时以云端的为底（键的顺序照云端）；小熊里改过或删掉时以原样为底，导出会覆盖小熊里的改动
      row = clone(cloudRow && canon(cloudRow) === canon(r.xxyh_raw) ? cloudRow : r.xxyh_raw)
      patch(row, r, ctx)
      if (!cloudRow) {
        const w = wcOf(row)
        if (w == null || usedWc.has(w)) row.wc_id = next++
      }
    } else {
      row = create(car, r, next++, ctx, now, maintWc)
    }
    const w = wcOf(row)
    if (w != null) usedWc.add(w)
    if (kind === "maintenance") maintWc.set(r.id, num(row.wc_id))
    if (cloudRow && ci != null && dateKey(kind, cloudRow) === dateKey(kind, row)) anchored.push({ row, at: ci })
    else floating.push(row)
    if (!cloudRow) change.added.push(itemOfRecord(r, ctx))
    else if (canon(row) !== canon(cloudRow)) change.modified.push(itemOfRecord(r, ctx))
    raws.push([r.id, clone(row)])
  }
  for (const c of candidates) if (!matched.has(c.i)) change.deleted.push(itemOfCloud(kind, c.r, ctx))
  const list = anchored.sort((a, b) => a.at - b.at).map(a => a.row)
  for (const row of floating.map((row, i) => ({ row, i })).sort((a, b) => orderKey(kind, b.row) - orderKey(kind, a.row) || a.i - b.i).map(x => x.row)) {
    const k = orderKey(kind, row)
    const at = list.findIndex(x => orderKey(kind, x) < k)
    list.splice(at < 0 ? list.length : at, 0, row)
  }
  return { list, change, raws, matched: match.size, cloudCount: candidates.length }
}

/** 小熊里在上次之后的改动：快照和云端对比，按 wc_id 配成「改过」；ours 是油记里对上快照那条的记录 */
function cloudEdits(kind: ExportKind, snapCar: XxyhCar, cloudCar: XxyhCar, mine: LocalRecord[], ctx: Ctx): CloudEdit[] {
  const pick = (car: XxyhCar) => ((car[FIELD[kind]] as Row[] | undefined) ?? []).filter(r => kind !== "fuel" || isRefuel(r as XxyhFuel))
  const minus = (a: Row[], b: Row[]) => {
    const pool = new Map<string, number>()
    for (const r of b) pool.set(canon(r), (pool.get(canon(r)) ?? 0) + 1)
    return a.filter(r => {
      const n = pool.get(canon(r)) ?? 0
      if (n) pool.set(canon(r), n - 1)
      return !n
    })
  }
  const snap = pick(snapCar)
  const cloud = pick(cloudCar)
  const cloudOnly = minus(cloud, snap)
  const snapOnly = minus(snap, cloud)
  const ours = (r: Row) => mine.find(m => m.xxyh_raw && canon(m.xxyh_raw) === canon(r)) ?? null
  const out: CloudEdit[] = []
  for (const c of cloudOnly) {
    const i = snapOnly.findIndex(s => wcOf(s) != null && wcOf(s) === wcOf(c))
    if (i >= 0) {
      const o = ours(snapOnly[i])
      snapOnly.splice(i, 1)
      out.push({ change: "modified", item: itemOfCloud(kind, c, ctx), ours: o ? itemOfRecord(o, ctx) : null })
    } else {
      out.push({ change: "added", item: itemOfCloud(kind, c, ctx), ours: null })
    }
  }
  for (const s of snapOnly) {
    const o = ours(s)
    if (o) out.push({ change: "deleted", item: itemOfCloud(kind, s, ctx), ours: itemOfRecord(o, ctx) })
  }
  return out
}

const exportVehicles = (ledger: LedgerFile) => ledger.vehicles.filter((v): v is Vehicle & { xxyh_car: string } => !!v.xxyh_car)

/** 生成要上传的整份备份、预览和检查结果 */
export function buildExport(cloud: XxyhBackup, ledger: LedgerFile, opts: ExportOptions): ExportPlan {
  const { now } = opts
  const doc = clone(cloud)
  doc.cars = doc.cars || []
  const names = new Map((cloud.expenseTypes || []).map(t => [num(t._id), String(t.name || "")]))
  for (const c of ledger.expense_categories) if (!names.has(c.id)) names.set(c.id, c.name)
  const maintOf = new Map<string, MaintenanceRecord>()
  for (const r of ledger.records) if (r.kind === "maintenance" && r.expense_id) maintOf.set(r.expense_id, r)
  const ctx: Ctx = { ledger, book: perkBook(ledger), categoryName: id => names.get(id) || "其它", maintOf }
  const problems: string[] = []
  const vehicles = exportVehicles(ledger)
  const seen = new Map<string, string>()
  for (const v of vehicles) {
    const other = seen.get(v.xxyh_car)
    if (other) problems.push(`「${other}」和「${v.name}」都导出到小熊的同一辆车`)
    seen.set(v.xxyh_car, v.name)
  }
  const cars: CarExport[] = []
  const raws: Record<string, XxyhRaw> = {}
  const edits: CloudEdit[] = []
  const changed = opts.cloudVersion != null && opts.cloudVersion !== opts.lastVersion
  for (const v of vehicles) {
    let car = doc.cars.find(c => carKey(c) === v.xxyh_car)
    const created = !car
    if (!car) {
      car = newXxyhCar(v.xxyh_car, v.name, v.profile ?? EMPTY_PROFILE, doc.cars.length, now)
      doc.cars.push(car)
    }
    const mine = ledger.records.filter(r => r.vehicle_id === v.id)
    const maintWc = new Map<string, number>()
    const changes = {} as Record<ExportKind, KindChange>
    let matched = 0
    let cloudCount = 0
    // 保养先算：新记的保养那笔费用要写保养的编号
    for (const kind of ["maintenance", "fuel", "expense"] as ExportKind[]) {
      const b = buildKind(kind, car, mine.filter(r => r.kind === kind), ctx, now, maintWc)
      car[FIELD[kind]] = b.list as never
      changes[kind] = b.change
      for (const [id, row] of b.raws) raws[id] = row
      matched += b.matched
      cloudCount += b.cloudCount
    }
    cars.push({
      vehicle_id: v.id, vehicle_name: v.name, uuid: v.xxyh_car, car_name: String(car.name || v.name), created,
      replaces: !created && matched === 0 ? cloudCount : 0, changes,
    })
    const snapCar = opts.lastSnapshot?.cars?.find(c => carKey(c) === v.xxyh_car)
    const cloudCar = cloud.cars?.find(c => carKey(c) === v.xxyh_car)
    if (changed && snapCar && cloudCar) for (const kind of EXPORT_KINDS) edits.push(...cloudEdits(kind, snapCar, cloudCar, mine.filter(r => r.kind === kind), ctx))
  }
  // 油站：云端的照原样（timeStamp 不改），补上油记有、云端没有的
  const stations = clone(cloud.myStations?.stations || [])
  const ids = new Set(stations.map(s => String(s.id)))
  let added = 0
  for (const st of ledger.stations) {
    if (ids.has(st.id)) continue
    stations.push(newXxyhStation(st, st.last_used_ts || now))
    ids.add(st.id)
    added++
  }
  if (added) doc.myStations = { ...(cloud.myStations || {}), stations }
  // 费用类别：油记不新建类别（都来自小熊）；小熊里删掉了导出的记录用到的类别时不导出，不猜小熊类别的格式
  const known = new Set((cloud.expenseTypes || []).map(t => num(t._id)))
  const exported = new Set(vehicles.map(v => v.id))
  const used = ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense" && exported.has(r.vehicle_id)).map(r => r.category_id)
  const missing = [...new Set(used)].filter(id => !known.has(id))
  for (const id of missing) problems.push(`费用类别「${names.get(id) || id}」在小熊里已经没有了，先在小熊 App 里建回这个类别`)
  problems.push(...validateExport(cloud, doc, ledger))
  return {
    doc, cars, stations: { total: stations.length, added }, categories: (cloud.expenseTypes || []).length, problems,
    cloud_changed: changed ? { from: opts.lastVersion ?? null, to: opts.cloudVersion as number, items: opts.lastSnapshot ? edits : null } : null,
    raws,
  }
}

/** 一份计划里新增、修改、删除的总条数（「M 条修改没导出」） */
export function changeCount(plan: ExportPlan): number {
  return plan.cars.reduce((n, c) => n + EXPORT_KINDS.reduce((m, k) => m + c.changes[k].added.length + c.changes[k].modified.length + c.changes[k].deleted.length, 0), 0)
}

/** 还没导出的修改：用上次导入或导出时的快照离线算（不联网） */
export function pendingChanges(snapshot: XxyhBackup, ledger: LedgerFile, now: number): number {
  return changeCount(buildExport(snapshot, ledger, { now }))
}

/**
 * 上传前检查（1.x validateUpload 的每一条，加上 2.0 的）：除了导出的车的三种记录、末尾新建的车和补上的油站，其他内容都和云端一样；
 * 每辆导出的车每种记录的条数等于油记的条数（加油再加上原样保留的充电记录）；编号不重复；引用的油站都在。返回问题，为空才能上传
 */
export function validateExport(before: XxyhBackup, after: XxyhBackup, ledger: LedgerFile): string[] {
  const problems: string[] = []
  const same = (a: unknown, b: unknown) => canon(a) === canon(b)
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (k === "cars" || k === "myStations") continue
    if (!same(before[k], after[k])) problems.push(`备份的 ${k} 被意外修改`)
  }
  const vehicles = new Map(exportVehicles(ledger).map(v => [v.xxyh_car, v]))
  const bCars = before.cars || []
  const aCars = after.cars || []
  const appended = aCars.slice(bCars.length)
  if (aCars.length < bCars.length || bCars.some((c, i) => carKey(c) !== carKey(aCars[i])) || appended.some(c => !vehicles.has(carKey(c)))) {
    problems.push("车辆列表和云端的不一致：原有的车只能原样保留，新建的车只能加在末尾")
    return problems
  }
  const keys = aCars.map(carKey)
  if (new Set(keys).size !== keys.length) problems.push("车辆 uuid 重复")
  aCars.forEach((a, i) => {
    const b: XxyhCar | undefined = bCars[i]
    const v = vehicles.get(carKey(a))
    const name = String(a.name || carKey(a))
    if (!v) {
      if (!same(b, a)) problems.push(`「${name}」没有对应的油记车辆，却被改了`)
      return
    }
    for (const k of new Set([...Object.keys(b || {}), ...Object.keys(a)])) {
      if (k === "fuelRecords" || k === "expenseRecords" || k === "maintainRecords") continue
      if (b && !same(b[k], a[k])) problems.push(`「${name}」的 ${k} 被意外修改`)
      if (!b && Array.isArray(a[k]) && (a[k] as unknown[]).length) problems.push(`新建的「${name}」不应有 ${k}`)
    }
    const mine = ledger.records.filter(r => r.vehicle_id === v.id)
    const charge = (car: XxyhCar | undefined) => (car?.fuelRecords || []).filter(r => !isRefuel(r)).map(canon).sort()
    if (canon(charge(b)) !== canon(charge(a))) problems.push(`「${name}」的充电记录被意外修改`)
    const refuel = (a.fuelRecords || []).filter(isRefuel).length
    const counts: Array<[string, number, number]> = [
      ["加油", refuel, mine.filter(r => r.kind === "fuel").length],
      ["费用", (a.expenseRecords || []).length, mine.filter(r => r.kind === "expense").length],
      ["保养", (a.maintainRecords || []).length, mine.filter(r => r.kind === "maintenance").length],
    ]
    for (const [label, got, want] of counts) if (got !== want) problems.push(`「${name}」的${label}记录 ${got} 条，油记里是 ${want} 条`)
    for (const [label, list] of [["加油", a.fuelRecords], ["费用", a.expenseRecords], ["保养", a.maintainRecords]] as Array<[string, Row[] | undefined]>) {
      const wc = (list || []).map(wcOf).filter((w): w is string => w != null)
      if (new Set(wc).size !== wc.length) problems.push(`「${name}」的${label}记录编号重复`)
    }
  })
  const bs = before.myStations?.stations || []
  const as = after.myStations?.stations || []
  const sids = as.map(s => String(s.id))
  if (new Set(sids).size !== sids.length) problems.push("油站 id 重复")
  for (const s of bs) {
    const t = as.find(x => String(x.id) === String(s.id))
    if (!t) problems.push(`油站「${s.name}」丢失`)
    else if (!same(s, t)) problems.push(`油站「${s.name}」被意外修改`)
  }
  for (const k of new Set([...Object.keys(before.myStations || {}), ...Object.keys(after.myStations || {})])) {
    if (k !== "stations" && !same((before.myStations || {})[k], (after.myStations || {})[k])) problems.push(`myStations.${k} 被意外修改`)
  }
  // 只算新出现的悬空引用（云端原来就有的不算）
  const bIds = new Set(bs.map(s => String(s.id)))
  const old = new Set<string>()
  for (const c of bCars) for (const r of c.fuelRecords || []) if (r.stationId && !bIds.has(String(r.stationId))) old.add(String(r.stationId))
  const aIds = new Set(sids)
  for (const c of aCars) {
    for (const r of c.fuelRecords || []) {
      const sid = r.stationId ? String(r.stationId) : ""
      if (sid && !aIds.has(sid) && !old.has(sid)) problems.push(`加油记录引用了不存在的油站 ${sid}`)
    }
  }
  return problems
}
