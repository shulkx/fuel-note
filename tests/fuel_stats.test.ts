// 油耗的统计（设计文档 21.3 节）：只收加油记录；每公里油费、每月加油、每年的油费都不含费用
import { test } from "node:test"
import assert from "node:assert/strict"
import { monthFuelCost, monthlyFuel, monthlyMean, priceSeries, summarize, yearOverYear, yearSummaries } from "../common/fuel_stats"
import { DEFAULT_RANGE, isStatsRange, RANGE_TITLES, RANGES, rangeStart } from "../common/ranges"
import { fuel } from "./helpers"

test("油耗统计：里程跨度与每公里油费", () => {
  const recs = [
    fuel("a", { ts: Date.UTC(2025, 5, 1), odometer: 1000, paid: 300 }),
    fuel("b", { ts: Date.UTC(2026, 1, 1), odometer: 1500, liters: 40, paid: 320 }),
  ]
  const all = summarize(recs, "all", Date.UTC(2026, 5, 1))
  assert.equal(all.distance_km, 500)
  assert.equal(all.fuel_cost, 620)
  assert.equal(all.avg_consumption, 8)
  const half = summarize(recs, "6m", Date.UTC(2026, 5, 1))
  assert.equal(half.distance_km, 500) // 1500 − 范围之前的 1000
  assert.equal(half.fuel_cost, 320)
  assert.equal(half.cost_per_km, 0.64) // 只算加油
  assert.equal(half.fuel_count, 1)
})

test("统计范围：今年从 1 月 1 日算起；近半年、近一年往前推；不认识的范围用默认的今年", () => {
  assert.deepEqual(RANGES.map(r => RANGE_TITLES[r]), ["今年", "近半年", "近一年", "全部"])
  assert.equal(DEFAULT_RANGE, "ytd")
  assert.ok(isStatsRange("ytd") && !isStatsRange("3y") && !isStatsRange(null))
  const now = new Date(2026, 9, 19, 2, 4).getTime()
  assert.equal(rangeStart("ytd", now), new Date(2026, 0, 1).getTime())
  assert.equal(rangeStart("6m", now), new Date(2026, 3, 20).getTime())
  assert.equal(rangeStart("1y", now), new Date(2025, 9, 20).getTime())
  assert.equal(rangeStart("all", now), -Infinity)
  // 1 月 1 日当天：今年从当天 0 点开始
  assert.equal(rangeStart("ytd", new Date(2027, 0, 1, 8).getTime()), new Date(2027, 0, 1).getTime())
  // 今年的每月加油从 1 月补到本月；去年 12 月的记录不算
  const recs = [fuel("a", { ts: new Date(2025, 11, 28).getTime(), paid: 300 }), fuel("b", { ts: new Date(2026, 2, 5).getTime(), paid: 400 })]
  const months = monthlyFuel(recs, "ytd", now)
  assert.deepEqual(months.map(m => m.month), ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"])
  assert.equal(months.reduce((t, m) => t + m.cost, 0), 400)
})

test("油耗统计：日均里程、加油间隔、优惠、单价、每月补零、同期对比、每年", () => {
  const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).getTime()
  const rec = (id: string, ts: number, odometer: number, liters: number, amount: number, paid: number, missed = false) =>
    fuel(id, { ts, odometer, liters, amount, paid, price: amount / liters, missed_before: missed })
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
  const months = monthlyFuel(recs, "1y", now)
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
  assert.equal(years[0].cost, 780)
  assert.equal(priceSeries(recs, "all", now)[1].paid, 7.5)
})

test("油耗统计：月均按范围覆盖的天数，不足一个月按一个月；小组件的本月油费只算本月加油", () => {
  const now = new Date(2026, 9, 22, 12).getTime()
  const recs = [fuel("a", { ts: new Date(2026, 0, 5).getTime(), paid: 600 }), fuel("b", { ts: new Date(2026, 9, 9).getTime(), paid: 352.8 })]
  const s = summarize(recs, "ytd", now)
  const days = (now - new Date(2026, 0, 1).getTime()) / 86400e3
  assert.ok(Math.abs((monthlyMean(s, now) as number) - 952.8 * 30.44 / days) < 1e-9)
  // 1 月 6 日看「今年」：才过五天，按一个月算，月均就是合计
  const early = new Date(2026, 0, 6, 12).getTime()
  assert.equal(monthlyMean(summarize(recs.slice(0, 1), "ytd", early), early), 600)
  assert.equal(monthFuelCost(recs, now), 352.8)
  assert.equal(monthFuelCost(recs, new Date(2026, 10, 1).getTime()), 0)
})
