// 保险年度的纯逻辑（设计文档 20.4、20.6 节）：合计、期间、历年对比、缺的年份、关联费用、续保提醒。
// 保单上的时间都是北京时间，日期和年份一律按北京时间算，不用设备时区。
import { insurerPhone, insurerShort } from "./insurance_catalog"
import { markMatch, readPolicyPages } from "./policy_text"
import { ExpenseData, ExpenseRecord, InsuranceYear, LedgerRecord, Policy } from "./types"

/** 「保险和交通规费」：与小熊相同的类别编号 */
export const INSURANCE_CATEGORY = 100002

const DAY = 86400e3
const BJ_OFFSET = 8 * 3600e3
const round2 = (n: number) => Math.round(n * 100) / 100
/** 到期前多少天起提醒续保（徽章同时变橙） */
const RENEW_DAYS = 45

/** 合计 = 各份保单的含税保费 + 车船税 − 优惠 */
export function yearTotal(y: InsuranceYear): number {
  return round2(y.policies.reduce((s, p) => s + p.premium + (p.vehicle_tax ?? 0), 0) - y.discount)
}

/** 这一年存着的原件：各份保单和它的交强险标志，再是附件（保单详情「查看保单原件」；编辑时删掉去掉的） */
export function yearFiles(y: InsuranceYear): string[] {
  return [...y.policies.flatMap(p => [p.file, p.mark]), ...(y.attachments ?? [])].filter((f): f is string => !!f)
}

const IMAGE_FILE = /\.(jpe?g|png|heic|heif)$/i

/** 原件是不是图片（交强险标志可以是 JPG 等） */
export const isImageFile = (file: string) => IMAGE_FILE.test(file)

/** 「3 份 PDF、1 张图片」 */
export function fileCountText(files: string[]): string {
  const images = files.filter(isImageFile).length
  const pdfs = files.length - images
  return [pdfs ? `${pdfs} 份 PDF` : "", images ? `${images} 张图片` : ""].filter(Boolean).join("、")
}

// ---------- 交强险标志（1.5.0-beta.6，设计文档 20.5、20.6 节） ----------

/** 徽章：到期年月（北京时间）和颜色——有效、45 天内到期（与续保提醒同时出现）、已到期 */
export function markLook(end: number, now: number): { year: number; month: number; state: "ok" | "soon" | "past" } {
  const d = new Date(end + BJ_OFFSET)
  const left = daysLeft(end, now)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, state: left < 0 ? "past" : left <= RENEW_DAYS ? "soon" : "ok" }
}

/** 这一年徽章用的到期时间（交强险的；没有交强险时用这一年的）和标志原件 */
export function yearMark(y: InsuranceYear): { end: number; file: string | null } | null {
  const c = y.policies.find(p => p.kind === "compulsory" && p.end_ts)
  if (c) return { end: c.end_ts, file: c.mark ?? null }
  const p = yearPeriod(y)
  return p ? { end: p.end, file: null } : null
}

/** 升级用的读写：原件每页的文字（读不了或读不出文字时 null）；把原件的一页单独存一份，返回相对路径 */
export type MarkFiles = {
  pages: (file: string) => Promise<string[] | null>
  extract: (file: string, page: number) => Promise<string>
}

/**
 * 1.5.0-beta.6 之前存进来的标志：交强险 PDF 里的标志页拆出来单独存；附件里整份是标志的挂到对得上的交强险上。
 * 读不出文字的跳过（要显示出来截图，编辑那一年时重新选一次）。没有变化时返回 null
 */
export async function upgradeYearMarks(y: InsuranceYear, io: MarkFiles): Promise<InsuranceYear | null> {
  let policies = y.policies
  let changed = false
  for (const [i, p] of y.policies.entries()) {
    if (p.kind !== "compulsory" || p.mark || !p.file) continue
    const pages = await io.pages(p.file)
    const r = pages ? readPolicyPages(pages) : null
    if (r?.mark && r.mark.page != null && markMatch(r.mark.info, p)) {
      const mark = await io.extract(p.file, r.mark.page)
      policies = policies.map((x, j) => (j === i ? { ...x, mark } : x))
      changed = true
    }
  }
  const kept: string[] = []
  for (const f of y.attachments ?? []) {
    const pages = await io.pages(f)
    const r = pages ? readPolicyPages(pages) : null
    const found = r?.mark && r.mark.page == null ? r.mark.info : null
    const i = found ? policies.findIndex(p => !p.mark && markMatch(found, p)) : -1
    if (i >= 0) {
      policies = policies.map((x, j) => (j === i ? { ...x, mark: f } : x))
      changed = true
    } else kept.push(f)
  }
  if (!changed) return null
  const { attachments: _old, ...rest } = y
  return { ...rest, policies, ...(kept.length ? { attachments: kept } : {}) }
}

/** 详情和历年横条的三段：商业险、交强险和车船税、驾乘意外险及其他（不减优惠） */
export type Composition = { commercial: number; compulsory: number; other: number }

export function composition(y: InsuranceYear): Composition {
  let commercial = 0
  let compulsory = 0
  let other = 0
  for (const p of y.policies) {
    const amount = p.premium + (p.vehicle_tax ?? 0)
    if (p.kind === "commercial") commercial += amount
    else if (p.kind === "compulsory") compulsory += amount
    else other += amount
  }
  return { commercial: round2(commercial), compulsory: round2(compulsory), other: round2(other) }
}

/** 最早起保到最晚到期；还没有保单时为 null */
export function yearPeriod(y: InsuranceYear): { start: number; end: number } | null {
  if (!y.policies.length) return null
  return { start: Math.min(...y.policies.map(p => p.start_ts)), end: Math.max(...y.policies.map(p => p.end_ts)) }
}

const startOf = (y: InsuranceYear) => yearPeriod(y)?.start ?? y.paid_ts

/** 年份取最早起保日（北京时间）的年份 */
export function yearOf(y: InsuranceYear): number {
  return new Date(startOf(y) + BJ_OFFSET).getUTCFullYear()
}

/** 代表这一年的保单：商业险，没有就交强险，再没有就第一份 */
function mainPolicy(y: InsuranceYear): Policy | null {
  return y.policies.find(p => p.kind === "commercial") ?? y.policies.find(p => p.kind === "compulsory") ?? y.policies[0] ?? null
}

export function yearInsurer(y: InsuranceYear): string {
  const p = mainPolicy(y)
  return p ? insurerShort(p.insurer) : ""
}

/** 「2026 车险 · 中国平安」 */
export function yearLabel(y: InsuranceYear): string {
  const insurer = yearInsurer(y)
  return `${yearOf(y)} 车险${insurer ? ` · ${insurer}` : ""}`
}

/** 报案电话：先用保单上读到的，没有时按保险公司 */
export function yearPhone(y: InsuranceYear): string | null {
  const main = mainPolicy(y)
  return main?.phone ?? y.policies.find(p => p.phone)?.phone ?? (main ? insurerPhone(main.insurer) : null)
}

/** 一辆车的保险，按起保日从新到旧 */
export function insuranceYears(all: InsuranceYear[] | undefined, vehicleId: string): InsuranceYear[] {
  return (all ?? []).filter(y => y.vehicle_id === vehicleId).sort((a, b) => startOf(b) - startOf(a))
}

/** 保险期间包含 now 的那一年 */
export function currentInsurance(years: InsuranceYear[], now: number): InsuranceYear | null {
  return years.find(y => {
    const p = yearPeriod(y)
    return !!p && p.start <= now && now <= p.end
  }) ?? null
}

/** 起保日早于 y 的最近一年（years 按起保日从新到旧） */
export function previousInsurance(years: InsuranceYear[], y: InsuranceYear): InsuranceYear | null {
  return years.find(x => x.id !== y.id && startOf(x) < startOf(y)) ?? null
}

/** 到期还有几天（北京时间的日期差）；已过期为负数 */
export function daysLeft(end: number, now: number): number {
  const day = (t: number) => Math.floor((t + BJ_OFFSET) / DAY)
  return day(end) - day(now)
}

/**
 * 缺的年份（从新到旧）：相邻两年之间空了 30 天以上，中间的年份都算缺。
 * 缺口里有只记了金额的保险费用时不算缺（它在「只有金额」一组里）。
 */
export function yearGaps(years: InsuranceYear[], amountOnly: ExpenseRecord[]): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < years.length; i++) {
    const later = yearPeriod(years[i])
    const earlier = yearPeriod(years[i + 1])
    if (!later || !earlier || later.start - earlier.end <= 30 * DAY) continue
    if (amountOnly.some(r => r.ts > earlier.end - 60 * DAY && r.ts < later.start)) continue
    for (let y = yearOf(years[i]) - 1; y > yearOf(years[i + 1]); y--) out.push(y)
  }
  return out
}

/** 只记了金额的保险费用：类别「保险和交通规费」、备注里有「险」、没有被任何一年的保险关联（从新到旧） */
export function amountOnlyExpenses(records: LedgerRecord[], years: InsuranceYear[]): Array<ExpenseRecord & LedgerRecord> {
  const linked = new Set(years.map(y => y.expense_id).filter((id): id is string => !!id))
  return records
    .filter((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.category_id === INSURANCE_CATEGORY && /险/.test(r.remark) && !linked.has(r.id))
    .sort((a, b) => b.ts - a.ts)
}

/**
 * 记保险时可以「补到」的已有费用：付款日期前后 45 天内、类别「保险和交通规费」、没有被别的保险关联；按日期远近排。
 * editingId 是正在编辑的那一年（它自己关联的费用也算候选）
 */
export function expenseCandidates(records: LedgerRecord[], years: InsuranceYear[], paidTs: number, editingId: string | null): Array<ExpenseRecord & LedgerRecord> {
  const linked = new Set(years.filter(y => y.id !== editingId).map(y => y.expense_id).filter((id): id is string => !!id))
  return records
    .filter((r): r is ExpenseRecord & LedgerRecord =>
      r.kind === "expense" && r.category_id === INSURANCE_CATEGORY && !linked.has(r.id) && Math.abs(r.ts - paidTs) <= 45 * DAY)
    .sort((a, b) => Math.abs(a.ts - paidTs) - Math.abs(b.ts - paidTs))
}

/** 关联了这条费用记录的那一年 */
export function insuranceForRecord(years: InsuranceYear[] | undefined, recordId: string): InsuranceYear | null {
  return (years ?? []).find(y => y.expense_id === recordId) ?? null
}

/**
 * 续保提醒：最新一年的保险到期前 days 天起、到期后 30 天内，没有点过「×」时提醒。
 * 记了下一年后，最新一年就是新的那一年，自然不再提醒。
 */
export function renewalDue(years: InsuranceYear[], now: number, dismissed: string[], days = RENEW_DAYS): { year: InsuranceYear; daysLeft: number } | null {
  const latest = [...years].sort((a, b) => startOf(b) - startOf(a))[0]
  if (!latest || dismissed.includes(latest.id)) return null
  const p = yearPeriod(latest)
  if (!p) return null
  const left = daysLeft(p.end, now)
  return left > days || left < -30 ? null : { year: latest, daysLeft: left }
}

export type ItemPrev = { amount: number | null; premium: number | null; times: number | null }

/** 按统一名称找上一年的同一项（这一年有的才找） */
export function itemCompare(y: InsuranceYear, prev: InsuranceYear | null): Map<string, ItemPrev> {
  const out = new Map<string, ItemPrev>()
  if (!prev) return out
  const keys = new Set(y.policies.flatMap(p => p.items.map(i => i.key)).filter((k): k is string => !!k))
  for (const p of prev.policies) {
    for (const i of p.items) {
      if (i.key && keys.has(i.key) && !out.has(i.key)) out.set(i.key, { amount: i.amount, premium: i.premium, times: i.times })
    }
  }
  return out
}

/** 这一年对应的费用：类别「保险和交通规费」，金额是合计，时间是付款日期，备注是年份和保险公司（加上用户的备注） */
export function expenseFor(y: InsuranceYear): ExpenseData {
  return { ts: y.paid_ts, category_id: INSURANCE_CATEGORY, amount: yearTotal(y), remark: [yearLabel(y), y.remark.trim()].filter(Boolean).join("\n") }
}

// ---------- 显示 ----------

/** 北京时间的日期「2026/1/7」 */
export function policyDate(ts: number): string {
  const d = new Date(ts + BJ_OFFSET)
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

export function periodText(p: { start: number; end: number } | null): string {
  return p ? `${policyDate(p.start)} – ${policyDate(p.end)}` : "—"
}

/** 保额、限额：整万写「300 万」，其余写「180,000.50」 */
export function amountText(n: number): string {
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000} 万`
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

export const KIND_TITLES: Record<Policy["kind"], string> = { compulsory: "交强险", commercial: "商业险", accident: "驾乘意外险", other: "其他保单" }

/** 浮动比率「+10%」「−40%」「0%」 */
export function floatText(rate: number): string {
  return rate > 0 ? `+${rate}%` : rate < 0 ? `−${-rate}%` : "0%"
}

/** 比上一年「+55.2%」「−25.6%」 */
export function changeText(cur: number, prev: number): string {
  const d = (cur / prev - 1) * 100
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}%`
}

/** 北京时间的「1月6日」（续保提醒用） */
export function monthDayText(ts: number): string {
  const d = new Date(ts + BJ_OFFSET)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}
