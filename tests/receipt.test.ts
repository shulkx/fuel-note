// 截图识别（设计文档 16.3、16.4、16.7 节）：识别结果的处理、草稿合成、Azure 请求；
// 设置 XXYH_ROOT 时，用上次 Azure 识别 120 张历史小票的结果回放，核对与小熊记录一致
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import {
  amountFixes, decideGrade, fillFromReceipt, fillWarnings, findDuplicate, gradeEvidence, stopForPayment,
} from "../common/draft"
import {
  amountConsistent, gradeByPrice, gradeFromText, mergeTransactions, parseReceiptTime, priceRefAt, ReceiptResult, ReceiptTransaction,
  receiptUsable, sameStationName,
} from "../common/receipt"
import { localUsable, OcrBlock, parseOcr } from "../common/receipt_rules"
import { Stop } from "../common/stops"
import { FuelRecord } from "../common/types"
import { azureUrl, recognizeAzure } from "../readers/azure"
import { HttpRequest } from "../platform/http"
import { carKey, fuelFromXxyh, isRefuel } from "../sync/xxyh/mapping"
import { XxyhBackup } from "../sync/xxyh/types"
import { fuel, latestBackupFile, readJson, XXYH_ROOT } from "./helpers"

const CST = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => Date.UTC(y, mo - 1, d, h - 8, mi, s)
const NOW = CST(2026, 10, 18, 10, 0)

function tx(d: Partial<ReceiptTransaction>): ReceiptTransaction {
  return { grade: null, product_code: null, price: null, liters: null, amount: null, discount: null, paid: null, time: null, station: null, payment: null, ...d }
}

function result(doc_type: ReceiptResult["doc_type"], txs: ReceiptTransaction[]): ReceiptResult {
  return { doc_type, transactions: txs, note: null, engine: "test", seconds: 0.5 }
}

function stop(end_ts: number, refuel = true, recorded: FuelRecord | null = null): Stop {
  return {
    trip: { id: String(end_ts), start_ts: end_ts - 20 * 60e3, end_ts, start_odometer_km: 1, end_odometer_km: 83431.6, distance_km: 1, fuel_l: null, start: null, end: null },
    end_ts, place: { lng: 121.6, lat: 31.23, address: "", city: "上海市", district: "" }, odometer_km: 83431.6, stay_min: 8,
    candidate: refuel ? { kind: "mine", station: { id: "s1", name: "中国石化示例加油站", address: "", province: "上海市", city: "上海市", district: "", lng: 121.6, lat: 31.23, last_used_ts: 0 }, dist: 20 } : null,
    refuel, recorded,
  }
}

test("小票上的时间、标号、金额核对", () => {
  assert.equal(parseReceiptTime("2026-10-18 09:26:41"), CST(2026, 10, 18, 9, 26, 41))
  assert.equal(parseReceiptTime("2026/10/18 09:26"), CST(2026, 10, 18, 9, 26))
  assert.equal(parseReceiptTime("2026年10月18日 09:26"), CST(2026, 10, 18, 9, 26))
  assert.equal(parseReceiptTime("10-18 09:26"), null)
  assert.equal(gradeFromText("95号车用汽油(VIB)"), 95)
  assert.equal(gradeFromText("0#柴油"), 0)
  assert.equal(gradeFromText("89#"), null)
  assert.equal(gradeFromText("1052"), null)
  assert.ok(amountConsistent(7.98, 56.05, 447.28))
  assert.ok(amountConsistent(7.55, 39.73, 300), "预设金额：升数只印到 0.01，小票本身差到 单价 × 0.01 以内")
  assert.ok(!amountConsistent(7.98, 56.05, 441.28))
  assert.ok(sameStationName("中国石化上海示例加油站", "中国石化示例加油站"))
  assert.ok(sameStationName("中石化三桥加油站", "中国石化三桥加油站"))
  assert.ok(!sameStationName("中国石化三桥加油站", "中国石化示例加油站"))
})

test("按单价判断标号：95# 比 92# 高 0.43–0.56 元，98# 高 2.45–2.57 元", () => {
  const ref = priceRefAt({ official: { "92": 7.52, "95": 8.04 }, city: "上海市" }, [[CST(2026, 9, 30, 0, 0), 7.52]], NOW, "上海市")!
  assert.deepEqual([ref.p92, ref.p95], [7.52, 8.04])
  assert.equal(gradeByPrice(7.98, ref)?.grade, 95)
  assert.equal(gradeByPrice(7.98, ref)?.sure, true)
  assert.equal(gradeByPrice(7.5, ref)?.grade, 92)
  assert.equal(gradeByPrice(10.05, ref)?.grade, 98)
  assert.equal(gradeByPrice(7.78, ref)?.sure, false, "离两边都近")
  // 历史油价：取那个时刻生效的价格；早于历史时无法判断
  const hist: Array<[number, number]> = [[CST(2025, 1, 1, 0, 0), 7.2], [CST(2026, 1, 1, 0, 0), 7.6]]
  assert.equal(priceRefAt(null, hist, CST(2025, 6, 1, 0, 0), "上海市")?.p92, 7.2)
  assert.equal(priceRefAt(null, hist, CST(2024, 6, 1, 0, 0), "上海市"), null)
})

test("两笔付款：单价相同、15 分钟内合并；否则只用第一笔", () => {
  const a = tx({ price: 7.55, liters: 30, amount: 226.5, paid: 226.5, time: "2026-10-18 09:20:00" })
  const b = tx({ price: 7.55, liters: 10, amount: 75.5, paid: 75.5, time: "2026-10-18 09:24:00" })
  const m = mergeTransactions([b, a])
  assert.equal(m.merged, true)
  assert.equal(m.tx?.liters, 40)
  assert.equal(m.tx?.amount, 302)
  assert.equal(m.tx?.time, "2026-10-18 09:20:00")
  const far = mergeTransactions([a, { ...b, time: "2026-10-18 11:00:00" }])
  assert.equal(far.merged, false)
  assert.equal(far.unmerged, true)
})

test("识别结果能不能直接用：三项都有且核对通过、实付不大于金额、截图有时间", () => {
  const good = tx({ price: 7.98, liters: 56.05, amount: 447.28, paid: 427.28, time: "2026-10-18 09:26:41" })
  assert.ok(receiptUsable(result("fuel_screenshot", [good])))
  assert.ok(!receiptUsable(result("fuel_screenshot", [{ ...good, time: null }])), "截图没有时间")
  assert.ok(receiptUsable(result("fuel_receipt", [{ ...good, time: null }])), "小票可以没有时间")
  assert.ok(!receiptUsable(result("fuel_receipt", [{ ...good, amount: 441.28 }])), "核对不通过")
  assert.ok(!receiptUsable(result("fuel_receipt", [{ ...good, paid: 2193.13 }])), "实付大于金额（读成了扣前金额）")
  assert.ok(!receiptUsable(result("fuel_receipt", [{ ...good, liters: null }])))
  assert.ok(!receiptUsable(result("other", [])))
})

test("合成草稿：推算的字段、时间来源", () => {
  // 截图：金额减优惠得实付；时间来自截图
  let f = fillFromReceipt(result("fuel_screenshot", [tx({ price: 7.98, liters: 56.05, amount: 447.28, discount: 20, grade: "95号", time: "2026-10-18 09:26:41", station: "中国石化示例加油站" })]), "library", null, NOW)!
  assert.equal(f.source, "screenshot")
  assert.equal(f.paid, 427.28)
  assert.deepEqual(f.derived, ["paid"])
  assert.equal(f.ts, CST(2026, 10, 18, 9, 26, 41))
  assert.equal(f.tsSource, "screenshot")
  assert.equal(f.printedGrade, 95)
  // 加油机照片：没有金额由单价 × 升数算；没有时间用拍照时间
  f = fillFromReceipt(result("pump_display", [tx({ price: 8, liters: 22.63 })]), "camera", NOW - 60e3, NOW)!
  assert.equal(f.source, "camera")
  assert.equal(f.amount, 181.04)
  assert.deepEqual(f.derived, ["amount", "paid"])
  assert.equal(f.tsSource, "camera")
  assert.equal(f.payTs, NOW - 60e3)
  // 相册里没有时间的照片：没有付款时间
  f = fillFromReceipt(result("fuel_receipt", [tx({ price: 8, liters: 20, amount: 160 })]), "library", null, NOW)!
  assert.equal(f.payTs, null)
  // 图上的时间晚于现在（读错）不用
  f = fillFromReceipt(result("fuel_receipt", [tx({ price: 8, liters: 20, amount: 160, time: "2027-10-18 09:26:41" })]), "library", null, NOW)!
  assert.equal(f.ts, null)
  assert.equal(fillFromReceipt(result("other", []), "library", null, NOW), null)
})

test("按付款时间匹配停车、标号、提醒", () => {
  const pay = CST(2026, 10, 18, 9, 26)
  const refuel = stop(CST(2026, 10, 18, 9, 21))
  const later = stop(CST(2026, 10, 18, 9, 40), false)
  const older = stop(CST(2026, 10, 15, 18, 0))
  const choice = stopForPayment([older, refuel, later], pay)
  assert.equal(choice?.stop.end_ts, refuel.end_ts)
  assert.equal(choice?.kind, "refuel")

  const ref = { p92: 7.52, p95: 8.04, city: "上海市", current: true }
  const byPrice = decideGrade(null, "screenshot", 7.98, ref, 92)
  assert.equal(byPrice.grade, 95)
  assert.equal(byPrice.source, "price")
  assert.match(gradeEvidence(byPrice, 7.98), /差价 \+0\.46 元/)
  const printed = decideGrade(92, "screenshot", 7.98, ref, 95)
  assert.equal(printed.grade, 92)
  assert.equal(printed.conflict, true)
  const usual = decideGrade(null, "photo", 7.78, ref, 95)
  assert.equal(usual.source, "usual")

  const f = fillFromReceipt(result("fuel_screenshot", [tx({ price: 7.98, liters: 56.05, amount: 447.28, time: "2026-10-18 09:26:00", station: "中国石化三桥加油站" })]), "library", null, NOW)!
  const warnings = fillWarnings({ fill: f, choice, stops: [older, refuel, later], tripsOn: true, stationName: "中国石化示例加油站", grade: printed })
  assert.ok(warnings.some(w => /不一致/.test(w)), "油站名不一致")
  assert.ok(warnings.some(w => /近 7 天还有 1 次/.test(w)), "另有一次没记录的加油停车")
  assert.ok(warnings.some(w => /更接近当天 95#/.test(w)))
  const none = fillWarnings({ fill: f, choice: null, stops: [], tripsOn: true, stationName: null, grade: byPrice })
  assert.ok(none.some(w => /还没有这次加油/.test(w)))
})

test("金额改法与重复记录", () => {
  assert.deepEqual(amountFixes(7.98, 56.05, 441.28), { amount: 447.28, liters: 55.3 })
  assert.equal(amountFixes(7.98, 56.05, 447.28), null)
  const t = CST(2026, 10, 12, 14, 39)
  const recs = [fuel("a", { ts: t, amount: 474.6 })]
  assert.equal(findDuplicate(recs, t + 5 * 60e3, 100)?.id, "a", "10 分钟内")
  assert.equal(findDuplicate(recs, t + 3 * 3600e3, 474.6)?.id, "a", "同一天同金额")
  assert.equal(findDuplicate(recs, t + 3 * 3600e3, 300), null)
  assert.equal(findDuplicate(recs, t, 474.6, "a"), null, "编辑自己")
})

test("Azure：请求格式、识别结果、错误信息", async () => {
  const cfg = { endpoint: "https://x.openai.azure.com/openai/deployments/old", deployment: "gpt41", key: " k " }
  assert.equal(azureUrl(cfg), "https://x.openai.azure.com/openai/deployments/gpt41/chat/completions?api-version=2024-10-21")
  let sent: HttpRequest | null = null
  const ok = async (req: HttpRequest) => {
    sent = req
    const content = JSON.stringify({ doc_type: "fuel_screenshot", transactions: [tx({ price: 7.98, liters: 56.05, amount: 447.28, time: "2026-10-18 09:26:41" })], note: null })
    return { status: 200, text: JSON.stringify({ model: "gpt-4.1-2025-04-14", choices: [{ message: { content } }] }) }
  }
  const r = await recognizeAzure(ok, cfg, "QUJD")
  assert.equal(r.engine, "azure")
  assert.equal(r.transactions[0].amount, 447.28)
  assert.equal(sent!.headers!["api-key"], "k")
  const body = JSON.parse(String(sent!.body))
  assert.equal(body.messages[1].content[0].image_url.url, "data:image/jpeg;base64,QUJD")
  assert.equal(body.response_format.json_schema.name, "fuel_receipt")
  const denied = async () => ({ status: 401, text: JSON.stringify({ error: { message: "Access denied" } }) })
  await assert.rejects(recognizeAzure(denied, cfg, "QUJD"), /Azure OpenAI：Access denied/)
})

// 本机规则：用合成的文字块（坐标原点在左下角）复现真实小票上遇到过的情况
function block(t: string, x: number, y: number, w = 0.4): OcrBlock {
  return { t, c: 1, b: [x, y, w, 0.02] }
}

test("本机规则：IC 卡小票、扣前金额、时间的各种读法", () => {
  const lines = ["欢迎使用中国石化加油IC卡", "站编码：32750171", "扣前金额： 3258.44元", "油品代码：1052", "单价：6.98 元/升", "加油升数： 36.77 升", "加油金额： 256.65 元", "扣后余额： 3001.79元", "交易时间：2023年05月02日111:37:00"]
  const r = parseOcr({ width: 1000, height: 1600, candidates: lines.map((t, i) => block(t, 0.05, 0.9 - i * 0.05)) })
  assert.equal(r.doc_type, "fuel_receipt")
  const t = r.transactions[0]
  // 没有「扣卡」：实付由扣前、扣后余额算出
  assert.deepEqual([t.price, t.liters, t.amount, t.paid], [6.98, 36.77, 256.65, 256.65])
  assert.equal(t.time, "2023-05-02 11:37:00")
  assert.equal(t.product_code, "1052")
  assert.equal(t.station, null, "「加油站编码」不是油站名")
  assert.ok(localUsable(r))
  const time = (s: string) => parseOcr({ width: 1, height: 1, candidates: [block("单价：8元/升", 0.05, 0.9), block(s, 0.05, 0.8)] }).transactions[0].time
  assert.equal(time("交易时间：2023年03月04月14:39:36"), "2023-03-04 14:39:36")
  assert.equal(time("交易时间：2023年01月2611 12:20:52"), "2023-01-26 12:20:52")
  assert.equal(time("交易时间：2023年：03月12日 15:16:5"), "2023-03-12 15:16:05")
  assert.equal(time("交易时间：2023年08月04日 ｜ 08:11:13"), "2023-08-04 08:11:13")
  assert.equal(time("交易时间：2021年04月01日08:09:17"), "2021-04-01 08:09:17")
})

test("本机规则：2026 年石化 App 截图，活动说明里的标号不影响", () => {
  const lines = ["记录详情", "26年95#大转盘98/95同价体验（石化钱包… -¥85.36", "爱跑98号车用汽油 （VIB）", "中国石化三桥加油站", "2026-10-12 14:39:52", "油品金额 11.12元/Lx 42.68L", "应付金额 ¥474.60", "石化钱包 -¥389.24", "实付金额 ¥389.24", "可开票金额② 387.24元"]
  const r = parseOcr({ width: 1260, height: 2736, candidates: lines.map((t, i) => block(t, 0.1, 0.9 - i * 0.05)) })
  const t = r.transactions[0]
  assert.equal(r.doc_type, "fuel_screenshot")
  assert.deepEqual([t.grade, t.price, t.liters, t.amount, t.paid, t.time, t.station], ["98#", 11.12, 42.68, 474.6, 389.24, "2026-10-12 14:39:52", "中国石化三桥加油站"])
  assert.equal(t.discount, 85.36, "实付小于应付：差额 85.36 在图上，作为优惠")
  assert.ok(localUsable(r))
})

test("本机规则：实付没有证据时核对不通过", () => {
  const base = ["中国石化三桥加油站", "2026-10-12 14:39:52", "油品金额 11.12元/Lx 42.68L", "应付金额 ¥474.60"]
  const parse = (extra: string[]) => parseOcr({ width: 1260, height: 2736, candidates: [...base, ...extra].map((t, i) => block(t, 0.1, 0.9 - i * 0.05)) })
  // 实付读成了别的数（图上没有对应的优惠差额）
  assert.ok(!localUsable(parse(["实付金额 ¥387.24"])))
  // 没读到实付
  assert.ok(!localUsable(parse(["订单编号：327503641482"])))
  // IC 卡：扣卡与余额差对不上
  const ic = ["站编码：32750171", "扣前余额：3865.05元", "单价：6.97元/升", "升数：36.14升", "应付：251.89元", "扣卡：215.89元", "扣后余额：3613.16元", "交易时间：2021年03月16日 07:38:06"]
  const r = parseOcr({ width: 1000, height: 1600, candidates: ic.map((t, i) => block(t, 0.05, 0.9 - i * 0.05)) })
  assert.equal(r.transactions[0].paid, null)
  assert.ok(!localUsable(r))
  // 数值超出合理范围（单价读成 155）
  const odd = ["单价：155元/升", "升数：10.00升", "应付：1550.00元", "扣卡：1550.00元", "交易时间：2021年12月10日 10:43:00"]
  assert.ok(!localUsable(parseOcr({ width: 1000, height: 1600, candidates: odd.map((t, i) => block(t, 0.05, 0.9 - i * 0.05)) })))
})

test("本机规则：石化 App 截图的「单价 × 升数」一行", () => {
  const lines = ["95#（VIA）", "中国石化晋元加油站", "2022-08-12 08:08:14", "油品金额 8.93元 /Lx 41.09L", "应付金额 ¥366.88", "实付金额 ¥366.88", "开票金额 ¥366.88", "订单编号：32750171674220812080837622"]
  const r = parseOcr({ width: 1170, height: 2532, candidates: lines.map((t, i) => block(t, 0.1, 0.9 - i * 0.05)) })
  assert.equal(r.doc_type, "fuel_screenshot")
  const t = r.transactions[0]
  assert.deepEqual([t.price, t.liters, t.amount, t.paid], [8.93, 41.09, 366.88, 366.88])
  assert.equal(t.station, "中国石化晋元加油站")
  assert.equal(t.grade, "95#")
  assert.ok(localUsable(r))
})

test("本机规则：并排两张小票拆开；同一次加油合并，一张读不全时不采用", () => {
  const receipt = (x: number, liters: string, amount: string, time: string) => [
    "站编码：32750097", "卡号：0100011310001", "流水号（POS-TTC）：34023", "品类代码：1052", "单价：8.07元/升", `升数：${liters}升`, `应付：${amount}元`, `扣卡：${amount}元`, `交易时间：${time}`,
  ].map((t, i) => block(t, x, 0.9 - i * 0.05, 0.4))
  const both = parseOcr({ width: 2000, height: 1500, candidates: [...receipt(0.02, "39.47", "318.46", "2023年01月26日 12:20:52"), ...receipt(0.52, "1.70", "13.71", "2023年01月26日 12:22:22")] })
  assert.equal(both.transactions.length, 2)
  const m = mergeTransactions(both.transactions)
  assert.equal(m.merged, true)
  assert.deepEqual([m.tx?.liters, m.tx?.amount], [41.17, 332.17])
  assert.ok(localUsable(both))
  // 右边那张没读到单价：不知道怎么合并，核对不通过
  const right = receipt(0.52, "21.20", "160.00", "2021年07月21日 07:49:33").filter(b => !b.t.startsWith("单价"))
  const broken = parseOcr({ width: 2000, height: 1500, candidates: [...receipt(0.02, "18.03", "136.10", "2021年07月21日 07:48:20"), ...right] })
  assert.ok(!localUsable(broken))
})

// ---------- 真实数据（只读） ----------

const azureFile = XXYH_ROOT ? join(XXYH_ROOT, "out/receipt_eval/azure.jsonl") : ""
const visionFile = XXYH_ROOT ? join(XXYH_ROOT, "out/ocr/vision.jsonl") : ""

test("真实小票：本机识别规则与 Azure 一致，可直接用的结果里没有错的", { skip: visionFile && existsSync(visionFile) && azureFile && existsSync(azureFile) ? false : "需要 XXYH_ROOT、out/ocr/vision.jsonl（tools/probe 采样）和 Azure 结果" }, () => {
  const az = new Map<string, any>()
  for (const line of readFileSync(azureFile, "utf8").split("\n")) if (line.trim()) { const r = JSON.parse(line); if (r.result) az.set(`receipts/${r.file}`, r.result) }
  const ocr = new Map<string, any>()
  for (const line of readFileSync(visionFile, "utf8").split("\n")) if (line.trim()) { const r = JSON.parse(line); if (r.variant === "plain") ocr.set(r.file, r) }
  const close = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.011
  let fuelImages = 0
  let usable = 0
  const wrong: string[] = []
  for (const [file, v] of ocr) {
    const a = az.get(file)
    if (!a) continue
    const res = parseOcr(v)
    const at = mergeTransactions(a.transactions || []).tx
    if (a.doc_type === "other" || !at) {
      if (localUsable(res)) wrong.push(`${file}：不是加油单据，本机却认为可用`)
      continue
    }
    fuelImages++
    if (!localUsable(res)) continue
    usable++
    const t = mergeTransactions(res.transactions).tx!
    const paid = t.paid ?? (t.discount ? (t.amount as number) - t.discount : t.amount)
    const azPaid = at.paid ?? at.amount
    if (!close(t.price, at.price) || !close(t.liters, at.liters) || !close(t.amount, at.amount) || !close(paid, azPaid)) wrong.push(`${file}：本机 ${JSON.stringify(t)}`)
  }
  // 手机相册里传来的截图没有 Azure 的结果：直接和小熊记录比（同一天、同单价）
  const doc = backupFile ? readJson(backupFile) as XxyhBackup : null
  const car = doc ? doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0] : null
  const records = car ? (car.fuelRecords || []).filter(isRefuel).map(r => fuelFromXxyh(r, carKey(car), "veh")) : []
  let phone = 0
  for (const [file, v] of ocr) {
    if (!file.startsWith("phone/")) continue
    const res = parseOcr(v)
    if (!localUsable(res)) continue
    const t = mergeTransactions(res.transactions).tx!
    const day = String(t.time || "").slice(0, 10)
    const rec = records.find(r => new Date(r.ts + 8 * 3600e3).toISOString().slice(0, 10) === day && close(r.price, t.price))
    if (!rec) continue
    phone++
    if (!close(rec.liters, t.liters) || !close(rec.amount, t.amount) || !close(rec.paid, t.paid ?? t.amount)) wrong.push(`${file}：本机 ${JSON.stringify(t)}，记录 ${JSON.stringify(rec)}`)
  }
  console.log(`  加油图片 ${fuelImages} 张，本机可直接用 ${usable} 张，其中与 Azure 不一致 ${wrong.length} 张；手机截图与记录核对 ${phone} 张`)
  assert.deepEqual(wrong, [])
  assert.ok(fuelImages >= 100 && usable / fuelImages >= 0.9, `可直接用的比例 ${(usable / fuelImages * 100).toFixed(1)}%`)
})

const backupFile = latestBackupFile()

test("真实小票：用上次 Azure 的识别结果合成草稿，与小熊记录一致", { skip: azureFile && existsSync(azureFile) && backupFile ? false : "需要 XXYH_ROOT 和 out/receipt_eval/*.jsonl" }, () => {
  const rows = new Map<string, any>()
  for (const line of readFileSync(azureFile, "utf8").split("\n")) {
    if (!line.trim()) continue
    const r = JSON.parse(line)
    if (r.result) rows.set(r.file, r) // 同一张图多次识别时用最后一次
  }
  const doc = readJson(backupFile!) as XxyhBackup
  const car = doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0]
  const records = (car.fuelRecords || []).filter(isRefuel).map(r => fuelFromXxyh(r, carKey(car), "veh"))
  const dayOf = (ts: number) => new Date(ts + 8 * 3600e3).toISOString().slice(0, 10)
  // 一次加油分两次刷卡时，两张小票在两张图里（「第 1 页」「第 2 页」），记录是两笔之和：按天、单价合起来比
  const groups = new Map<string, { files: string[]; price: number; liters: number }>()
  let fuelImages = 0
  let usable = 0
  for (const [file, row] of rows) {
    const res = { ...row.result, engine: "azure", seconds: row.seconds || 0 } as ReceiptResult
    const f = fillFromReceipt(res, "library", null, Date.now())
    if (!f || f.price == null || f.liters == null) continue
    fuelImages++
    if (receiptUsable(res)) usable++
    const day = f.ts != null ? dayOf(f.ts) : file.replace(/^(\d{4})年(\d{2})月(\d{2})日.*$/, "$1-$2-$3")
    const key = `${day}|${f.price.toFixed(2)}`
    const g = groups.get(key) || { files: [], price: f.price, liters: 0 }
    // 同一张小票拍了两次时只算一次
    if (!g.files.some(x => rows.get(x).result.transactions[0]?.liters === f.liters)) g.liters += f.liters
    g.files.push(file)
    groups.set(key, g)
  }
  let matched = 0
  const misses: string[] = []
  for (const [key, g] of groups) {
    const day = key.split("|")[0]
    const rec = records.find(r => dayOf(r.ts) === day && Math.abs(r.price - g.price) < 0.006)
    if (rec && Math.abs(rec.liters - g.liters) <= 0.02) matched++
    else misses.push(`${g.files.join("、")}：单价 ${g.price}，升数 ${g.liters.toFixed(2)}${rec ? `，记录 ${rec.liters}` : "，没有记录"}`)
  }
  console.log(`  加油图片 ${fuelImages} 张（${groups.size} 次加油），可直接用 ${usable} 张，与记录一致 ${matched} 次`)
  if (misses.length) console.log(`  对不上：\n    ${misses.join("\n    ")}`)
  assert.ok(fuelImages >= 100)
  assert.ok(matched / groups.size >= 0.95, `与记录一致的比例 ${(matched / groups.size * 100).toFixed(1)}%`)
})
