// 加油小票、付款截图、加油机照片的识别结果，以及与识别引擎无关的处理（设计文档 16.3、16.4 节）。
// 规则来自油猴脚本 v0.3.x，用 120 张历史小票验证过。纯函数。
import { amountTolerance } from "./form"
import { round2 } from "./fuel"
import { GRADES } from "./types"

export type ReceiptDocType = "fuel_receipt" | "fuel_screenshot" | "pump_display" | "other"

/** 图上的一笔加油交易；看不到的填 null */
export type ReceiptTransaction = {
  grade: string | null
  product_code: string | null
  price: number | null
  liters: number | null
  amount: number | null
  discount: number | null
  paid: number | null
  /** YYYY-MM-DD HH:MM:SS（北京时间） */
  time: string | null
  station: string | null
  payment: string | null
}

export type ReceiptResult = {
  doc_type: ReceiptDocType
  /** 一张图可能有多笔（两张小票、分两次付款） */
  transactions: ReceiptTransaction[]
  note: string | null
  engine: string
  seconds: number
  model?: string
}

export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^\d.\-]/g, ""))
  return Number.isFinite(n) ? n : null
}

/** 小票上的时间按北京时间解析：「2026-10-18 09:26:41」「2026/10/18 09:26」「2026年10月18日 09:26」 */
export function parseReceiptTime(text: string | null | undefined): number | null {
  const m = String(text || "").trim().match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (!m) return null
  const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +(m[6] || 0))
  return Number.isFinite(ts) ? ts : null
}

/** 图上印的标号：「95#」「92号」「98号车用汽油」「0#柴油」 */
export function gradeFromText(text: string | null | undefined): number | null {
  const m = String(text || "").match(/(?:^|[^\d])(\d{1,2})\s*(?:#|＃|号)/)
  if (!m) return null
  const g = Number(m[1])
  return GRADES.includes(g) ? g : null
}

/** 单价 × 升数 ≈ 金额（误差 单价 × 0.01 + 0.01，预设金额、卡余额用完时小票本身就差这么多） */
export function amountConsistent(price: number, liters: number, amount: number): boolean {
  return Math.abs(price * liters - amount) <= amountTolerance(price)
}

// ---------- 按单价判断标号 ----------

/** 当天当地的油价：92# 和 95#（95# 没有时按 92# + 0.5） */
export type PriceRef = { p92: number; p95: number; city: string; current: boolean }

export type GradeByPrice = { grade: number; sure: boolean; diff: number }

/**
 * 2023-10 至 2026-10 的 103 条记录：95# 比 92# 高 0.43–0.56 元，98# 比 92# 高 2.45–2.57 元，两段不重叠。
 * 不确定时（离两边都近或都远）sure 为 false。
 */
export function gradeByPrice(price: number | null, ref: PriceRef | null): GradeByPrice | null {
  if (!ref || !ref.p92 || !price) return null
  const diff = round2(price - ref.p92)
  if (price >= ref.p95 + 0.8) return { grade: 98, sure: true, diff }
  const d92 = Math.abs(price - ref.p92)
  const d95 = Math.abs(price - ref.p95)
  if (d92 <= 0.2 && d95 >= 0.3) return { grade: 92, sure: true, diff }
  if (d95 <= 0.2 && d92 >= 0.3) return { grade: 95, sure: true, diff }
  return { grade: d92 < d95 ? 92 : 95, sure: false, diff }
}

/** 当前官方油价（小熊的 fetchcityprices）和城市页面里的历史 92# 油价 → 某个时刻的油价 */
export type CityPrices = { official: Record<string, number>; city: string }

export function priceRefAt(current: CityPrices | null, history: Array<[number, number]>, atMs: number, city: string): PriceRef | null {
  const off = current && current.official["95"] && current.official["92"] ? current.official["95"] - current.official["92"] : 0.5
  let p92: number | null = null
  for (const [ms, p] of history) if (ms <= atMs) p92 = p
  if (p92 == null) {
    if (history.length && atMs < history[0][0]) return null // 早于油价历史，无法判断
    if (current && current.official["92"]) p92 = current.official["92"]
  }
  if (p92 == null) return null
  const isCurrent = !history.length || history[history.length - 1][0] <= atMs
  return { p92, p95: round2(p92 + (Number.isFinite(off) && off > 0 ? off : 0.5)), city: current ? current.city : city, current: isCurrent }
}

// ---------- 多笔交易 ----------

export type MergedTransactions = {
  tx: ReceiptTransaction | null
  parts: ReceiptTransaction[]
  /** 同一次加油分两次付款，已合并 */
  merged: boolean
  /** 多笔但不像同一次加油：只用了第一笔 */
  unmerged: boolean
}

/** 同一次加油分两次支付（卡余额不足、加满后续加）：单价相同、相隔不超过 15 分钟，合并成一笔 */
export function mergeTransactions(txs: ReceiptTransaction[]): MergedTransactions {
  const list = txs.filter(t => t && (num(t.price) || num(t.liters) || num(t.amount)))
  if (list.length <= 1) return { tx: list[0] || null, parts: list, merged: false, unmerged: false }
  const times = list.map(t => parseReceiptTime(t.time))
  const price = num(list[0].price)
  const samePrice = price != null && list.every(t => num(t.price) != null && Math.abs((num(t.price) as number) - price) < 0.006)
  const known = times.filter((t): t is number => t != null)
  const close = known.length === list.length && Math.max(...known) - Math.min(...known) <= 15 * 60e3
  if (!samePrice || !close) return { tx: list[0], parts: list, merged: false, unmerged: true }
  const sum = (k: "liters" | "amount" | "paid" | "discount") =>
    list.every(t => num(t[k]) != null) ? round2(list.reduce((s, t) => s + (num(t[k]) as number), 0)) : null
  const first = list[times.indexOf(Math.min(...known))]
  return {
    tx: { ...first, liters: sum("liters"), amount: sum("amount"), paid: sum("paid"), discount: sum("discount") },
    parts: list,
    merged: true,
    unmerged: false,
  }
}

/**
 * 识别结果能不能直接用（16.3 节）：读到单价、升数、金额并且核对通过；实付不大于金额；截图读到了交易时间。
 * 本机识别不满足时交给下一个引擎。
 */
export function receiptUsable(r: ReceiptResult): boolean {
  if (r.doc_type === "other") return false
  const m = mergeTransactions(r.transactions)
  // 多笔但不像同一次加油（单价不同、时间相隔太久、有一笔读不全）：不知道用哪一笔，交给下一个引擎
  if (m.unmerged) return false
  const t = m.tx
  if (!t) return false
  const price = num(t.price)
  const liters = num(t.liters)
  const amount = num(t.amount)
  const paid = num(t.paid)
  if (!(price && liters && amount) || !amountConsistent(price, liters, amount)) return false
  if (paid != null && !(paid > 0 && paid <= amount + 0.01)) return false
  if (r.doc_type === "fuel_screenshot" && parseReceiptTime(t.time) == null) return false
  return true
}

/** 读到的内容多少：引擎都不理想时，用读到最多的那个结果 */
export function receiptScore(r: ReceiptResult): number {
  const t = mergeTransactions(r.transactions).tx
  if (!t || r.doc_type === "other") return 0
  return ["price", "liters", "amount", "paid", "time", "grade", "station"].filter(k => t[k as keyof ReceiptTransaction] != null).length
}

const coreName = (s: string | null | undefined) =>
  String(s || "").replace(/中国石化|中石化|中国石油|中石油|销售|有限公司|加油站|加油加气站|加气站|服务区|股份|[()（）\s·\-]/g, "")

/** 油站名是否一致：去掉「中国石化」「加油站」等通用词后互相包含 */
export function sameStationName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = coreName(a)
  const y = coreName(b)
  return !!(x && y && (x.includes(y) || y.includes(x)))
}
