import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { hmacSha256, md5, sha256 } from "../common/hash"
import { bd09ToWgs84, gcj02ToBd09, gcj02ToWgs84, metres, wgs84ToGcj02 } from "../common/geo"
import { averageConsumption, consumptionById, fuelSegments } from "../common/fuel"
import { checkExpense, checkFuel, completeTriple, parseNum } from "../common/form"
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

test("图表横轴：只有刻度写月份或年份，其他点看不见；每个点都能区分", async () => {
  const { monthCategories, timeCategories, YEAR_MONTHS } = await import("../common/chart_axis")
  const visible = (l: string) => l.replace(/​/g, "")
  const t = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  const c = timeCategories([t(2025, 11, 2), t(2025, 11, 8), t(2025, 12, 4), t(2026, 1, 7), t(2026, 1, 15), t(2026, 1, 15)])
  assert.deepEqual(c.labels.map(visible), ["11月", "", "12月", "2026", "", ""])
  assert.equal(new Set(c.labels).size, 6, "同一天两次加油也能区分")
  assert.deepEqual(c.ticks, ["11月", "12月", "2026"])
  // 一年 12 次加油、跨 7 个月：刻度隔一个月一个
  const year = timeCategories([[4, 19], [4, 28], [5, 3], [5, 12], [5, 19], [5, 21], [5, 29], [6, 20], [7, 21], [8, 9], [9, 6], [10, 3]].map(([m, d]) => t(2026, m, d)))
  assert.deepEqual(year.labels.map(visible).filter(Boolean), ["4月", "6月", "8月", "10月"])
  assert.deepEqual(year.ticks, ["4月", "6月", "8月", "10月"])
  const m = monthCategories(["2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
  assert.deepEqual(m.ticks, ["10月", "12月", "2月", "4月", "6月", "8月", "10月​"], "跨年的同名月份看起来一样但能区分")
  assert.equal(new Set(m.labels).size, 13)
  const long = monthCategories(Array.from({ length: 60 }, (_, i) => `${2021 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`))
  assert.deepEqual(long.ticks, ["2021", "2022", "2023", "2024", "2025"])
  assert.equal(long.labels.map(visible).filter(Boolean).length, 5)
  assert.deepEqual(YEAR_MONTHS.map(visible), ["1月", "", "3月", "", "5月", "", "7月", "", "9月", "", "11月", ""])
  assert.equal(new Set(YEAR_MONTHS).size, 12)
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

test("费用的金额：要填，可以是 0，不能是负数", () => {
  assert.deepEqual(checkExpense(null), ["请填写金额"])
  assert.deepEqual(checkExpense(parseNum("")), ["请填写金额"])
  assert.deepEqual(checkExpense(0), [])
  assert.deepEqual(checkExpense(parseNum("0")), [])
  assert.deepEqual(checkExpense(12.5), [])
  assert.deepEqual(checkExpense(-1), ["金额不能是负数"])
})
