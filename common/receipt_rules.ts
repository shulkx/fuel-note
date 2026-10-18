// 本机文字识别（iOS Vision）结果 → 识别结果（设计文档 16.3 节）。纯函数，用手机上导出的识别结果测试（tools/ocr_eval.ts）。
// 做法：把文字块按位置排成行；同一行里的标签（单价、升数、应付……）和它右边（或下一行）的数字配对。
// 一张照片里并排两张小票时，先按列拆开，分别解析。读不全或核对不通过时不采用（receiptUsable），交给 Azure。
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

/** 小票上的标签，用来判断一列是不是一张小票 */
const RECEIPT_LABEL = /单价|升数|数量|应付|扣卡|交易时间|站编码|卡号|流水号|品类代码|油品代码/

/** 并排的两张小票：找一条竖线，两边都有至少 5 个标签块，且几乎没有块跨过它 */
export function splitColumns(blocks: OcrBlock[]): OcrBlock[][] {
  let best: { left: OcrBlock[]; right: OcrBlock[]; score: number } | null = null
  for (let s = 0.3; s <= 0.7; s += 0.02) {
    const left = blocks.filter(b => b.b[0] + b.b[2] <= s + 0.01)
    const right = blocks.filter(b => b.b[0] >= s - 0.01)
    const crossing = blocks.length - left.length - right.length
    const labels = (list: OcrBlock[]) => list.filter(b => RECEIPT_LABEL.test(b.t)).length
    const score = Math.min(labels(left), labels(right))
    if (crossing <= 1 && score >= 5 && (!best || score > best.score)) best = { left, right, score }
  }
  return best ? [best.left, best.right] : [blocks]
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

/** 不是这笔交易的金额：卡余额、开票金额、优惠规则编号、联机支付等 */
const EXCLUDE = /扣前|扣后|余额|开票|规则|联机|积分/

/** 标签 → 字段。前面的优先：「实付金额」是实付，不是金额 */
const LABELS: Array<{ key: FieldKey; re: RegExp }> = [
  { key: "price", re: /单价|油价/ },
  { key: "liters", re: /升数|数量|加油量|油量/ },
  { key: "discount", re: /优惠|折扣|立减|减免/ },
  { key: "paid", re: /实付|实收|实际支付|支付金额|付款金额|扣卡|扣款/ },
  { key: "amount", re: /应付|加油金额|订单金额|消费金额|金额|总价|合计/ },
]

/** 截图里的「8.93元/L x 41.09L」 */
const PRICE_TIMES_LITERS = /(\d{1,2}(?:\.\d{1,3})?)\s*元?\s*\/\s*[lL升]\s*[x×X*]\s*(\d{1,3}(?:\.\d{1,3})?)\s*[lL升]/

/** 标签后面（同一行右边、或下一行）的数字 */
function valueAfter(lines: Line[], i: number, re: RegExp): number | null {
  const after = lines[i].text.split(re).slice(1).join(" ")
  const same = firstNumber(after)
  if (same != null) return same
  const next = lines[i + 1]
  return next && !EXCLUDE.test(next.text) && !LABELS.some(l => l.re.test(next.text)) ? firstNumber(next.text) : null
}

// 真实小票上读到过的写法：「2021年04月01日08:09:17」「2023年03月04月14:39:36」（日读成月）「2023年01月2611 12:20:52」（日读成 11）
// 「2023年08月04日 ｜ 08:11:13」「2023年：03月12日 15:16:5」「2023年05月02日111:37:00」（多读出一个 1：后面紧跟两位数字和冒号时跳过）
const TIME = /(\d{4})[-/.年][:：]?(\d{1,2})[-/.月](\d{1,2})(?:日|月|号|11)?\s*[|｜]?\s*(?:\d(?=\d{2}[:：]))?(\d{1,2})[:：](\d{2})(?:[:：]\s?(\d{1,2}))?/
const STATION = /^(?!.*(编码|[:：]|\d{4})).{2,24}(加油站|加油加气站|服务区)$/

function parseColumn(blocks: OcrBlock[]): { tx: ReceiptTransaction; text: string } {
  const lines = ocrLines(blocks)
  const all = lines.map(l => l.text).join("\n")
  const tx: ReceiptTransaction = {
    grade: null, product_code: null, price: null, liters: null, amount: null, discount: null, paid: null,
    time: null, station: null, payment: null,
  }
  lines.forEach((line, i) => {
    if (EXCLUDE.test(line.text)) return
    const pl = line.text.match(PRICE_TIMES_LITERS)
    if (pl) {
      if (tx.price == null) tx.price = Number(pl[1])
      if (tx.liters == null) tx.liters = Number(pl[2])
      return
    }
    for (const { key, re } of LABELS) {
      if (!re.test(line.text)) continue
      if (tx[key] == null) {
        const v = valueAfter(lines, i, re)
        if (v != null) tx[key] = v
      }
      break // 一行只认一个标签
    }
  })
  const time = all.match(TIME)
  if (time) {
    const p = (s: string) => s.padStart(2, "0")
    tx.time = `${time[1]}-${p(time[2])}-${p(time[3])} ${p(time[4])}:${time[5]}:${p(time[6] || "0")}`
  }
  const grade = all.match(/(?:^|[^\d])(92|95|98|0)\s*(?:#|＃|号)/)
  if (grade) tx.grade = `${grade[1]}#`
  const station = lines.map(l => l.text.trim()).find(t => STATION.test(t))
  if (station) tx.station = station
  const code = all.match(/(?:代码|编码)[:：]?\s*(10\d{2})\b/)
  if (code) tx.product_code = code[1]
  return { tx, text: all }
}

export function parseOcr(ocr: OcrResult, seconds = 0): ReceiptResult {
  const columns = splitColumns(ocr.candidates.filter(b => b.t && b.t.trim())).map(parseColumn)
  const txs = columns.map(c => c.tx).filter(t => t.price != null || t.liters != null || t.amount != null || t.paid != null)
  const all = columns.map(c => c.text).join("\n")
  const docType: ReceiptDocType = !txs.length
    ? "other"
    : /IC卡|流水号|POS|不作报销|枪号|站编码/.test(all)
      ? "fuel_receipt"
      : /订单|实付金额|应付金额|支付/.test(all) ? "fuel_screenshot" : "fuel_receipt"
  return { doc_type: docType, transactions: txs, note: null, engine: "vision", seconds }
}
