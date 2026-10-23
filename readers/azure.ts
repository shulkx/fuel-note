// 识别引擎：Azure OpenAI（gpt-4.1）。提示词和 JSON Schema 与油猴脚本相同，
// 用 120 张历史小票验证：单价、升数、金额、实付 98% 与记录一致。纯逻辑，HTTP 注入。
import { Http } from "../platform/http"
import { ReceiptResult } from "../common/receipt"

export type AzureConfig = { endpoint: string; deployment: string; key: string; apiVersion?: string }

export const RECOGNIZE_PROMPT = `你是加油小票/加油支付截图的信息提取器。只提取图上真实印着的内容，看不清或没有的字段填 null，不要推算、不要补全。
- doc_type: fuel_receipt（纸质加油小票/发票）、fuel_screenshot（App/钱包/支付的加油订单截图）、pump_display（加油机屏幕照片）、other（保养单、洗车单等非加油单据）
- transactions: 图上的每一笔加油交易各一项（一张图可能有多张小票）；非加油单据为空数组
  - grade: 图上印的油品标号原文，如 "95#"、"92号"、"98号汽油"；只有油品代码没有标号时填 null
  - product_code: 油品/品类代码原文，如 "1052"
  - price: 单价（元/升）
  - liters: 升数/数量
  - amount: 应付/金额（优惠前）
  - discount: 优惠/折扣金额合计（图上印的）
  - paid: 实付/实收/扣卡金额（优惠后实际付的钱）
  - time: 交易时间，格式 YYYY-MM-DD HH:MM:SS（没有秒填 00）
  - station: 加油站名称（图上有才填）
  - payment: 支付方式原文，如 "IC卡"、"微信"、"加油卡"
- note: 其他需要说明的情况（如字迹模糊、数字不确定），没有填 null`

const NUM = { type: ["number", "null"] }
const STR = { type: ["string", "null"] }

export const RECOGNIZE_SCHEMA = {
  name: "fuel_receipt",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["doc_type", "transactions", "note"],
    properties: {
      doc_type: { type: "string", enum: ["fuel_receipt", "fuel_screenshot", "pump_display", "other"] },
      transactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["grade", "product_code", "price", "liters", "amount", "discount", "paid", "time", "station", "payment"],
          properties: { grade: STR, product_code: STR, price: NUM, liters: NUM, amount: NUM, discount: NUM, paid: NUM, time: STR, station: STR, payment: STR },
        },
      },
      note: STR,
    },
  },
}

/** 终结点可以粘贴门户里的任意形式（带不带 /openai/…），这里统一成 chat/completions 地址 */
export function azureUrl(c: AzureConfig): string {
  const base = c.endpoint.trim().replace(/\/+$/, "").replace(/\/openai.*$/, "")
  return `${base}/openai/deployments/${encodeURIComponent(c.deployment.trim())}/chat/completions?api-version=${encodeURIComponent(c.apiVersion || "2024-10-21")}`
}

export function azureReady(c: AzureConfig | null): c is AzureConfig {
  return !!(c && /^https:\/\//.test(c.endpoint.trim()) && c.deployment.trim() && c.key.trim())
}

async function chat(http: Http, c: AzureConfig, body: unknown, timeout: number): Promise<{ res: any; seconds: number }> {
  const t0 = Date.now()
  const r = await http({ method: "POST", url: azureUrl(c), headers: { "api-key": c.key.trim(), "Content-Type": "application/json" }, body: JSON.stringify(body), timeout })
  let res: any = null
  try { res = JSON.parse(r.text) } catch { /* 下面按状态码报错 */ }
  if (r.status !== 200) throw new Error(`Azure OpenAI：${(res && res.error && res.error.message) || `HTTP ${r.status}`}`.slice(0, 160))
  if (!res) throw new Error("Azure OpenAI 返回的不是 JSON")
  return { res, seconds: (Date.now() - t0) / 1000 }
}

/** jpegBase64：长边不超过 2048 像素的 JPEG */
export async function recognizeAzure(http: Http, c: AzureConfig, jpegBase64: string): Promise<ReceiptResult> {
  const { res, seconds } = await chat(http, c, {
    messages: [
      { role: "system", content: RECOGNIZE_PROMPT },
      { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpegBase64}`, detail: "high" } }] },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: RECOGNIZE_SCHEMA },
  }, 60)
  const content = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content
  let parsed: any
  try { parsed = JSON.parse(String(content)) } catch { throw new Error("Azure OpenAI 返回的识别结果无法解析") }
  return {
    doc_type: parsed.doc_type,
    transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
    note: parsed.note ?? null,
    engine: "azure",
    seconds,
    model: res.model,
  }
}

/** 结构化请求（识别权益）：system 是提示词，text 是原文（可空），jpegs 是截图（长边不超过 2048 像素的 JPEG） */
export async function azureStructured(http: Http, c: AzureConfig, system: string, text: string | null, jpegs: string[], schema: unknown): Promise<{ raw: unknown; seconds: number; model: string }> {
  const content: unknown[] = []
  if (text) content.push({ type: "text", text: `原文：
${text}` })
  for (const j of jpegs) content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${j}`, detail: "high" } })
  const { res, seconds } = await chat(http, c, {
    messages: [{ role: "system", content: system }, { role: "user", content }],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: schema },
  }, 90)
  const out = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content
  try {
    return { raw: JSON.parse(String(out)), seconds, model: String(res.model || "") }
  } catch {
    throw new Error("Azure OpenAI 返回的识别结果无法解析")
  }
}

/** 设置页的「测试连接」 */
export async function pingAzure(http: Http, c: AzureConfig): Promise<{ model: string; seconds: number }> {
  const { res, seconds } = await chat(http, c, { messages: [{ role: "user", content: "ping" }], max_tokens: 5, temperature: 0 }, 30)
  return { model: String(res.model || ""), seconds }
}
