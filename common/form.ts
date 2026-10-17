// 记录表单的计算与核对（纯函数）
import { FuelData, FuelRecord } from "./types"
import { fuelSegments, round2 } from "./fuel"

export type TripleField = "price" | "liters" | "amount"
export type Triple = { price: number | null; liters: number | null; amount: number | null }

export const CONSUMPTION_MIN = 4
export const CONSUMPTION_MAX = 25

/** 解析用户输入的数字，允许「¥」「,」等多余字符；空或无效返回 null */
export function parseNum(text: string | null | undefined): number | null {
  const s = String(text ?? "").replace(/[^\d.\-]/g, "")
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function numText(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return ""
  return String(Number(n.toFixed(digits)))
}

/**
 * 单价、升数、金额任填两项算第三项。
 * edited 是用户最近手动改过的字段（新的在后）；最近两项为准，算剩下的那一项。
 */
export function completeTriple(values: Triple, edited: TripleField[]): { values: Triple; computed: TripleField | null } {
  const recent = Array.from(new Set(edited.slice().reverse())).slice(0, 2)
  if (recent.length < 2) return { values, computed: null }
  const target = (["price", "liters", "amount"] as TripleField[]).find(f => !recent.includes(f)) as TripleField
  const { price, liters, amount } = values
  const out = { ...values }
  if (target === "amount" && price && liters) out.amount = round2(price * liters)
  else if (target === "liters" && price && amount) out.liters = round2(amount / price)
  else if (target === "price" && liters && amount) out.price = round2(amount / liters)
  else return { values, computed: null }
  return { values: out, computed: target }
}

/** 单价 × 升数 与金额允许的误差 */
export function amountTolerance(price: number): number {
  return price * 0.01 + 0.01
}

export type CheckResult = { errors: string[]; warnings: string[]; consumption: number | null }

/**
 * 核对一条加油记录。others 是同一辆车的其他加油记录（不含正在编辑的这条）。
 * 错误不能保存；警告需要确认。
 */
export function checkFuel(data: FuelData, others: FuelRecord[], selfId = "__draft__"): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  if (!(data.odometer > 0)) errors.push("请填写里程")
  if (!Number.isInteger(data.odometer)) errors.push("里程须为整数公里")
  if (!(data.price > 0)) errors.push("请填写单价")
  if (!(data.liters > 0)) errors.push("请填写升数")
  if (!(data.amount > 0)) errors.push("请填写机显金额")
  if (!(data.paid >= 0)) errors.push("实付金额无效")
  if (data.grade == null) errors.push("请选择标号")

  const sorted = others.slice().sort((a, b) => a.ts - b.ts)
  const prev = sorted.filter(r => r.ts <= data.ts).pop()
  const next = sorted.find(r => r.ts > data.ts)
  if (data.odometer > 0) {
    if (prev && data.odometer <= prev.odometer) errors.push(`里程须大于上一次加油的 ${prev.odometer} 公里`)
    if (next && data.odometer >= next.odometer) errors.push(`里程须小于下一次加油的 ${next.odometer} 公里`)
  }
  if (data.price > 0 && data.liters > 0 && data.amount > 0) {
    const diff = Math.abs(data.price * data.liters - data.amount)
    if (diff > amountTolerance(data.price)) warnings.push(`单价 × 升数 = ${round2(data.price * data.liters)}，与机显金额相差 ${round2(diff)} 元`)
  }
  if (data.paid > data.amount && data.amount > 0) warnings.push("实付金额大于机显金额")

  let consumption: number | null = null
  if (!errors.length) {
    const draft: FuelRecord = { ...data, kind: "fuel", id: selfId, vehicle_id: "" }
    const seg = fuelSegments([...others, draft]).find(s => s.to.id === selfId)
    if (seg) {
      consumption = seg.consumption
      if (consumption < CONSUMPTION_MIN || consumption > CONSUMPTION_MAX) {
        warnings.push(`本次油耗 ${consumption.toFixed(2)} L/100km 不在 ${CONSUMPTION_MIN}–${CONSUMPTION_MAX} 之间，请检查里程和升数`)
      }
    }
  }
  return { errors, warnings, consumption }
}

export function checkExpense(amount: number | null): string[] {
  return amount && amount > 0 ? [] : ["请填写金额"]
}
