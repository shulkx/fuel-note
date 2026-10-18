// 识别引擎：Scripting 助手（Assistant.requestStructuredData），用用户在 Scripting 里配置的模型账号（OpenAI 等），
// 油记不保存它的凭据。提示词与 Azure 相同；Scripting 的 JSON Schema 没有 null 和枚举，所以看不到的字段让模型省略，
// 结果在这里整理成与 Azure 相同的识别结果。纯逻辑；调用 Assistant 的部分在 platform/assistant.ts。
import { num, ReceiptDocType, ReceiptResult, ReceiptTransaction } from "../common/receipt"
import { RECOGNIZE_PROMPT } from "./azure"

/** Scripting 的 JSON Schema（与它的 JSONSchemaObject 等结构相同） */
type SchemaPrimitive = { type: "string" | "number" | "boolean"; required?: boolean; description: string }
type SchemaArray = { type: "array"; items: Schema; required?: boolean; description: string }
type SchemaObject = { type: "object"; properties: Record<string, Schema>; required?: boolean; description: string }
type Schema = SchemaPrimitive | SchemaArray | SchemaObject

/** 与 Azure 的提示词只差「填 null」改为省略 */
export const PROMPT_CHANGES: Array<[string, string]> = [
  ["看不清或没有的字段填 null", "看不清或没有的字段省略不填"],
  ["没有标号时填 null", "没有标号时省略"],
  ["没有填 null", "没有就省略"],
]

export const ASSISTANT_PROMPT = PROMPT_CHANGES.reduce((p, [from, to]) => p.replace(from, to), RECOGNIZE_PROMPT)

const str = (description: string): SchemaPrimitive => ({ type: "string", description })
const number = (description: string): SchemaPrimitive => ({ type: "number", description })

export const ASSISTANT_SCHEMA: SchemaObject = {
  type: "object",
  description: "加油单据的识别结果",
  properties: {
    doc_type: { type: "string", required: true, description: "fuel_receipt、fuel_screenshot、pump_display、other 之一" },
    transactions: {
      type: "array",
      required: true,
      description: "图上的每一笔加油交易；非加油单据为空数组",
      items: {
        type: "object",
        description: "一笔加油交易",
        properties: {
          grade: str("油品标号原文，如 95#、92号"),
          product_code: str("油品代码原文，如 1052"),
          price: number("单价（元/升）"),
          liters: number("升数"),
          amount: number("应付金额（优惠前）"),
          discount: number("优惠金额合计"),
          paid: number("实付金额（优惠后）"),
          time: str("交易时间 YYYY-MM-DD HH:MM:SS"),
          station: str("加油站名称"),
          payment: str("支付方式原文"),
        },
      },
    },
    note: str("其他需要说明的情况"),
  },
}

/** 测试连接用：只要求回一个布尔值 */
export const PING_SCHEMA: SchemaObject = {
  type: "object",
  description: "连接测试",
  properties: { ok: { type: "boolean", required: true, description: "固定为 true" } },
}

const DOC_TYPES: ReceiptDocType[] = ["fuel_receipt", "fuel_screenshot", "pump_display", "other"]

/** 省略、空字符串和字面的 "null" 都算没有 */
function text(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v !== "string") return null
  const s = v.trim()
  return s && s.toLowerCase() !== "null" ? s : null
}

function transaction(o: Record<string, unknown>): ReceiptTransaction {
  return {
    grade: text(o.grade),
    product_code: text(o.product_code),
    price: num(o.price),
    liters: num(o.liters),
    amount: num(o.amount),
    discount: num(o.discount),
    paid: num(o.paid),
    time: text(o.time),
    station: text(o.station),
    payment: text(o.payment),
  }
}

/** 模型返回的 JSON → 识别结果。doc_type 不认识时：有交易算小票，没有算非加油单据 */
export function fromAssistant(raw: unknown, seconds: number, model: string): ReceiptResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(r.transactions) ? r.transactions : []
  const transactions = list.filter(o => o && typeof o === "object").map(o => transaction(o as Record<string, unknown>))
  const doc = DOC_TYPES.find(d => d === r.doc_type) ?? (transactions.length ? "fuel_receipt" : "other")
  return { doc_type: doc, transactions: doc === "other" ? [] : transactions, note: text(r.note), engine: "assistant", seconds, ...(model ? { model } : {}) }
}
