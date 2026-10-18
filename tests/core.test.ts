import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { hmacSha256, md5, sha256 } from "../common/hash"
import { bd09ToWgs84, gcj02ToBd09, gcj02ToWgs84, metres, wgs84ToGcj02 } from "../common/geo"
import { averageConsumption, consumptionById, fuelSegments } from "../common/fuel"
import { checkFuel, completeTriple, parseNum } from "../common/form"
import { summarize } from "../common/stats"
import { fuel } from "./helpers"

test("哈希与 Node crypto 一致", () => {
  for (const s of ["", "abc", "小熊油耗", "x".repeat(200), "🚗 emoji"]) {
    assert.equal(md5(s), createHash("md5").update(s).digest("hex"))
    assert.equal(sha256(s), createHash("sha256").update(s).digest("hex"))
    assert.equal(hmacSha256("key", s), createHmac("sha256", "key").update(s).digest("hex"))
  }
  assert.equal(md5("051f51b60f2611e491910800200c9a66"), "281c678f8e7b5b88b3bfcbbdf52775c1")
})

test("坐标往返误差小于 0.5 米", () => {
  const p: [number, number] = [121.600287, 31.236122]
  assert.ok(metres(gcj02ToWgs84(wgs84ToGcj02(p)), p) < 0.5)
  const g = wgs84ToGcj02(p)
  assert.ok(metres(bd09ToWgs84(gcj02ToBd09(g)), p) < 0.5)
  assert.ok(metres(p, wgs84ToGcj02(p)) > 300) // 上海的偏移约 500 米
})

test("跳枪法：两次加满之间为一段，结果在终点", () => {
  const rs = [
    fuel("a", { ts: 1, odometer: 1000, full: true }),
    fuel("b", { ts: 2, odometer: 1300, liters: 20, full: false }),
    fuel("c", { ts: 3, odometer: 1500, liters: 30, full: true }),
    fuel("d", { ts: 4, odometer: 2000, liters: 50, full: true }),
  ]
  const segs = fuelSegments(rs)
  assert.equal(segs.length, 2)
  assert.equal(segs[0].to.id, "c")
  assert.equal(segs[0].consumption, 50 / 500 * 100)
  assert.equal(consumptionById(rs).get("d"), 10)
  assert.equal(consumptionById(rs).has("b"), false)
  assert.equal(averageConsumption(segs), 100 / 1000 * 100)
})

test("上次漏记的那一段不计算", () => {
  const rs = [
    fuel("a", { ts: 1, odometer: 1000 }),
    fuel("b", { ts: 2, odometer: 1500, missed_before: true }),
    fuel("c", { ts: 3, odometer: 2000, liters: 45 }),
  ]
  const m = consumptionById(rs)
  assert.equal(m.has("b"), false)
  assert.equal(m.get("c"), 9)
})

test("三项任填两项", () => {
  assert.deepEqual(completeTriple({ price: 8.56, liters: 45.7, amount: null }, ["price", "liters"]).values.amount, 391.19)
  assert.equal(completeTriple({ price: 11.12, liters: null, amount: 474.6 }, ["amount", "price"]).values.liters, 42.68)
  assert.equal(completeTriple({ price: null, liters: 42.68, amount: 474.6 }, ["liters", "amount"]).values.price, 11.12)
  // 最近改的两项为准：依次改过单价、升数、金额 → 以升数和金额为准，重算单价
  const r = completeTriple({ price: 8, liters: 40, amount: 400 }, ["price", "liters", "amount"])
  assert.equal(r.computed, "price")
  assert.equal(r.values.price, 10)
  assert.equal(completeTriple({ price: 8, liters: null, amount: null }, ["price"]).computed, null)
  assert.equal(parseNum("¥1,234.5"), 1234.5)
  assert.equal(parseNum(""), null)
})

test("加油核对：里程前后、金额、油耗范围", () => {
  const others = [fuel("a", { ts: 100, odometer: 1000 }), fuel("z", { ts: 300, odometer: 3000 })]
  const base = { ts: 200, odometer: 1500, liters: 40, price: 8, amount: 320, paid: 300, grade: 95, full: true, light_on: false, missed_before: false, station_id: null, remark: "" }
  assert.deepEqual(checkFuel(base, others).errors, [])
  assert.equal(checkFuel(base, others).consumption, 8)
  assert.match(checkFuel({ ...base, odometer: 900 }, others).errors.join(), /大于上一次/)
  assert.match(checkFuel({ ...base, odometer: 3100 }, others).errors.join(), /小于下一次/)
  assert.match(checkFuel({ ...base, amount: 330 }, others).errors.join(), /相差/)
  assert.deepEqual(checkFuel({ ...base, amount: 320.08 }, others).errors, [], "误差在 单价 × 0.01 + 0.01 以内")
  assert.match(checkFuel({ ...base, odometer: 1100 }, others).warnings.join(), /不在 4–25/)
  assert.match(checkFuel({ ...base, grade: null }, others).errors.join(), /标号/)
})

test("统计：里程跨度与每公里花费", () => {
  const recs = [
    { ...fuel("a", { ts: Date.UTC(2025, 5, 1), odometer: 1000, paid: 300 }), origin: "local" as const, pending: false },
    { ...fuel("b", { ts: Date.UTC(2026, 1, 1), odometer: 1500, liters: 40, paid: 320 }), origin: "local" as const, pending: false },
    { kind: "expense" as const, id: "e", vehicle_id: "v1", ts: Date.UTC(2026, 2, 1), category_id: 100000, amount: 80, remark: "", origin: "local" as const, pending: false },
  ]
  const all = summarize(recs, "all", Date.UTC(2026, 5, 1))
  assert.equal(all.distance_km, 500)
  assert.equal(all.total_cost, 700)
  assert.equal(all.avg_consumption, 8)
  const half = summarize(recs, "6m", Date.UTC(2026, 5, 1))
  assert.equal(half.distance_km, 500) // 1500 − 范围之前的 1000
  assert.equal(half.total_cost, 400)
  assert.equal(half.cost_per_km, 0.8)
  assert.equal(half.fuel_count, 1)
})

test("统计：日均里程、加油间隔、优惠、单价、每月补零、同期对比、每年", async () => {
  const { monthlyCosts, yearOverYear, yearSummaries, priceSeries } = await import("../common/stats")
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  const rec = (id: string, ts: number, odometer: number, liters: number, amount: number, paid: number, missed = false) =>
    ({ ...fuel(id, { ts, odometer, liters, amount, paid, price: amount / liters, missed_before: missed }), origin: "local" as const, pending: false })
  const recs = [
    rec("a", day(2025, 9, 1), 10000, 40, 320, 320),
    rec("b", day(2025, 10, 1), 10400, 40, 320, 300),
    rec("c", day(2026, 9, 1), 20000, 50, 400, 400, true), // 上次漏记：b → c 这一段不算

    rec("d", day(2026, 9, 11), 20500, 50, 400, 380),
  ]
  const now = day(2026, 10, 1)
  const y = summarize(recs, "1y", now)
  assert.equal(y.fuel_count, 2) // 2025-10-01 不在 1 年内（从 2025-10-02 起）
  assert.equal(y.distance_km, 20500 - 10400)
  assert.equal(y.discount, 20)
  assert.equal(y.days_per_fill, 10)
  assert.equal(y.paid_unit_price, 7.8)
  assert.equal(y.pump_unit_price, 8)
  assert.ok(Math.abs((y.km_per_day as number) - 10100 / 364) < 1)
  const months = monthlyCosts(recs, "1y", now)
  assert.equal(months[0].month, "2025-10")
  assert.equal(months[months.length - 1].month, "2026-10")
  assert.equal(months.length, 13)
  assert.equal(months.find(m => m.month === "2026-09")?.fills, 2)
  const yoy = yearOverYear(recs, now)
  assert.equal(yoy.year, 2026)
  assert.equal(yoy.current[8], 10) // 9 月：50 升 / 500 km
  assert.equal(yoy.previous[9], 10) // 去年 10 月：40 升 / 400 km
  const years = yearSummaries(recs)
  assert.deepEqual(years.map(x => x.year), [2026, 2025])
  assert.equal(years[0].distance_km, 20500 - 10400)
  assert.equal(priceSeries(recs, "all", now)[1].paid, 7.5)
})

test("图表横轴：每月第一个点写月份，1 月写年份，重复的看起来一样但能区分", async () => {
  const { monthCategories, timeCategories } = await import("../common/chart_axis")
  const t = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  const c = timeCategories([t(2025, 11, 2), t(2025, 11, 8), t(2025, 12, 4), t(2026, 1, 7), t(2026, 1, 15), t(2026, 1, 15)])
  assert.deepEqual(c.labels.map(l => l.replace(/​/g, "")), ["11月", "11/8", "12月", "2026", "1/15", "1/15"])
  assert.equal(new Set(c.labels).size, 6, "同一天两次加油也能区分")
  assert.deepEqual(c.ticks, ["11月", "12月", "2026"])
  const m = monthCategories(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
  assert.equal(m.labels[0], "10月")
  assert.equal(m.labels[12], "10月​", "跨年的同名月份")
  assert.equal(m.labels[3], "2026")
  assert.ok(m.ticks.length <= 7)
  const long = monthCategories(Array.from({ length: 60 }, (_, i) => `${2021 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`))
  assert.deepEqual(long.ticks, ["2021", "2022", "2023", "2024", "2025"])
})

test("加油停车提示：只提示最近 2 天、未记录、未忽略的加油停车", async () => {
  const { openRefuelStop } = await import("../common/stops")
  const now = Date.UTC(2026, 9, 18, 2, 0)
  const stop = (end_ts: number, refuel = true) => ({
    trip: { id: String(end_ts), start_ts: end_ts - 600e3, end_ts, start_odometer_km: 1, end_odometer_km: 83431.4, distance_km: 1, fuel_l: null, start: null, end: null },
    end_ts, place: null, odometer_km: 83431.4, stay_min: 8, candidate: null, refuel, recorded: null,
  })
  const recent = stop(now - 3600e3)
  const old = stop(now - 3 * 86400e3)
  const notRefuel = stop(now - 1800e3, false)
  assert.equal(openRefuelStop([old, recent, notRefuel], [], [], now)?.end_ts, recent.end_ts)
  // 停车后加了记录：不再提示
  assert.equal(openRefuelStop([recent], [fuel("r", { ts: recent.end_ts + 10 * 60e3 })], [], now), null)
  // 点了忽略
  assert.equal(openRefuelStop([recent], [], [recent.end_ts], now), null)
  // 太久以前
  assert.equal(openRefuelStop([old], [], [], now), null)
})

test("小熊签名 key：常量与 md5(盐) 一致", async () => {
  const { BACKUP_KEY, BACKUP_KEY_SALT } = await import("../sync/xxyh/api")
  assert.equal(md5(BACKUP_KEY_SALT), BACKUP_KEY)
  assert.equal(createHash("md5").update(BACKUP_KEY_SALT).digest("hex"), BACKUP_KEY)
})
