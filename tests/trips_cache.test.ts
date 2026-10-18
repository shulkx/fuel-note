// 共用行程检测（设计文档 16.6 节）：停车缓存、按当前数据重新判断、附近油站缓存、沃尔沃会话缓存
import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createStopSource, StopsSnapshot } from "../common/stop_source"
import { SessionStore } from "../providers/types"
import { refreshStops, Stop } from "../common/stops"
import { Station } from "../common/types"
import { createPoiCache, poiCacheKey, POI_TTL_MS, prunePoiCache, PoiCacheEntries } from "../stations/poi_cache"
import { volvoCn } from "../providers/volvo_cn"
import { HttpRequest } from "../platform/http"
import { fuel } from "./helpers"

const MIN = 60e3
const T0 = Date.UTC(2026, 9, 18, 1, 0)

function stop(end_ts: number, d: Partial<Stop> = {}): Stop {
  return {
    trip: { id: String(end_ts), start_ts: end_ts - 10 * MIN, end_ts, start_odometer_km: 1, end_odometer_km: 83431.4, distance_km: 1, fuel_l: null, start: null, end: null },
    end_ts, place: { lng: 121.6, lat: 31.23, address: "示例路", city: "上海市", district: "浦东新区" },
    odometer_km: 83431.4, stay_min: 8, candidate: null, refuel: false, recorded: null, ...d,
  }
}

function station(id: string, lng: number, lat: number): Station {
  return { id, name: `油站${id}`, address: "", province: "上海市", city: "上海市", district: "浦东新区", lng, lat, last_used_ts: 0 }
}

/** 可控的时钟和读取次数 */
function harness(persisted: Record<string, StopsSnapshot> = {}) {
  let now = T0
  const saved: StopsSnapshot[] = []
  const source = createStopSource({
    load: key => persisted[key] || null,
    save: s => { saved.push(s); persisted[s.key] = s },
    now: () => now,
  })
  let calls = 0
  const fetcher = async () => { calls++; return [stop(now - 30 * MIN)] }
  return { source, fetcher, saved, calls: () => calls, advance: (ms: number) => { now += ms }, now: () => now }
}

test("停车缓存：10 分钟内直接用缓存，过期、下拉刷新、付款时间更晚时重新读取", async () => {
  const h = harness()
  await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 1)
  h.advance(5 * MIN)
  await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 1, "缓存还新鲜")
  await h.source.get("v", h.fetcher, { force: true })
  assert.equal(h.calls(), 2, "下拉刷新")
  await h.source.get("v", h.fetcher, { needAfter: h.now() + MIN })
  assert.equal(h.calls(), 3, "付款时间晚于缓存")
  h.advance(11 * MIN)
  await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 4, "超过 10 分钟")
  assert.equal(h.saved.length, 4)
  assert.equal(h.saved[3].to - h.saved[3].from, 7 * 86400e3)
})

test("停车缓存：同时多处调用只发一个请求", async () => {
  const h = harness()
  let release: () => void = () => undefined
  let calls = 0
  const slow = () => { calls++; return new Promise<Stop[]>(resolve => { release = () => resolve([stop(T0 - MIN)]) }) }
  const a = h.source.get("v", slow)
  const b = h.source.get("v", slow)
  assert.equal(h.source.loading("v"), true)
  release()
  const [ra, rb] = await Promise.all([a, b])
  assert.equal(calls, 1)
  assert.equal(ra, rb)
  assert.equal(h.source.loading("v"), false)
})

test("停车缓存：冷启动读文件里的缓存；读取失败不留缓存，下次重试", async () => {
  const persisted = { v: { key: "v", fetched_at: T0 - 2 * MIN, from: 0, to: T0, stops: [stop(T0 - 20 * MIN)] } }
  const h = harness(persisted)
  assert.equal(h.source.peek("v")?.stops.length, 1)
  await h.source.get("v", h.fetcher)
  assert.equal(h.calls(), 0, "文件里的缓存还新鲜")
  assert.equal(h.source.peek("other"), null)

  const failing = async (): Promise<Stop[]> => { throw new Error("网络错误") }
  await assert.rejects(h.source.get("w", failing), /网络错误/)
  assert.equal(h.source.loading("w"), false)
  assert.equal(h.source.peek("w"), null)
  await h.source.get("w", h.fetcher)
  assert.equal(h.calls(), 1)
})

test("缓存的停车按当前数据重新判断：已记录、之后新建的油站", () => {
  const s = stop(T0, { refuel: true, candidate: { kind: "new", station: station("new1", 121.6003, 31.2301), dist: 30, src: "amap" } })
  // 还没记录、油站还没建
  let [r] = refreshStops([s], [], [])
  assert.equal(r.recorded, null)
  assert.equal(r.candidate?.kind, "new")
  // 之后在这个油站记了加油：已记录，推荐的油站改用已有的
  const created = station("s9", 121.6003, 31.2301);
  [r] = refreshStops([s], [created], [fuel("f1", { ts: T0 + 6 * MIN })])
  assert.equal(r.recorded?.id, "f1")
  assert.equal(r.candidate?.kind, "mine")
  assert.equal(r.candidate?.station.id, "s9")
  // 原来没认出是加油停车的停车，旁边现在有我的油站：算作加油停车
  const plain = stop(T0 - 3600e3, { refuel: false, candidate: null });
  [r] = refreshStops([plain], [station("s1", 121.6002, 31.2300)], [])
  assert.equal(r.refuel, true)
  assert.equal(r.candidate?.station.id, "s1")
  // 停留太久的不算
  const long = stop(T0 - 7200e3, { stay_min: 120 });
  [r] = refreshStops([long], [station("s1", 121.6002, 31.2300)], [])
  assert.equal(r.refuel, false)
})

test("附近油站缓存：同一网格 30 天内不重复查询；出错不缓存", async () => {
  let now = T0
  let stored: PoiCacheEntries | null = null
  const cache = createPoiCache({ load: () => stored, save: e => { stored = e }, now: () => now })
  let calls = 0
  const nearby = async () => { calls++; return [{ name: "加油站", address: "", province: "", city: "", district: "", lng: 121.6, lat: 31.23, src: "amap" as const }] }
  const wrapped = cache.wrap("高德", nearby)
  await wrapped([121.60001, 31.23001], 200)
  await wrapped([121.60008, 31.23006], 200) // 同一网格（约 10 米外）
  assert.equal(calls, 1)
  await wrapped([121.60001, 31.23001], 2000) // 半径不同
  assert.equal(calls, 2)
  assert.notEqual(poiCacheKey("高德", [121.6, 31.23], 200), poiCacheKey("小熊油耗", [121.6, 31.23], 200))
  now += POI_TTL_MS + 1
  await wrapped([121.60001, 31.23001], 200)
  assert.equal(calls, 3, "过期后重新查询")
  assert.ok(stored && Object.keys(stored).length >= 1)

  let failing = 0
  const broken = cache.wrap("小熊油耗", async () => { failing++; throw new Error("超时") })
  await assert.rejects(broken([121.7, 31.3], 200))
  await assert.rejects(broken([121.7, 31.3], 200))
  assert.equal(failing, 2)

  const pruned = prunePoiCache({ a: { at: now, pois: [] }, b: { at: now - POI_TTL_MS - 1, pois: [] }, c: { at: now - 1, pois: [] } }, now, 1)
  assert.deepEqual(Object.keys(pruned), ["a"])
})

test("沃尔沃会话：冷启动用钥匙串里的缓存；换了凭据或快过期时重新换", async () => {
  const urls: string[] = []
  let lastAuth = ""
  const http = async (req: HttpRequest) => {
    urls.push(req.url)
    if (req.url.includes("/refreshToken")) {
      return { status: 200, text: JSON.stringify({ code: 200, data: { accessToken: "a", jwtToken: "j", globalAccessToken: "g-new", expiresIn: 1800 } }) }
    }
    lastAuth = String(req.headers?.authorization)
    return { status: 200, text: JSON.stringify({ trips: [] }) }
  }
  const refreshes = () => urls.filter(u => u.includes("/refreshToken")).length
  const fp = (rt: string) => createHash("sha256").update(rt).digest("hex").slice(0, 16)
  const cached = (rt: string, expiresAt: number) => JSON.stringify({ accessToken: "a", jwtToken: "j", globalAccessToken: "g-cached", expiresAt, fp: fp(rt) })
  const run = (rt: string, store: SessionStore) =>
    volvoCn.fetchTrips({ http, now: () => T0, sessionStore: store }, { refreshToken: rt }, "VIN", { from: T0 - 86400e3, to: T0 })

  // 每个用例用不同的 refresh token，内存里都没有会话，相当于冷启动
  // 1. 缓存属于同一凭据、没过期：不换会话
  await run("rt-a", { get: () => cached("rt-a", T0 + 20 * MIN), set: () => undefined })
  assert.equal(refreshes(), 0)
  assert.equal(lastAuth, "Bearer g-cached")

  // 2. 缓存属于别的凭据：重新换，并写入新的缓存（只存指纹，不存 refresh token）
  let stored: string | null = cached("rt-other", T0 + 20 * MIN)
  await run("rt-b", { get: () => stored, set: v => { stored = v } })
  assert.equal(refreshes(), 1)
  assert.equal(lastAuth, "Bearer g-new")
  assert.equal(JSON.parse(stored!).fp, fp("rt-b"))
  assert.ok(!stored!.includes("rt-b"))

  // 3. 不到 2 分钟就过期：重新换
  await run("rt-c", { get: () => cached("rt-c", T0 + 60e3), set: () => undefined })
  assert.equal(refreshes(), 2)
})
