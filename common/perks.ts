// 权益卡的纯逻辑（权益设计 docs/specs/2026-10-23-benefits-wallet.md）：剩余和状态、按来自分组、到期提醒、
// 续保提醒和保单详情的「赠送」一行、记费用时能用的卡和默认用量、导出到小熊时写进费用备注的用量、同名和编辑时的检查。不导入 "scripting"。
// 一张卡是独立的：有效期、门店、来自都存在卡上，不跟随保单或费用；使用记录按费用的 id 对应费用（2.0 起），用来跳转，删除费用时一起删除。
import { BJ_OFFSET, yuan, yuanShort } from "./format"
import { daysLeft, monthDayText, yearOf, yearPeriod } from "./insurance"
import { normalizeName } from "./stores"
import { InsuranceYear, LedgerFile, Perk, PerkUse, Store } from "./types"

/** 到期前多少天起提醒（权益页的组头标橙；按北京时间的日期数，同续保提醒） */
export const EXPIRING_DAYS = 30

const DAY = 86400e3
const round2 = (n: number) => Math.round(n * 100) / 100

/** 北京时间那一天的最后一毫秒：卡的「有效期至」 */
export function endOfDayBJ(ts: number): number {
  return (Math.floor((ts + BJ_OFFSET) / DAY) + 1) * DAY - BJ_OFFSET - 1
}

/** 权益的几张表（LedgerFile 里可选的几项都给空数组） */
export type PerkBook = { perks: Perk[]; uses: PerkUse[]; years: InsuranceYear[]; stores: Store[] }

export function perkBook(ledger: LedgerFile): PerkBook {
  return { perks: ledger.perks ?? [], uses: ledger.perk_uses ?? [], years: ledger.insurance ?? [], stores: ledger.stores ?? [] }
}

// ---------- 剩余和状态 ----------

/** 用掉的量；exceptExpenseId：编辑费用时不算这一笔自己的 */
export function usedOf(book: PerkBook, perkId: string, exceptExpenseId: string | null = null): number {
  return round2(book.uses
    .filter(u => u.perk_id === perkId && (exceptExpenseId == null || u.expense_id !== exceptExpenseId))
    .reduce((t, u) => t + u.used, 0))
}

export function remaining(book: PerkBook, p: Perk, exceptExpenseId: string | null = null): number {
  return round2(Math.max(0, p.total - usedOf(book, p.id, exceptExpenseId)))
}

export type PerkState = "active" | "used_up" | "expired"

export function perkState(book: PerkBook, p: Perk, now: number): PerkState {
  if (remaining(book, p) <= 0) return "used_up"
  return p.end_ts != null && p.end_ts < now ? "expired" : "active"
}

/** 剩余的写法：「¥800.00」「3 面」「1 张」 */
export function perkAmount(p: Perk, n: number): string {
  return p.kind === "balance" ? yuan(n) : `${n} ${p.unit}`
}

/** 类型的写法（第二行）：储值、次数 */
export function kindText(p: Perk): string {
  return p.kind === "balance" ? "储值" : "次数"
}

/** 名称和数量（保单详情「赠送」一行、添加时的「已有」）：「维修保养券 ¥800」「原厂油漆面 3 面」「基础保养」 */
export function giftName(p: Perk): string {
  if (p.kind === "balance") return `${p.name} ${yuanShort(p.total)}`
  return p.total === 1 && p.unit === "次" ? p.name : `${p.name} ${p.total} ${p.unit}`
}

// ---------- 来自和分组 ----------

/** 分组的键：来自某一年车险的按保险年度，其余按来自的文字 */
export const groupKey = (p: Perk) => (p.insurance_id ? `ins:${p.insurance_id}` : `src:${p.source}`)

/** 来自某一年车险时那一年（删了那一年的保险时 null） */
export function perkYear(book: PerkBook, p: Perk): InsuranceYear | null {
  return p.insurance_id ? book.years.find(y => y.id === p.insurance_id) ?? null : null
}

/** 车险赠送的默认来自和有效期：「2026 车险」、保险到期日 */
export function insuranceDefaults(year: InsuranceYear): { source: string; end_ts: number | null } {
  const p = yearPeriod(year)
  return { source: `${yearOf(year)} 车险`, end_ts: p ? p.end : null }
}

export type PerkItem = { perk: Perk; left: number; used: boolean }
export type PerkGroup = {
  key: string
  title: string
  year: InsuranceYear | null
  /** 同一批的门店都一样时是那家，不一样或都没填时为空 */
  store: string
  /** 组里最早的到期日；都不限时 null */
  end: number | null
  items: PerkItem[]
  /** 30 天内到期 */
  expiring: boolean
  /** 快到期时组头的提示：「1月6日到期 · 5 项未使用」 */
  note: string | null
}

const vehiclePerks = (book: PerkBook, vehicleId: string) => book.perks.filter(p => p.vehicle_id === vehicleId)

function itemOf(book: PerkBook, p: Perk): PerkItem {
  return { perk: p, left: remaining(book, p), used: book.uses.some(u => u.perk_id === p.id) }
}

function commonStore(perks: Perk[]): string {
  const names = new Set(perks.map(p => p.store.trim()))
  return names.size === 1 ? [...names][0] : ""
}

function minEnd(perks: Perk[]): number | null {
  const ends = perks.map(p => p.end_ts).filter((t): t is number => t != null)
  return ends.length ? Math.min(...ends) : null
}

function groupsOf(book: PerkBook, vehicleId: string, now: number, keep: (s: PerkState) => boolean): PerkGroup[] {
  const map = new Map<string, Perk[]>()
  for (const p of vehiclePerks(book, vehicleId)) {
    if (!keep(perkState(book, p, now))) continue
    const k = groupKey(p)
    map.set(k, [...(map.get(k) ?? []), p])
  }
  const out: PerkGroup[] = []
  for (const [key, perks] of map) {
    const items = perks.map(p => itemOf(book, p))
    const end = minEnd(perks)
    const left = end != null ? daysLeft(end, now) : null
    const expiring = left != null && left >= 0 && left <= EXPIRING_DAYS
    out.push({
      key, title: perks[0].source, year: perkYear(book, perks[0]), store: commonStore(perks), end, items, expiring,
      note: expiring ? `${monthDayText(end!)}到期 · ${leftCountText(items)}` : null,
    })
  }
  const endOf = (g: PerkGroup) => g.end ?? Infinity
  const created = (g: PerkGroup) => Math.min(...g.items.map(i => i.perk.created_ts))
  return out.sort((a, b) => endOf(a) - endOf(b) || created(a) - created(b))
}

/** 「5 项未使用」；有用过一部分的写「N 项未用完」 */
export function leftCountText(items: PerkItem[]): string {
  return items.some(i => i.used) ? `${items.length} 项未用完` : `${items.length} 项未使用`
}

/** 权益页：有剩余、没过期的卡，按来自分组，组按到期排（不限期的排最后） */
export function perkGroups(book: PerkBook, vehicleId: string, now: number): PerkGroup[] {
  return groupsOf(book, vehicleId, now, s => s === "active")
}

/** 已用完和已过期（过了有效期还有剩余的算过期未用） */
export function doneGroups(book: PerkBook, vehicleId: string, now: number): PerkGroup[] {
  return groupsOf(book, vehicleId, now, s => s !== "active")
}

/** 一批（同一来自）的全部卡，含用完和过期的；按添加的顺序 */
export function batchPerks(book: PerkBook, vehicleId: string, key: string): Perk[] {
  return vehiclePerks(book, vehicleId).filter(p => groupKey(p) === key)
}

/** 一批的信息：来自、那一年的保险、共同的门店、最早的到期日、原文（不同的各列一次） */
export function batchInfo(book: PerkBook, vehicleId: string, key: string): { title: string; year: InsuranceYear | null; store: string; end: number | null; raw: string } | null {
  const perks = batchPerks(book, vehicleId, key)
  if (!perks.length) return null
  const raws = [...new Set(perks.map(p => p.raw.trim()).filter(Boolean))]
  return {
    title: perks[0].source, year: perkYear(book, perks[0]), store: commonStore(perks), end: minEnd(perks), raw: raws.join("\n\n"),
  }
}

// ---------- 保险页、保单详情 ----------

/** 续保提醒并进同一天到期、来自这一年车险、还有剩余的卡：「赠送 5 项未使用」；没有时 null */
export function renewalGifts(book: PerkBook, year: InsuranceYear, now: number): string | null {
  const items = book.perks.filter(p => p.insurance_id === year.id && perkState(book, p, now) === "active").map(p => itemOf(book, p))
  return items.length ? `赠送 ${leftCountText(items)}` : null
}

/** 保单详情「赠送」一行：名称和数量、使用情况（都未使用、已用 2 项、都已用完）；这一年还没有赠送时 null */
export function giftLine(book: PerkBook, year: InsuranceYear): { key: string; names: string; status: string } | null {
  const gifts = book.perks.filter(p => p.insurance_id === year.id)
  if (!gifts.length) return null
  const touched = gifts.filter(p => book.uses.some(u => u.perk_id === p.id))
  const status = !touched.length ? "都未使用" : gifts.every(p => remaining(book, p) <= 0) ? "都已用完" : `已用 ${touched.length} 项`
  return { key: `ins:${year.id}`, names: gifts.map(giftName).join(" · "), status }
}

// ---------- 记费用 ----------

export type Usable = { perk: Perk; left: number }

/**
 * 记费用能用的卡：这辆车的、在费用的时间还没过期、有剩余（编辑时加回这一笔自己用掉的）。不按门店、类别筛选。
 * 这一笔自己用过的不管别的条件都列出（剩余至少是它自己的用量），免得打开旧费用时悄悄去掉那次使用。按到期排
 */
export function usablePerks(book: PerkBook, vehicleId: string, ts: number, expenseId: string | null): Usable[] {
  const out: Array<Usable & { end: number }> = []
  for (const perk of vehiclePerks(book, vehicleId)) {
    const own = expenseId == null ? 0 : round2(book.uses.filter(u => u.perk_id === perk.id && u.expense_id === expenseId).reduce((t, u) => t + u.used, 0))
    const left = remaining(book, perk, expenseId)
    if (own > 0) {
      out.push({ perk, left: Math.max(left, own), end: perk.end_ts ?? Infinity })
      continue
    }
    if (perk.end_ts != null && ts > perk.end_ts) continue
    if (left <= 0) continue
    out.push({ perk, left, end: perk.end_ts ?? Infinity })
  }
  return out.sort((a, b) => a.end - b.end || a.perk.created_ts - b.perk.created_ts).map(u => ({ perk: u.perk, left: u.left }))
}

/** 记在一笔费用上的用量 */
export type Use = { perk_id: string; used: number; deduct: number }

/** 从费用金额里减去的钱：储值就是用量，次数不抵扣 */
export function deductOf(p: Perk, used: number): number {
  return p.kind === "balance" ? round2(used) : 0
}

/**
 * 勾上一张卡时的默认用量：储值取剩余和还没抵扣的金额中较小的（金额没填时取剩余）；次数 1 次（或 1 张）、不抵扣。
 * open：金额减去别的卡已经抵扣的钱；null 时金额还没填
 */
export function defaultUse(p: Perk, left: number, open: number | null): Use {
  if (p.kind === "balance") {
    const used = round2(Math.max(0, Math.min(left, open == null ? left : open)))
    return { perk_id: p.id, used, deduct: used }
  }
  return { perk_id: p.id, used: Math.min(1, left), deduct: 0 }
}

/**
 * 跟着金额走的储值（「用于记费用」预选的、在使用权益里新勾上还没手动改过的）：金额变了时重新取默认用量。
 * 依次分配：每一张只用别的卡抵扣后还剩的金额，抵扣合计不超过金额
 */
export function followAmount(uses: Use[], follow: string[], usable: Usable[], amount: number | null): Use[] {
  const fixed = uses.filter(u => !follow.includes(u.perk_id))
  let open = amount == null ? null : round2(amount - fixed.reduce((t, u) => t + u.deduct, 0))
  return uses.map(u => {
    if (!follow.includes(u.perk_id)) return u
    const x = usable.find(v => v.perk.id === u.perk_id)
    if (!x || x.perk.kind !== "balance") return u
    const next = defaultUse(x.perk, x.left, open == null ? null : Math.max(0, open))
    if (open != null) open = round2(open - next.deduct)
    return next
  })
}

/** 一次使用的写法（备注、使用记录）：「维修保养券抵扣 ¥1,000.00」「基础保养 1 次」 */
export function useText(p: Perk, u: { used: number; deduct: number }): string {
  return u.deduct > 0 ? `${p.name}抵扣 ${yuan(u.deduct)}` : `${p.name} ${u.used} ${p.unit}`
}

/** 导出到小熊时费用备注的最后一行：用了哪些权益和门店，「维修保养券抵扣 ¥1,000.00 · 基础保养 1 次 · 示例沃尔沃」；都没有时为空 */
export function usageLine(perks: Perk[], uses: Use[], storeName: string | null): string {
  const parts = uses.map(u => {
    const p = perks.find(x => x.id === u.perk_id)
    return p ? useText(p, u) : ""
  })
  return [...parts, storeName ?? ""].filter(Boolean).join(" · ")
}

/** 一笔费用用掉的卡 */
export function expenseUses(book: PerkBook, vehicleId: string, expenseId: string): PerkUse[] {
  const ids = new Set(vehiclePerks(book, vehicleId).map(p => p.id))
  return book.uses.filter(u => u.expense_id === expenseId && ids.has(u.perk_id))
}

/** 费用统计的权益抵扣：记在这辆车现存费用上、费用的时间在范围内的抵扣合计和次数（expenses：费用 id → 时间） */
export function deductSummary(book: PerkBook, vehicleId: string, expenses: Map<string, number>, from: number, to = Infinity): { total: number; count: number } {
  const ids = new Set(vehiclePerks(book, vehicleId).map(p => p.id))
  const list = book.uses.filter(u => {
    const ts = u.expense_id != null ? expenses.get(u.expense_id) : undefined
    return ts != null && ts >= from && ts <= to && u.deduct > 0 && ids.has(u.perk_id)
  })
  return { total: round2(list.reduce((t, u) => t + u.deduct, 0)), count: list.length }
}

// ---------- 添加和编辑 ----------

/** 同一来自里同名的卡（忽略空白和全角括号）；exceptId 排除自己 */
export function sameName(book: PerkBook, vehicleId: string, key: string, name: string, exceptId: string | null = null): Perk | null {
  const n = normalizeName(name)
  return batchPerks(book, vehicleId, key).find(p => p.id !== exceptId && normalizeName(p.name) === n) ?? null
}

/** 保存一张卡前的检查：名称、总量；用过的不能改类型，总量不能少于已用（只在改了总量时检查） */
export function perkErrors(next: Perk, before: Perk | null, used: number): string[] {
  const errors: string[] = []
  if (!next.name.trim()) errors.push("请填名称。")
  if (!(next.total > 0)) errors.push(next.kind === "balance" ? "请填金额。" : "请填次数。")
  if (before && used > 0 && before.kind !== next.kind) errors.push("已经用过，不能更改类型。")
  if (before && used > 0 && next.total !== before.total && next.total < used) {
    errors.push(`已用 ${perkAmount(next, used)}，总量不能少于已用。`)
  }
  return errors
}
