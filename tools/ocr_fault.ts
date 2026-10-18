// 读错能不能被发现（开发用）：在真实样本的识别文字里随机改一位数字，模拟 Vision 读错，
// 看改过的结果有多少还能通过 localUsable（也就是读错了却被直接采用）。
//   npx tsx tools/ocr_fault.ts [--trials 20]
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { mergeTransactions } from "../common/receipt"
import { localUsable, OcrResult, parseOcr } from "../common/receipt_rules"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const argv = process.argv.slice(2)
const trials = Number(argv[argv.indexOf("--trials") + 1]) || 20

// 可复现的随机数
let seed = 20261018
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

const rows = readFileSync(join(ROOT, "out/ocr/vision.jsonl"), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => r.variant === "plain")
const latest = new Map<string, OcrResult>()
for (const r of rows) latest.set(r.file, r)

const FIELDS = ["price", "liters", "amount", "paid"] as const
const counts: Record<string, { tried: number; slipped: number }> = Object.fromEntries(FIELDS.map(f => [f, { tried: 0, slipped: 0 }]))
const slips: string[] = []

for (const [file, ocr] of latest) {
  const base = parseOcr(ocr)
  if (!localUsable(base)) continue
  const truth = mergeTransactions(base.transactions).tx!
  for (const field of FIELDS) {
    const value = truth[field]
    if (value == null) continue
    const text = value.toFixed(2)
    // 只改图上写着这个数的文字块（同一个数出现在几处时，只改其中一处：模拟一处读错）
    const hits = ocr.candidates.map((c, i) => ({ c, i })).filter(({ c }) => c.t.replace(/\s/g, "").includes(text))
    if (!hits.length) continue
    for (let n = 0; n < trials; n++) {
      const { c, i } = hits[Math.floor(rand() * hits.length)]
      const at = c.t.indexOf(text)
      const digits = [...text].map((ch, k) => (/\d/.test(ch) ? k : -1)).filter(k => k >= 0)
      const k = digits[Math.floor(rand() * digits.length)]
      const old = text[k]
      let d = String(Math.floor(rand() * 10))
      if (d === old) d = String((Number(old) + 1) % 10)
      const wrongText = text.slice(0, k) + d + text.slice(k + 1)
      const candidates = ocr.candidates.slice()
      candidates[i] = { ...c, t: c.t.slice(0, at) + wrongText + c.t.slice(at + text.length) }
      const r = parseOcr({ ...ocr, candidates })
      counts[field].tried++
      if (!localUsable(r)) continue
      const t = mergeTransactions(r.transactions).tx!
      const changed = FIELDS.some(f => truth[f] != null && t[f] != null && Math.abs((truth[f] as number) - (t[f] as number)) > 0.011)
      if (changed) {
        counts[field].slipped++
        if (slips.length < 15) slips.push(`${file} ${field} ${text} → ${wrongText}：${JSON.stringify({ price: t.price, liters: t.liters, amount: t.amount, paid: t.paid })}`)
      }
    }
  }
}
const total = FIELDS.reduce((s, f) => ({ tried: s.tried + counts[f].tried, slipped: s.slipped + counts[f].slipped }), { tried: 0, slipped: 0 })
console.log(`模拟读错 ${total.tried} 次，读错后仍被直接采用 ${total.slipped} 次（${(total.slipped / Math.max(1, total.tried) * 100).toFixed(2)}%）`)
for (const f of FIELDS) console.log(`  ${f}：${counts[f].slipped} / ${counts[f].tried}`)
if (slips.length) console.log(`例子：\n  ${slips.join("\n  ")}`)
