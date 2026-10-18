// Scripting 助手识别：Schema 符合 Scripting 的格式；模型返回的 JSON 整理成与 Azure 相同的识别结果
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ASSISTANT_PROMPT, ASSISTANT_SCHEMA, fromAssistant, PING_SCHEMA, PROMPT_CHANGES } from "../readers/assistant"
import { RECOGNIZE_PROMPT } from "../readers/azure"

const XXYH_ROOT = process.env.XXYH_ROOT || ""

/** Scripting 的 JSON Schema：只有 string、number、boolean、array、object，每一项都要有 description */
function checkSchema(s: any, path: string): void {
  assert.ok(typeof s.description === "string" && s.description, `${path} 缺 description`)
  assert.ok(["string", "number", "boolean", "array", "object"].includes(s.type), `${path} 的 type 不支持：${JSON.stringify(s.type)}`)
  assert.ok(!("enum" in s) && !("additionalProperties" in s), `${path} 有 Scripting 不支持的字段`)
  if (s.type === "array") checkSchema(s.items, `${path}[]`)
  if (s.type === "object") for (const [k, v] of Object.entries(s.properties)) checkSchema(v, `${path}.${k}`)
}

test("Scripting 助手：Schema 只用 Scripting 支持的写法；提示词与 Azure 相同，只是看不到的字段改为省略", () => {
  checkSchema(ASSISTANT_SCHEMA, "result")
  checkSchema(PING_SCHEMA, "ping")
  assert.deepEqual(Object.keys((ASSISTANT_SCHEMA.properties.transactions as any).items.properties),
    ["grade", "product_code", "price", "liters", "amount", "discount", "paid", "time", "station", "payment"])
  assert.notEqual(ASSISTANT_PROMPT, RECOGNIZE_PROMPT)
  assert.doesNotMatch(ASSISTANT_PROMPT, /null/)
  assert.equal(PROMPT_CHANGES.reduce((p, [from, to]) => p.replace(to, from), ASSISTANT_PROMPT), RECOGNIZE_PROMPT)
})

test("Scripting 助手：省略、空字符串、\"null\" 都算没有；数字可以是文字；doc_type 不认识时按有没有交易判断", () => {
  const r = fromAssistant({
    doc_type: "fuel_screenshot",
    transactions: [{ grade: "98号", product_code: 1052, price: "11.12", liters: 42.68, amount: 474.6, paid: "¥389.24", time: "2026-10-12 14:39:52", station: "", payment: "null" }],
  }, 4.2, "gpt-5")
  assert.deepEqual(r, {
    doc_type: "fuel_screenshot",
    transactions: [{ grade: "98号", product_code: "1052", price: 11.12, liters: 42.68, amount: 474.6, discount: null, paid: 389.24, time: "2026-10-12 14:39:52", station: null, payment: null }],
    note: null,
    engine: "assistant",
    seconds: 4.2,
    model: "gpt-5",
  })
  assert.equal(fromAssistant({ doc_type: "receipt", transactions: [{ price: 8 }] }, 1, "").doc_type, "fuel_receipt")
  assert.equal(fromAssistant({ doc_type: "", transactions: [] }, 1, "").doc_type, "other")
  assert.deepEqual(fromAssistant({ doc_type: "other", transactions: [{ price: 8 }], note: "保养单" }, 1, ""), { doc_type: "other", transactions: [], note: "保养单", engine: "assistant", seconds: 1 })
  assert.equal(fromAssistant(null, 1, "").doc_type, "other")
  assert.equal(fromAssistant({ transactions: "x" }, 1, "").transactions.length, 0)
})

const azureFile = XXYH_ROOT ? join(XXYH_ROOT, "out/receipt_eval/azure.jsonl") : ""

test("Scripting 助手：上次 Azure 的识别结果去掉 null 字段后，整理出的结果与 Azure 相同", { skip: azureFile && existsSync(azureFile) ? false : "需要 XXYH_ROOT 和 out/receipt_eval/azure.jsonl" }, () => {
  const dropNulls = (o: any): any => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null))
  let n = 0
  for (const line of readFileSync(azureFile, "utf8").split("\n")) {
    if (!line.trim()) continue
    const az = JSON.parse(line).result
    if (!az) continue
    const omitted = { ...dropNulls(az), transactions: (az.transactions || []).map(dropNulls) }
    const r = fromAssistant(omitted, 1, "")
    assert.equal(r.doc_type, az.doc_type)
    assert.deepEqual(r.transactions, az.doc_type === "other" ? [] : az.transactions)
    assert.equal(r.note, az.note ?? null)
    n++
  }
  assert.ok(n > 100, `只有 ${n} 条`)
})
