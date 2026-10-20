// 保险年度的纯逻辑（设计文档 20.4、20.6 节）：合计、期间、历年对比、缺的年份、关联费用、续保提醒。
// 保单上的时间都是北京时间，日期和年份一律按北京时间算，不用设备时区。
import { insurerPhone, insurerShort } from "./insurance_catalog"
import { ExpenseData, ExpenseRecord, InsuranceYear, LedgerRecord, Policy } from "./types"

/** 「保险和交通规费」：与小熊相同的类别编号 */
export const INSURANCE_CATEGORY = 100002

const DAY = 86400e3
const BJ_OFFSET = 8 * 3600e3
const round2 = (n: number) => Math.round(n * 100) / 100

/** 合计 = 各份保单的含税保费 + 车船税 − 优惠 */
export function yearTotal(y: InsuranceYear): number {
  return round2(y.policies.reduce((s, p) => s + p.premium + (p.vehicle_tax ?? 0), 0) - y.discount)
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
export function renewalDue(years: InsuranceYear[], now: number, dismissed: string[], days = 45): { year: InsuranceYear; daysLeft: number } | null {
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
