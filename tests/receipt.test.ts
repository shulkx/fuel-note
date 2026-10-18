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

// ---------- 真实数据（只读） ----------

const azureFile = XXYH_ROOT ? join(XXYH_ROOT, "out/receipt_eval/azure.jsonl") : ""
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
