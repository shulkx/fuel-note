// 本机文字识别（iOS Vision）结果 → 识别结果（设计文档 16.3 节）。纯函数，用手机上导出的识别结果测试。
// 做法：把文字块按位置排成行；同一行里的标签（单价、升数、金额……）和它右边或下一行的数字配对。
// 规则要用真实样本验证（tools/probe 采样），满足 receiptUsable 才会采用，否则交给 Azure。
import { ReceiptDocType, ReceiptResult, ReceiptTransaction } from "./receipt"

/** Vision 的一个文字块；b 是归一化坐标 [x, y, w, h]，原点在左下角 */
export type OcrBlock = { t: string; c: number; b: [number, number, number, number] }

export type OcrResult = { width: number; height: number; candidates: OcrBlock[] }

type Line = { text: string; blocks: OcrBlock[]; y: number }

/** 按行排列：中心高度接近的块算同一行，从上到下、从左到右 */
export function ocrLines(blocks: OcrBlock[]): Line[] {
  const sorted = blocks
    .filter(b => b.t && b.t.trim())
    .map(b => ({ b, cy: b.b[1] + b.b[3] / 2, h: b.b[3] }))
    .sort((a, b) => b.cy - a.cy)
  const lines: Array<{ items: typeof sorted; cy: number; h: number }> = []
  for (const it of sorted) {
    const line = lines.find(l => Math.abs(l.cy - it.cy) < Math.max(l.h, it.h) * 0.6)
    if (line) line.items.push(it)
    else lines.push({ items: [it], cy: it.cy, h: it.h })
  }
  return lines.map(l => {
    const items = l.items.slice().sort((a, b) => a.b.b[0] - b.b.b[0])
    return { text: items.map(i => i.b.t.trim()).join(" "), blocks: items.map(i => i.b), y: l.cy }
  })
}

const NUMBER = /-?\d{1,6}(?:[.,]\d{1,3})?/

/** 文本里第一个数字（容忍「¥」「元」「L」「,」） */
function firstNumber(text: string): number | null {
  const m = text.replace(/[¥￥]/g, "").match(NUMBER)
  if (!m) return null
  const n = Number(m[0].replace(",", "."))
  return Number.isFinite(n) ? n : null
}

type FieldKey = "price" | "liters" | "amount" | "discount" | "paid"

/** 标签 → 字段。先匹配更具体的标签 */
const LABELS: Array<{ key: FieldKey; re: RegExp }> = [
  { key: "price", re: /单价|价格|油价|单\s*价/ },
  { key: "liters", re: /升数|数量|加油量|油量|升\s*数|体积/ },
  { key: "discount", re: /优惠|折扣|立减|减免/ },
  { key: "paid", re: /实付|实收|实际支付|支付金额|扣款|扣卡|付款金额/ },
  { key: "amount", re: /应付|金额|总价|订单金额|合计|消费金额/ },
]

/** 标签后面（同一行右边、或下一行）的数字 */
function valueAfter(lines: Line[], i: number, re: RegExp): number | null {
  const line = lines[i]
  const after = line.text.split(re).slice(1).join(" ")
  const same = firstNumber(after)
  if (same != null) return same
  const next = lines[i + 1]
  return next ? firstNumber(next.text) : null
}

const TIME = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(\d{1,2})[:：](\d{2})(?:[:：](\d{2}))?/

export function parseOcr(ocr: OcrResult, seconds = 0): ReceiptResult {
  const lines = ocrLines(ocr.candidates)
  const all = lines.map(l => l.text).join("\n")
  const tx: ReceiptTransaction = {
    grade: null, product_code: null, price: null, liters: null, amount: null, discount: null, paid: null,
    time: null, station: null, payment: null,
  }
  lines.forEach((line, i) => {
    for (const { key, re } of LABELS) {
      if (tx[key] != null || !re.test(line.text)) continue
      const v = valueAfter(lines, i, re)
      if (v != null) { tx[key] = v; break }
    }
  })
  const time = all.match(TIME)
  if (time) {
    const p = (s: string) => s.padStart(2, "0")
    tx.time = `${time[1]}-${p(time[2])}-${p(time[3])} ${p(time[4])}:${time[5]}:${time[6] || "00"}`
  }
  const grade = all.match(/(?:^|[^\d])(92|95|98|0)\s*(?:#|＃|号)/)
  if (grade) tx.grade = `${grade[1]}#`
  const station = lines.map(l => l.text).find(t => /加油站|服务区/.test(t) && t.length <= 30)
  if (station) tx.station = station.replace(/^(油站|加油站|站点)[:：]\s*/, "")
  const code = all.match(/\b(10\d{2})\b/)
  if (code) tx.product_code = code[1]

  const fuel = tx.price != null || tx.liters != null || tx.amount != null
  const docType: ReceiptDocType = !fuel ? "other" : ocr.height > ocr.width * 1.6 && /订单|支付|交易/.test(all) ? "fuel_screenshot" : "fuel_receipt"
  return { doc_type: docType, transactions: fuel ? [tx] : [], note: null, engine: "vision", seconds }
}
