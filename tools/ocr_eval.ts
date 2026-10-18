// 本机识别规则的评估（开发用）：用手机上导出的 Vision 结果（out/ocr/vision.jsonl）跑 parseOcr，
// 与上次 Azure 的识别结果（out/receipt_eval/azure.jsonl）逐张比较。
//   npx tsx tools/ocr_eval.ts [--variant plain|corrected] [--show 文件名片段]
// 报告写到 XXYH_ROOT/out/ocr/report_<variant>.txt（含真实小票内容，不进仓库）。
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mergeTransactions, num, ReceiptTransaction } from "../common/receipt"
import { localUsable as receiptUsable, ocrLines, parseOcr } from "../common/receipt_rules"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const argv = process.argv.slice(2)
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const variant = arg("variant", "plain")
const show = arg("show", "")

function jsonl(path: string): any[] {
  return readFileSync(path, "utf8").split("\n").filter(l => l.trim()).map(l => JSON.parse(l))
}

const vision = new Map<string, any>()
for (const r of jsonl(join(ROOT, "out/ocr/vision.jsonl"))) if (r.variant === variant) vision.set(r.file, r)
const azure = new Map<string, any>()
for (const r of jsonl(join(ROOT, "out/receipt_eval/azure.jsonl"))) if (r.result) azure.set(`receipts/${r.file}`, r.result)

const FIELDS = ["price", "liters", "amount", "paid", "time", "grade"] as const
const same = (k: string, a: any, b: any) => {
  // 时间只比到分钟：秒数对记录没有影响
  if (k === "time") return (a ? String(a).slice(0, 16) : null) === (b ? String(b).slice(0, 16) : null)
  if (k === "grade") return (a ? String(a).match(/\d+/)?.[0] : null) === (b ? String(b).match(/\d+/)?.[0] : null)
  const x = num(a)
  const y = num(b)
  return x == null || y == null ? x === y : Math.abs(x - y) < 0.011
}

const out: string[] = []
const stats = { total: 0, fuel: 0, usable: 0, usableAndRight: 0, usableButWrong: 0, field: Object.fromEntries(FIELDS.map(f => [f, 0])) as Record<string, number> }
const wrong: string[] = []
for (const [file, v] of vision) {
  const res = parseOcr(v, v.ms / 1000)
  const az = azure.get(file)
  const azTx: ReceiptTransaction | null = az ? mergeTransactions(az.transactions || []).tx : null
  const raw = mergeTransactions(res.transactions).tx
  // 与填表时一样：没有实付时按金额减优惠（标「推算」）
  const tx = raw && raw.paid == null && raw.amount != null ? { ...raw, paid: raw.discount ? raw.amount - raw.discount : raw.amount } : raw
  stats.total++
  if (!az || az.doc_type === "other" || !azTx) {
    if (receiptUsable(res)) wrong.push(`${file}（Azure：${az ? az.doc_type : "没有结果"}）本机误认为可用的加油单据：${JSON.stringify(tx)}`)
    continue
  }
  stats.fuel++
  const usable = receiptUsable(res)
  const diffs = FIELDS.filter(k => !same(k, tx ? (tx as any)[k] : null, (azTx as any)[k]))
  for (const k of FIELDS) if (!diffs.includes(k)) stats.field[k]++
  const moneyRight = !diffs.some(k => k === "price" || k === "liters" || k === "amount" || k === "paid")
  if (usable) {
    stats.usable++
    if (moneyRight) stats.usableAndRight++
    else stats.usableButWrong++
  }
  if (diffs.length) {
    wrong.push(`${file}（${az.doc_type}，${usable ? "可直接用" : "不可用"}）不同：${diffs.join(",")}\n    本机 ${JSON.stringify(tx)}\n    Azure ${JSON.stringify(azTx)}`)
  }
  if (show && show.split(",").some(s => file.includes(s))) {
    out.push(`== ${file}\n${ocrLines(v.candidates).map(l => `${l.text}    ⟨${l.blocks.map(b => b.b[0].toFixed(2)).join(" ")}⟩`).join("\n")}\n-> ${JSON.stringify(tx)}`)
  }
}
const pct = (n: number, d: number) => `${n}/${d} = ${(n / Math.max(1, d) * 100).toFixed(1)}%`
const head = [
  `变体 ${variant}：图片 ${stats.total}，Azure 认为是加油单据 ${stats.fuel}`,
  `本机结果可直接用：${pct(stats.usable, stats.fuel)}；其中金额全对 ${stats.usableAndRight}，有错 ${stats.usableButWrong}`,
  `各字段与 Azure 一致：${FIELDS.map(k => `${k} ${pct(stats.field[k], stats.fuel)}`).join("；")}`,
]
writeFileSync(join(ROOT, `out/ocr/report_${variant}.txt`), [...head, "", ...out, "", "== 与 Azure 不同 ==", ...wrong].join("\n"), "utf8")
console.log(head.join("\n"))
