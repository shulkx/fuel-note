// 养修（docs/specs/2026-10-24-maintenance-volvo.md 第 5、7–9、12 节，纯函数）：进店的叫法、记没记、沃尔沃的叫法、
// 从养修填写的表单内容、先勾好的权益、找门店、保存成保养记录和费用、编辑时取回存下的结算、费用页一行的标题。不导入 "scripting"。
import { ExpenseEntry, MAINTENANCE_CATEGORY } from "./expense_stats"
import { BJ_OFFSET } from "./format"
import { metres } from "./geo"
import { AppData, Change } from "./ledger"
import { MaintenanceInput, putMaintenance } from "./maintenance"
import { putExpenseWithPerks } from "./perk_ledger"
import { deductOf, PerkBook, usablePerks, Use } from "./perks"
import { normalizeName } from "./stores"
import { ExpenseData, ExpenseRecord, LedgerFile, ServiceRecord, ServiceTicket, ServiceVisit, Store, Vehicle } from "./types"
import type { TicketItems } from "../providers/types"

/** 整理一张工单的项目（提供方的规则，见 providers/types.ts 的 serviceNaming） */
export type TicketNaming = (t: ServiceTicket) => TicketItems

const DAY = 86400e3
const OTHER_CATEGORY = 100003
const round2 = (n: number) => Math.round(n * 100) / 100
const dayStartBJ = (ts: number) => Math.floor((ts + BJ_OFFSET) / DAY) * DAY - BJ_OFFSET

// ---------- 叫法（第 8 节） ----------

/** 一张工单的叫法：项目名里有补漆、喷漆的叫补漆，机电维修叫维修，零售叫补漆，其余照类型 */
export function ticketLabel(t: ServiceTicket): string {
  if (/补漆|喷漆/.test(t.projects.join(""))) return "补漆"
  return ({ 保养: "保养", 机电维修: "维修", 零售: "补漆" } as Record<string, string>)[t.type] ?? t.type
}

/** 进店的叫法：保养在前，其余按出现顺序去重；自付为 0 的保修、事故不写进叫法，全是这种时才写 */
export function visitTitle(v: ServiceVisit): string {
  const shown = v.tickets.filter(t => !((t.type === "保修" || t.type === "事故") && t.own === 0))
  const list = (shown.length ? shown : v.tickets).slice().sort((a, b) => (a.type === "保养" ? 0 : 1) - (b.type === "保养" ? 0 : 1))
  return [...new Set(list.map(ticketLabel))].join(" · ")
}

/** 记成保养记录的那几张工单：保养工单；没有保养工单时第一张当作这一笔（没有里程、项目） */
export function mainTickets(v: ServiceVisit): ServiceTicket[] {
  const m = v.tickets.filter(t => t.type === "保养")
  return m.length ? m : v.tickets.slice(0, 1)
}

/** 整理出的项目（去重）和写进备注的检查、问题 */
export function visitItems(tickets: ServiceTicket[], naming: TicketNaming): { items: TicketItems["items"]; notes: string[] } {
  const items: TicketItems["items"] = []
  const notes: string[] = []
  for (const t of tickets) {
    const r = naming(t)
    for (const i of r.items) if (!items.some(x => x.name === i.name)) items.push(i)
    for (const n of r.notes) if (!notes.includes(n)) notes.push(n)
  }
  return { items, notes }
}

// ---------- 记没记（第 7 节） ----------

export type VisitState =
  /** 还没结算：只在养修记录页显示状态 */
  | { kind: "unsettled" }
  | { kind: "todo" }
  /** 记下的（service_records），或之前手动记的；amount 是油记里记的金额，open 是轻点打开的记录 */
  | { kind: "recorded"; amount: number; open: string | null; linked: boolean }

/** 记下的养修记成的记录（费用和它们的保养记录） */
function linkedIds(ledger: LedgerFile): Set<string> {
  const ids = new Set<string>()
  for (const s of ledger.service_records) for (const t of s.tickets) if (t.record_id) ids.add(t.record_id)
  for (const r of ledger.records) if (r.kind === "maintenance" && r.expense_id && ids.has(r.expense_id)) ids.add(r.id)
  return ids
}

export function serviceRecordFor(ledger: LedgerFile, vehicleId: string, v: Pick<ServiceVisit, "provider" | "order_id">): ServiceRecord | null {
  return ledger.service_records.find(s => s.vehicle_id === vehicleId && s.provider === v.provider && s.order_id === v.order_id) ?? null
}

export function visitState(ledger: LedgerFile, vehicleId: string, v: ServiceVisit): VisitState {
  if (!v.tickets.length || v.settled_ts == null) return { kind: "unsettled" }
  const expenses = (ids: string[]) => ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense" && ids.includes(r.id))
  const rec = serviceRecordFor(ledger, vehicleId, v)
  if (rec) {
    const ids = rec.tickets.map(t => t.record_id).filter((x): x is string => !!x)
    const found = expenses(ids)
    if (found.length) return { kind: "recorded", amount: round2(found.reduce((t, e) => t + e.amount, 0)), open: ids.find(id => found.some(e => e.id === id)) ?? null, linked: true }
  }
  // 之前手动记的：进店那天到最后结算那天 + 3 天之间有保养记录，或维修保养、其它类别的费用（记下的养修记成的不算）
  const linked = linkedIds(ledger)
  const lo = dayStartBJ(v.arrive_ts)
  const hi = dayStartBJ(v.settled_ts) + 4 * DAY
  const found = ledger.records.filter(r => r.vehicle_id === vehicleId && !linked.has(r.id) && r.ts >= lo && r.ts < hi
    && (r.kind === "maintenance" || (r.kind === "expense" && (r.category_id === MAINTENANCE_CATEGORY || r.category_id === OTHER_CATEGORY))))
  if (!found.length) return { kind: "todo" }
  const paired = new Set(found.flatMap(r => (r.kind === "maintenance" && r.expense_id ? [r.expense_id] : [])))
  const amount = found.reduce((t, r) => t + (r.kind === "expense" ? r.amount : r.kind === "maintenance" && !(r.expense_id && found.some(e => e.id === r.expense_id)) ? r.amount : 0), 0)
  const open = found.find(r => r.kind === "expense" && paired.has(r.id))?.id ?? found.find(r => r.kind === "expense")?.id ?? found[0].id
  return { kind: "recorded", amount: round2(amount), open, linked: false }
}

// ---------- 沃尔沃的叫法（第 5 节）：项目页的候选 ----------

/**
 * 读到的全部养修记录整理出的项目，加上账本里这辆车用过的项目，按出现次数（两边相加）排，次数一样时最近的在前。
 * 已经记下的进店不再按工单数（账本里那条保养记录已经算了一次）
 */
export function serviceVocabulary(visits: ServiceVisit[], naming: TicketNaming, ledger: LedgerFile, vehicleId: string): string[] {
  const stats = new Map<string, { count: number; last: number }>()
  const add = (name: string, ts: number) => {
    const s = stats.get(name) ?? { count: 0, last: 0 }
    stats.set(name, { count: s.count + 1, last: Math.max(s.last, ts) })
  }
  for (const v of visits) {
    if (!v.tickets.length || serviceRecordFor(ledger, vehicleId, v)) continue
    for (const i of visitItems(v.tickets.filter(t => t.type === "保养"), naming).items) add(i.name, v.arrive_ts)
  }
  for (const r of ledger.records) if (r.kind === "maintenance" && r.vehicle_id === vehicleId) for (const name of r.items) add(name, r.ts)
  return [...stats.entries()].sort((a, b) => b[1].count - a[1].count || b[1].last - a[1].last).map(([name]) => name)
}

// ---------- 先勾好的权益（第 12 节） ----------

/**
 * 按工单先勾好的卡（只在对得上的卡正好一张时）：优惠名带「续保」→ 那一期车险赠送的储值卡；只有基础保养的工单上有优惠 → 名字带「基础保养」的次数卡；
 * 补漆工单的项目名带「X<n>」→ 油漆面的次数卡用 n 个。只看进店那天有效、还有剩余的卡；taken 是这次已经勾给别的工单的用量（同一张卡不重复勾）
 */
export function suggestUses(book: PerkBook, vehicleId: string, ts: number, tickets: ServiceTicket[], naming: TicketNaming, taken: Map<string, number> = new Map()): Use[] {
  const usable = usablePerks(book, vehicleId, ts, null)
  const out: Use[] = []
  const free = (id: string, left: number) => left - (taken.get(id) ?? 0) - out.filter(u => u.perk_id === id).reduce((t, u) => t + u.used, 0)
  const pick = (cands: typeof usable, used: number) => {
    if (cands.length !== 1) return
    const p = cands[0].perk
    const had = out.find(u => u.perk_id === p.id)
    if (had) { had.used = round2(had.used + used); had.deduct = deductOf(p, had.used) }
    else out.push({ perk_id: p.id, used, deduct: deductOf(p, used) })
  }
  for (const t of tickets) {
    for (const p of t.prefs) {
      if (p.name.includes("续保")) pick(usable.filter(u => u.perk.kind === "balance" && u.perk.origin === "insurance" && free(u.perk.id, u.left) >= p.amount), p.amount)
    }
    if (t.prefs.length && naming(t).basic_only) pick(usable.filter(u => u.perk.kind === "count" && u.perk.name.includes("基础保养") && free(u.perk.id, u.left) >= 1), 1)
    const x = t.projects.join("").match(/X(\d+)/i)
    if (x && ticketLabel(t) === "补漆") {
      const n = Number(x[1])
      pick(usable.filter(u => u.perk.kind === "count" && u.perk.name.includes("油漆面") && free(u.perk.id, u.left) >= n), n)
    }
  }
  for (const u of out) taken.set(u.perk_id, (taken.get(u.perk_id) ?? 0) + u.used)
  return out
}

// ---------- 找门店（第 10 节） ----------

/** 先找经销商代码相同的；没有时找名称等于经销商简称或全称、或在经销商坐标 300 米内的（pending：标橙，保存后写进经销商代码） */
export function serviceStore(stores: Store[], v: Pick<ServiceVisit, "provider" | "dealer_code" | "dealer">): { store: Store | null; pending: boolean } {
  const byCode = stores.find(s => s.dealer && s.dealer.provider === v.provider && s.dealer.code === v.dealer_code)
  if (byCode) return { store: byCode, pending: false }
  const d = v.dealer
  if (!d) return { store: null, pending: false }
  const free = stores.filter(s => !s.dealer || s.dealer.provider !== v.provider)
  const names = [d.short, d.name].filter(Boolean).map(normalizeName)
  const hit = free.find(s => names.includes(normalizeName(s.name)) || (!!s.full_name && names.includes(normalizeName(s.full_name))))
    ?? (d.lng != null && d.lat != null ? free.find(s => s.lng != null && s.lat != null && metres([s.lng, s.lat], [d.lng as number, d.lat as number]) <= 300) : undefined)
  return hit ? { store: hit, pending: true } : { store: null, pending: false }
}

// ---------- 从养修填写的表单内容（第 8 节） ----------

/** 另记一笔的备注：沃尔沃的项目名（「划痕补漆续保赠送X2」）。用掉的券在使用权益和沃尔沃结算里，不写进备注（2.1.0-beta.6） */
export function ticketRemark(t: ServiceTicket): string {
  return t.projects.join("、")
}

/** 实付的默认值：自付为 0 时 0，否则空着（null，必须填） */
export const defaultPaid = (own: number): number | null => (own === 0 ? 0 : null)

export type ServiceDraft = {
  main: {
    tickets: ServiceTicket[]
    ts: number
    odometer: number | null
    items: TicketItems["items"]
    notes: string[]
    own: number
    amount: number | null
    remark: string
    uses: Use[]
  }
  others: Array<{ ticket: ServiceTicket; ts: number; amount: number | null; remark: string; uses: Use[] }>
  store: Store | null
  /** 门店是按名称或位置找到的：标橙，保存后写进经销商代码 */
  storePending: boolean
}

export function serviceDraft(ledger: LedgerFile, book: PerkBook, vehicle: Vehicle, v: ServiceVisit, naming: TicketNaming): ServiceDraft {
  const main = mainTickets(v)
  const isMaint = main.some(t => t.type === "保养")
  const { items, notes } = isMaint ? visitItems(main, naming) : { items: [], notes: [] }
  const own = round2(main.reduce((t, x) => t + x.own, 0))
  const taken = new Map<string, number>()
  const mainUses = suggestUses(book, vehicle.id, v.arrive_ts, main, naming, taken)
  const others = v.tickets.filter(t => !main.includes(t)).map(t => ({
    ticket: t, ts: t.created_ts, amount: defaultPaid(t.own), remark: ticketRemark(t), uses: suggestUses(book, vehicle.id, t.created_ts, [t], naming, taken),
  }))
  const { store, pending } = serviceStore(ledger.stores, v)
  return {
    main: {
      tickets: main, ts: v.arrive_ts, odometer: isMaint ? v.odometer : null, items, notes, own, amount: defaultPaid(own),
      remark: isMaint ? notes.join("；") : ticketRemark(main[0]), uses: mainUses,
    },
    others, store, storePending: pending,
  }
}

// ---------- 保存（第 9 节） ----------

export type ServiceSave = {
  main: { expense: ExpenseData; uses: Use[]; store: Store | null; maintenance: MaintenanceInput | null }
  /** 另记的工单；expense 为 null 时关掉不记 */
  others: Array<{ ro_no: string; expense: ExpenseData | null; uses: Use[] }>
}

/**
 * 记下一次进店：保养工单写一条保养记录和一笔维修保养费用（几张合成一条），开着的其他工单各记一笔维修保养费用（门店同这一笔），
 * 用了的权益记在各自的费用上；门店是按名称或位置找到的，写进经销商代码；最后写一条 service_records（结算原样和每张工单记成的费用）
 */
export function putServiceVisit(data: AppData, vehicle: Vehicle, v: ServiceVisit, input: ServiceSave): Change {
  const c = putExpenseWithPerks(data, vehicle, null, input.main.expense, { uses: input.main.uses, store: input.main.store })
  const mainId = c.recordId as string
  let ledger = putMaintenance(c.ledger, mainId, input.main.maintenance)
  const storeId = (ledger.records.find(r => r.id === mainId) as ExpenseRecord | undefined)?.store_id ?? null
  const store = storeId ? ledger.stores.find(s => s.id === storeId) ?? null : null
  const ids = new Map<string, string>()
  for (const o of input.others) {
    if (!o.expense) continue
    const oc = putExpenseWithPerks({ ...data, ledger }, vehicle, null, o.expense, { uses: o.uses, store })
    ledger = oc.ledger
    ids.set(o.ro_no, oc.recordId as string)
  }
  if (store && !store.dealer) {
    ledger = { ...ledger, stores: ledger.stores.map(s => (s.id === store.id ? { ...s, dealer: { provider: v.provider, code: v.dealer_code } } : s)) }
  }
  const main = new Set(mainTickets(v).map(t => t.ro_no))
  const rec: ServiceRecord = {
    vehicle_id: vehicle.id, provider: v.provider, order_id: v.order_id, dealer_code: v.dealer_code, arrive_ts: v.arrive_ts, odometer: v.odometer, dealer: v.dealer,
    tickets: v.tickets.map(t => ({ ...t, record_id: main.has(t.ro_no) ? mainId : ids.get(t.ro_no) ?? null })),
  }
  ledger = { ...ledger, service_records: [...ledger.service_records.filter(s => !(s.vehicle_id === vehicle.id && s.provider === v.provider && s.order_id === v.order_id)), rec] }
  return { ledger, recordId: mainId }
}

// ---------- 编辑关联了养修的费用 ----------

/** 这笔费用记的是哪次进店的哪几张工单（编辑时显示存下的结算）；没有关联时 null */
export function serviceOfExpense(ledger: LedgerFile, expenseId: string): { record: ServiceRecord; tickets: ServiceTicket[] } | null {
  for (const s of ledger.service_records) {
    const tickets = s.tickets.filter(t => t.record_id === expenseId)
    if (tickets.length) return { record: s, tickets }
  }
  return null
}

/** 优惠名去掉末尾的面额（「…优惠券-200元」→「…优惠券」，金额另外写） */
export const prefLabel = (name: string) => name.replace(/[-－]\d+元$/, "")

/** 使用权益页上面的对照：工单上的券和活动优惠；没有优惠明细的旧工单列项目名里写的赠送、延保 */
export function settlementRefs(tickets: ServiceTicket[]): Array<{ name: string; amount: number | null }> {
  return tickets.flatMap(t => (t.prefs.length
    ? t.prefs.map(p => ({ name: prefLabel(p.name), amount: p.amount as number | null }))
    : t.projects.filter(p => /赠送|延保|X\d/i.test(p)).map(name => ({ name, amount: null as number | null }))))
}

/** 几张工单的结算合在一起（沃尔沃结算一组）：结算备注去掉被别的包含的 */
export function settlementOf(tickets: ServiceTicket[]) {
  const sum = (f: (t: ServiceTicket) => number) => round2(tickets.reduce((s, t) => s + f(t), 0))
  const remarks = tickets.map(t => t.remark).filter(Boolean)
  return {
    total: sum(t => t.total),
    labour_discount: sum(t => t.labour_discount),
    discounts: tickets.flatMap(t => t.discounts),
    prefs: tickets.flatMap(t => t.prefs),
    rounding: sum(t => t.rounding),
    own: sum(t => t.own),
    remark: [...new Set(remarks.filter(r => !remarks.some(o => o !== r && o.includes(r))))].join("；"),
  }
}

// ---------- 费用页一行的标题（设计文档 22.5 节，2.1.0-beta.6） ----------

/** 换了机油的保养：项目里有「机油」或「机油 <标号>」（机油滤清器不算） */
export const isOilChange = (items: string[]) => items.some(i => /^机油(\s|$)/.test(i))

const DIGITS = "零一二三四五六七八九"

/** 1–99 写成中文（「九」「十二」「三十五」），其余照写数字 */
export function cnNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n)
  if (n < 10) return DIGITS[n]
  const tens = Math.floor(n / 10)
  return `${tens > 1 ? DIGITS[tens] : ""}十${n % 10 ? DIGITS[n % 10] : ""}`
}

/** 这辆车换了机油的保养按时间编号：保养记录 id → 第几次 */
export function oilChangeNumbers(ledger: LedgerFile, vehicleId: string): Map<string, number> {
  const list: Array<{ id: string; ts: number }> = []
  for (const r of ledger.records) if (r.kind === "maintenance" && r.vehicle_id === vehicleId && isOilChange(r.items)) list.push(r)
  list.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
  return new Map(list.map((r, i) => [r.id, i + 1]))
}

/** 工时里冒号后面写的部位（「喷漆：左前门，左后门」→ 左前门、左后门），只看冒号前面对得上 head 的，去重 */
function labourPlaces(labours: string[], head: RegExp): string[] {
  const out: string[] = []
  for (const l of labours) {
    const m = l.match(/^([^：:]+)[：:](.+)$/)
    if (!m || !head.test(m[1])) continue
    for (const p of m[2].split(/[，,、]/).map(x => x.trim())) if (p && !out.includes(p)) out.push(p)
  }
  return out
}

/** 换的零件：工时去掉开头的「更换」，斜杠取第一个名字；提供、检查、客户反映这类不算 */
function labourRepairs(labours: string[]): string[] {
  const out: string[] = []
  for (const l of labours) {
    if (/^提供|检查|客户反映/.test(l)) continue
    const name = l.replace(/^更换/, "").split("/")[0].trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 用顿号连起来；给了 max 时只写前 max 个，后面加「等」 */
const joinList = (xs: string[], max = Infinity) => (xs.length > max ? `${xs.slice(0, max).join("、")}等` : xs.join("、"))

/**
 * 另记一笔的工单的标题（用户 2026-10-26 审过）：
 * - 项目名有「事故」：「事故维修 · 前保、中网等」（喷漆、钣金的部位，写前两个）；
 * - 有喷漆：「补漆 · 后保、左后叶」；有钣金：「钣金 · 右后翼子板」；
 * - 保修：「保修 · 保险丝」（零件；沃尔沃的保修工时有英文写的）；其余：「维修 · 蒸发排放阀」（换的零件）；
 * - 都读不出时：叫法 · 项目名
 */
export function ticketTitle(t: ServiceTicket): string {
  if (t.projects.some(p => p.includes("事故"))) {
    const where = labourPlaces(t.labours, /^(喷漆|钣金)/)
    if (where.length) return `事故维修 · ${joinList(where, 2)}`
  }
  const paint = labourPlaces(t.labours, /^喷漆/)
  if (paint.length) return `补漆 · ${joinList(paint)}`
  const sheet = labourPlaces(t.labours, /^钣金/)
  if (sheet.length) return `钣金 · ${joinList(sheet)}`
  if (t.type === "保修" && t.parts.length) return `保修 · ${joinList([...new Set(t.parts)])}`
  const fixed = labourRepairs(t.labours)
  if (fixed.length) return `${t.type === "保修" ? "保修" : "维修"} · ${joinList(fixed)}`
  return [ticketLabel(t), t.projects.join("、")].filter(Boolean).join(" · ")
}

/**
 * 费用页一行的标题（2.1.0-beta.6 起备注不再当标题，用户 2026-10-26）：
 * - 换了机油的保养：「第九次保养」，numbers 是 oilChangeNumbers；
 * - 从养修记下的：没换机油的保养「保养 · 空调滤芯、火花塞等」，另记的工单见 ticketTitle；
 * - 其余自己记的：保养的说明或项目，费用备注的第一行；都没有时是类别名
 */
export function entryTitle(ledger: LedgerFile, numbers: Map<string, number>, e: ExpenseEntry, category: string): string {
  const m = e.maintenance
  const n = m ? numbers.get(m.id) : undefined
  if (n) return `第${cnNumber(n)}次保养`
  const linked = e.expense ? serviceOfExpense(ledger, e.expense.id) : null
  if (m && linked) return m.items.length ? `保养 · ${joinList(m.items, 2)}` : "保养"
  if (linked) return ticketTitle(linked.tickets[0])
  const first = (s: string) => s.split("\n").map(l => l.trim()).find(Boolean) ?? ""
  if (m) return first(m.remark) || m.items.join("、") || category
  return first(e.expense?.remark ?? "") || category
}
