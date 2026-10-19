// 车况缓存和显示（设计文档 18.1、18.2 节）：缓存 10 分钟、同一辆车只发一个请求、原始字段不存；油量条、油量低、车况时间
import { test } from "node:test"
import assert from "node:assert/strict"
import { createStatusSource, StatusSnapshot, STATUS_TTL_MS } from "../common/status_source"
import { EMPTY_WIDGET, fuelLow, fuelRatio, statusStale, statusWhen } from "../common/widget_data"
import { VehicleStatus } from "../providers/types"

const MIN = 60e3
// 2026-10-19 11:00（本机时区）
const T0 = new Date(2026, 9, 19, 11, 0).getTime()

function status(fuel_l: number): VehicleStatus {
  return { ts: T0 - 60 * MIN, fuel_l, range_km: 430, avg_consumption: 13.2, odometer_km: 82959.065, raw: ["GetFuel 2=430 4=50（float）"] }
}

function harness(persisted: Record<string, StatusSnapshot> = {}) {
  let now = T0
  const saved: StatusSnapshot[] = []
  const source = createStatusSource({
    load: key => persisted[key] || null,
    save: s => { saved.push(s); persisted[s.key] = s },
    now: () => now,
  })
  let calls = 0
  const fetcher = async () => { calls++; return status(50 - calls) }
  return { source, fetcher, saved, calls: () => calls, advance: (ms: number) => { now += ms } }
}

test("车况缓存：10 分钟内直接用，过期或强制时重新读取；原始字段不存", async () => {
  const h = harness()
  const a = await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 1)
  assert.equal(a.status.fuel_l, 49)
  assert.deepEqual(a.status.raw, [])
  assert.equal(h.saved.length, 1)
  h.advance(STATUS_TTL_MS - 1)
  assert.equal((await h.source.get("v", h.fetcher)).status.fuel_l, 49)
  assert.equal(h.calls(), 1)
  assert.equal((await h.source.get("v", h.fetcher, { force: true })).status.fuel_l, 48)
  h.advance(STATUS_TTL_MS)
  assert.equal((await h.source.get("v", h.fetcher)).status.fuel_l, 47)
  assert.equal(h.calls(), 3)
})

test("车况缓存：同一辆车同时只发一个请求；读取失败不留缓存；冷启动从文件读", async () => {
  const h = harness()
  const [x, y] = await Promise.all([h.source.get("v", h.fetcher), h.source.get("v", h.fetcher)])
  assert.equal(h.calls(), 1)
  assert.equal(x, y)

  const failing = harness()
  await assert.rejects(failing.source.get("v", async () => { throw new Error("网络请求失败") }))
  assert.equal(failing.source.peek("v"), null)
  // 失败后可以再读
  assert.equal((await failing.source.get("v", failing.fetcher)).status.fuel_l, 49)

  const persisted: Record<string, StatusSnapshot> = { v: { key: "v", read_at: T0 - 5 * MIN, status: status(52) } }
  const cold = harness(persisted)
  assert.equal(cold.source.peek("v")!.status.fuel_l, 52)
  assert.equal((await cold.source.get("v", cold.fetcher)).status.fuel_l, 52)
  assert.equal(cold.calls(), 0)
  // 文件里别的车的车况不会被拿错
  assert.equal(cold.source.peek("w"), null)
})

test("车况缓存：小组件写进文件的更新（比内存里的新）在读取时优先用", async () => {
  const persisted: Record<string, StatusSnapshot> = {}
  const h = harness(persisted)
  await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 1)
  h.advance(30 * MIN)
  // 小组件在 25 分钟时读过一次
  persisted.v = { key: "v", read_at: T0 + 25 * MIN, status: status(45) }
  const got = await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 1)
  assert.equal(got.status.fuel_l, 45)
  assert.equal(h.source.peek("v")!.status.fuel_l, 45)
})

test("油量条和油量低：低于油箱 15% 为油量低；不知道油箱时看续航（80 km）", () => {
  assert.equal(fuelRatio(50, 55), 50 / 55)
  assert.equal(fuelRatio(60, 55), 1)
  assert.equal(fuelRatio(50, null), null)
  assert.equal(fuelRatio(null, 55), null)
  // 55 升的 15% 是 8.25 升
  assert.equal(fuelLow(8.3, 55, 90), false)
  assert.equal(fuelLow(8.2, 55, 300), true)
  assert.equal(fuelLow(6, null, 45), true)
  assert.equal(fuelLow(6, null, 120), false)
  assert.equal(fuelLow(null, null, null), false)
})

test("车况时间：今天、昨天、更早写日期；超过 1 天算旧数据", () => {
  const now = T0
  assert.equal(statusWhen(new Date(2026, 9, 19, 9, 5).getTime(), now), "今天 09:05")
  assert.equal(statusWhen(new Date(2026, 9, 18, 15, 20).getTime(), now), "昨天 15:20")
  assert.equal(statusWhen(new Date(2026, 9, 16, 15, 20).getTime(), now), "10/16 15:20")
  assert.equal(statusStale(now - 23 * 60 * MIN, now), false)
  assert.equal(statusStale(now - 25 * 60 * MIN, now), true)
  assert.equal(statusStale(null, now), true)
})

test("小组件摘要：旧版 widget.json 没有车况字段时按没有车况来源处理", () => {
  const old = { ...EMPTY_WIDGET, ...JSON.parse('{"schema_version":1,"updated_at":1,"vehicle":"S90","latest_consumption":11.6}') }
  assert.equal(old.status_source, false)
  assert.equal(old.status, null)
})
