// 识别结果 + 加油停车 + 油价 → 记加油表单的草稿（设计文档 16.4、16.5、16.7 节）。纯函数。
import { round2 } from "./fuel"
import {
  amountConsistent, GradeByPrice, gradeByPrice, gradeFromText, mergeTransactions, MergedTransactions, num, parseReceiptTime, PriceRef,
  ReceiptResult, sameStationName,
} from "./receipt"
import { chooseStop, Stop } from "./stops"
import { fmtShort } from "./time"
import { FuelRecord } from "./types"

/** 字段的来源。截图、照片、拍照、行程是直接读到的；油价、近期、推算是推断出来的，带 ⓘ */
export type FieldSource = "screenshot" | "photo" | "camera" | "trip" | "price" | "usual" | "derived"

export const SOURCE_TITLES: Record<FieldSource, string> = {
  screenshot: "截图", photo: "照片", camera: "拍照", trip: "行程", price: "油价", usual: "近期", derived: "推算",
}

export const isInferred = (s: FieldSource) => s === "price" || s === "usual" || s === "derived"

/** 图片从哪里来：拍照时的时间可靠，可以当作付款时间 */
export type ImageOrigin = "camera" | "library" | "paste"

export type MoneyField = "price" | "liters" | "amount" | "paid"

export type ReceiptFill = {
  /** 直接从图上读到的字段用的标记：截图、照片或拍照 */
  source: FieldSource
  price: number | null
  liters: number | null
  amount: number | null
  paid: number | null
  /** 图上没有、由其他项算出来的字段 */
  derived: MoneyField[]
  /** 记录时间：图上印的交易时间，拍照时是拍照时间 */
  ts: number | null
  tsSource: FieldSource | null
  /** 付款时间（有时用来匹配加油停车） */
  payTs: number | null
  printedGrade: number | null
  station: string | null
  merged: MergedTransactions
}

/** 第一步：只看识别结果。图上没有加油交易时返回 null */
export function fillFromReceipt(r: ReceiptResult, origin: ImageOrigin, captureTs: number | null, now: number): ReceiptFill | null {
  if (r.doc_type === "other") return null
  const merged = mergeTransactions(r.transactions)
  const t = merged.tx
  if (!t) return null
  const source: FieldSource = origin === "camera" ? "camera" : r.doc_type === "fuel_screenshot" ? "screenshot" : "photo"
  const derived: MoneyField[] = []
  let price = num(t.price)
  let liters = num(t.liters)
  let amount = num(t.amount)
  if (price && liters && amount == null) { amount = round2(price * liters); derived.push("amount") }
  if (price && amount && liters == null) { liters = round2(amount / price); derived.push("liters") }
  if (liters && amount && price == null) { price = round2(amount / liters); derived.push("price") }
  let paid = num(t.paid)
  if (paid == null && amount != null) {
    const discount = num(t.discount)
    paid = discount ? round2(amount - discount) : amount
    derived.push("paid")
  }
  // 图上的时间不应晚于现在（读错的年份、未来时间都不用）
  const printed = parseReceiptTime(t.time)
  let ts: number | null = null
  let tsSource: FieldSource | null = null
  if (printed != null && printed <= now + 10 * 60e3) { ts = printed; tsSource = source }
  else if (origin === "camera" && captureTs != null) { ts = captureTs; tsSource = "camera" }
  return {
    source, price, liters, amount, paid, derived, ts, tsSource, payTs: ts,
    printedGrade: gradeFromText(t.grade), station: t.station || null, merged,
  }
}

export type StopChoice = { stop: Stop; kind: "refuel" | "trip" } | null

/** 第二步：有付款时间时，取付款前 3 小时内最近的一次加油停车；没有时取这段时间里最近的一段行程 */
export function stopForPayment(stops: Stop[], payTs: number): StopChoice {
  return chooseStop(stops, payTs)
}

export type GradeDecision = {
  grade: number
  source: FieldSource
  byPrice: GradeByPrice | null
  ref: PriceRef | null
  /** 图上印的标号与当天油价不符 */
  conflict: boolean
}

/** 第三步：标号。图上印的 → 按单价对照当天油价 → 近期最常加的 */
export function decideGrade(printed: number | null, imageSource: FieldSource, price: number | null, ref: PriceRef | null, usual: number): GradeDecision {
  const byPrice = gradeByPrice(price, ref)
  if (printed != null) return { grade: printed, source: imageSource, byPrice, ref, conflict: !!(byPrice && byPrice.sure && byPrice.grade !== printed) }
  if (byPrice && byPrice.sure) return { grade: byPrice.grade, source: "price", byPrice, ref, conflict: false }
  return { grade: usual, source: "usual", byPrice, ref, conflict: false }
}

const yuan = (n: number) => `${n.toFixed(2)} 元`
const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)} 元`

/** 点「油价 ⓘ」「近期 ⓘ」时显示的依据 */
export function gradeEvidence(d: GradeDecision, price: number | null): string {
  const rule = "95# 通常比 92# 高 0.43–0.56 元，98# 高 2.45–2.57 元。"
  const ref = d.ref
  const line = ref && price ? `本次单价 ${yuan(price)}，当天${ref.city} 92# ${yuan(ref.p92)}，差价 ${signed(price - ref.p92)}。` : ""
  if (d.source === "price") return `${line}\n按 ${d.grade}# 计。${rule}`
  if (d.source === "usual") {
    return [ref ? line : "没有当天的油价，无法按单价判断。", `图上没有标号，按近期最常加的 ${d.grade}# 填写。`].filter(Boolean).join("\n")
  }
  if (d.conflict && d.byPrice) return `图上印的是 ${d.grade}#。${line}\n单价更接近 ${d.byPrice.grade}#，请核对。${rule}`
  return ""
}

/** 点「推算 ⓘ」时显示的依据 */
export function derivedEvidence(field: MoneyField, f: ReceiptFill): string {
  if (field === "paid") return f.amount != null && f.paid !== f.amount ? "图上没有实付，按机显金额减去优惠计算。" : "图上没有实付，按机显金额填写。"
  if (field === "amount") return "图上没有金额，按单价 × 升数计算。"
  if (field === "liters") return "图上没有升数，按金额 ÷ 单价计算。"
  return "图上没有单价，按金额 ÷ 升数计算。"
}

/** 金额核对不通过时的两种改法（不知道是哪一项读错，请对照原图选择） */
export function amountFixes(price: number, liters: number, amount: number): { amount: number; liters: number } | null {
  if (!(price > 0 && liters > 0 && amount > 0) || amountConsistent(price, liters, amount)) return null
  return { amount: round2(price * liters), liters: round2(amount / price) }
}

/** 已有的相近记录：10 分钟内，或同一天同金额 */
export function findDuplicate(fuel: FuelRecord[], ts: number, amount: number | null, selfId?: string): FuelRecord | null {
  const day = new Date(ts).toDateString()
  return fuel.find(r => r.id !== selfId && (
    Math.abs(r.ts - ts) <= 10 * 60e3
    || (amount != null && new Date(r.ts).toDateString() === day && Math.abs(r.amount - amount) < 0.011)
  )) || null
}

/** 识别和匹配之后需要用户留意的地方（标橙，可以保存） */
export function fillWarnings(input: {
  fill: ReceiptFill
  choice: StopChoice
  stops: Stop[] | null
  tripsOn: boolean
  stationName: string | null
  grade: GradeDecision
}): string[] {
  const { fill, choice, stops, tripsOn, stationName, grade } = input
  const out: string[] = []
  if (fill.merged.merged) out.push(`图上有 ${fill.merged.parts.length} 笔付款，单价相同、时间相近，已合并为一条`)
  if (fill.merged.unmerged) out.push(`图上有 ${fill.merged.parts.length} 笔交易，只用了第一笔`)
  if (grade.conflict && grade.byPrice) out.push(`图上印的是 ${grade.grade}#，但单价更接近当天 ${grade.byPrice.grade}# 的油价`)
  if (grade.source === "usual") out.push("未能判断标号，已按近期记录填写")
  if (fill.station && stationName && !sameStationName(fill.station, stationName)) out.push(`图片上的油站「${fill.station}」与停车位置的油站不一致`)
  if (tripsOn && fill.payTs != null) {
    if (choice && choice.kind === "trip") out.push("付款前没有找到加油停车，已用最近一段行程，请核对里程")
    if (!choice && stops) out.push("行程里还没有这次加油（可能还没同步），请手动填写里程")
    if (stops) {
      const others = stops.filter(s => s.refuel && !s.recorded && (!choice || s.end_ts !== choice.stop.end_ts) && fill.payTs! - s.end_ts < 7 * 86400e3)
      if (others.length) out.push(`近 7 天还有 ${others.length} 次没记录的加油停车（${others.map(s => fmtShort(s.end_ts)).join("、")}），可以点「更换」切换`)
    }
  }
  return out
}
