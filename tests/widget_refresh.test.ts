// 小组件自己读车况（设计文档 18.3 节第 2 步）：什么时候读、几个小组件同时刷新只读一次、读不到显示上次的、写回 widget.json
import { test } from "node:test"
import assert from "node:assert/strict"
import { StatusSnapshot } from "../common/status_source"
import { EMPTY_WIDGET, StatusLink, widgetRefreshDate, WidgetSnapshot } from "../common/widget_data"
import { refreshWidgetStatus, WIDGET_LOCK_MS, WidgetRefreshDeps } from "../common/widget_refresh"
import { VehicleStatus } from "../providers/types"

const MIN = 60e3
const T0 = new Date(2026, 9, 19, 12, 0).getTime()
const LINK: StatusLink = { key: "v1|volvo_cn|VIN", provider: "volvo_cn", vehicle_id: "VIN", tank_l: 55 }

function status(fuel_l: number): VehicleStatus {
  return { ts: T0 - 90 * MIN, fuel_l, range_km: 430, avg_consumption: 13.2, odometer_km: 82959.065 }
}

function snapshot(readAgoMin: number | null, d: Partial<WidgetSnapshot> = {}): WidgetSnapshot {
  return {
    ...EMPTY_WIDGET, updated_at: T0 - 120 * MIN, vehicle: "S90", status_source: true, status_link: LINK,
    status: readAgoMin == null ? null : { ts: T0 - 90 * MIN, fuel_l: 52, range_km: 450, tank_l: 55, read_at: T0 - readAgoMin * MIN },
    ...d,
  }
}

function harness(file: WidgetSnapshot, opts: { cache?: StatusSnapshot; lock?: number; noCredential?: boolean; fail?: string } = {}) {
  const state = { file, cache: opts.cache ? { [opts.cache.key]: opts.cache } as Record<string, StatusSnapshot> : {}, lock: opts.lock || 0, reads: 0, saves: 0 }
  const deps: WidgetRefreshDeps = {
    now: () => T0,
    reader: () => opts.noCredential ? null : async () => {
      state.reads++
      assert.ok(state.lock > 0, "读的时候持有锁")
      if (opts.fail) throw new Error(opts.fail)
      return status(50)
    },
    loadStatus: key => state.cache[key] || null,
    saveStatus: snap => { state.cache[snap.key] = snap },
    readLock: () => state.lock,
    writeLock: at => { state.lock = at },
    latest: () => state.file,
    save: s => { state.file = s; state.saves++ },
  }
  return { state, deps }
}

test("车况 1 小时内读过、没有车况来源的车：不读；各尺寸都显示车况（1.2.2 起锁屏横条、单行也读）", async () => {
  const fresh = harness(snapshot(30))
  assert.equal(await refreshWidgetStatus(fresh.state.file, "systemSmall", fresh.deps), fresh.state.file)
  const plain = harness(snapshot(null, { status_source: false, status_link: null }))
  await refreshWidgetStatus(plain.state.file, "systemSmall", plain.deps)
  assert.equal(fresh.state.reads + plain.state.reads, 0)
  assert.equal(fresh.state.saves + plain.state.saves, 0)
  for (const family of ["accessoryRectangular", "accessoryInline", "accessoryCircular", "systemMedium"]) {
    const h = harness(snapshot(120))
    await refreshWidgetStatus(h.state.file, family, h.deps)
    assert.equal(h.state.reads, 1, family)
  }
})

test("车况超过 1 小时：读一次，写回车况缓存和 widget.json，油箱容量取 status_link；锁用完释放", async () => {
  const h = harness(snapshot(120))
  const s = await refreshWidgetStatus(h.state.file, "systemMedium", h.deps)
  assert.equal(h.state.reads, 1)
  assert.deepEqual(s.status, { ts: T0 - 90 * MIN, fuel_l: 50, range_km: 430, tank_l: 55, odometer_km: 82959.065, read_at: T0 })
  assert.equal(h.state.file, s)
  assert.equal(h.state.cache[LINK.key].status.fuel_l, 50)
  assert.equal(h.state.lock, 0)
  assert.equal(h.state.saves, 1)
  // 还没有过车况（油记关联后还没读到）也读
  const none = harness(snapshot(null))
  assert.equal((await refreshWidgetStatus(none.state.file, "accessoryCircular", none.deps)).status!.fuel_l, 50)
})

test("油记或别的小组件 1 小时内读过（车况缓存比 widget.json 新）：直接用，不发请求", async () => {
  const h = harness(snapshot(120), { cache: { key: LINK.key, read_at: T0 - 20 * MIN, status: status(51) } })
  const s = await refreshWidgetStatus(h.state.file, "systemSmall", h.deps)
  assert.equal(h.state.reads, 0)
  assert.equal(s.status!.fuel_l, 51)
  assert.equal(s.status!.read_at, T0 - 20 * MIN)
  assert.equal(h.state.lock, 0, "用缓存时不拿锁")
})

test("几个小组件同时刷新：另一个 1 分钟内开始读过就不读；锁过期后照常读", async () => {
  const busy = harness(snapshot(120), { lock: T0 - 10e3 })
  assert.equal((await refreshWidgetStatus(busy.state.file, "systemSmall", busy.deps)).status!.fuel_l, 52)
  assert.equal(busy.state.reads, 0)
  assert.equal(busy.state.saves, 0)
  const stale = harness(snapshot(120), { lock: T0 - WIDGET_LOCK_MS - 1 })
  await refreshWidgetStatus(stale.state.file, "systemSmall", stale.deps)
  assert.equal(stale.state.reads, 1)
})

test("读不到（网络、凭据）：显示上次的车况，不写文件", async () => {
  const fail = harness(snapshot(120), { fail: "请求超时：cepmobtoken.prod.c3.volvocars.com.cn" })
  const s = await refreshWidgetStatus(fail.state.file, "systemSmall", fail.deps)
  assert.equal(s.status!.fuel_l, 52)
  assert.equal(fail.state.saves, 0)
  assert.equal(fail.state.lock, 0)
  const noCred = harness(snapshot(120), { noCredential: true })
  assert.equal((await refreshWidgetStatus(noCred.state.file, "systemSmall", noCred.deps)).status!.fuel_l, 52)
  assert.equal(noCred.state.saves + noCred.state.lock, 0)
})

test("读的时候油记换了车辆：不改油记写的摘要", async () => {
  const h = harness(snapshot(120))
  const other = snapshot(null, { vehicle: "另一辆", status_link: { ...LINK, key: "v2|volvo_cn|VIN2" } })
  h.deps.latest = () => other
  const s = await refreshWidgetStatus(snapshot(120), "systemSmall", h.deps)
  assert.equal(s, other)
  assert.equal(h.state.saves, 0)
})

test("刷新时间：显示车况的 1 小时后，没有车况来源的零点后", () => {
  const s = snapshot(10)
  assert.equal(widgetRefreshDate(s, "systemSmall", T0).getTime(), T0 + 60 * MIN)
  assert.equal(widgetRefreshDate(s, "accessoryRectangular", T0).getTime(), T0 + 60 * MIN)
  assert.equal(widgetRefreshDate({ ...s, status_source: false }, "systemSmall", T0).getTime(), new Date(2026, 9, 20, 0, 1).getTime())
  // 23:30 时：零点后 1 分钟更早
  const late = new Date(2026, 9, 19, 23, 30).getTime()
  assert.equal(widgetRefreshDate(s, "systemSmall", late).getTime(), new Date(2026, 9, 20, 0, 1).getTime())
  assert.equal(widgetRefreshDate({ ...s, status_link: null }, "systemSmall", T0).getTime(), new Date(2026, 9, 20, 0, 1).getTime())
})
