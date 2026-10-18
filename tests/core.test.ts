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
  assert.match(checkFuel({ ...base, amount: 330 }, others).warnings.join(), /相差/)
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
  const year = summarize(recs, "year", Date.UTC(2026, 5, 1))
  assert.equal(year.distance_km, 500) // 1500 − 范围之前的 1000
  assert.equal(year.total_cost, 400)
  assert.equal(year.cost_per_km, 0.8)
})

test("底部提示：只提示最近 2 天、未记录、未忽略的加油停车", async () => {
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
