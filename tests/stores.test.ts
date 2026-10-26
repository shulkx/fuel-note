// 门店接高德（2.1 设计第 10 节）：高德搜索结果的解析、从高德地点建门店（名称去掉分店名）、同一个地点不重复加、重新定位、用到这家店的条数、
// 读账本时补上新字段、记费用那时停车的地方。编造的数据，不联网。
import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeLedger } from "../common/ledger_file"
import { addStore, parkedAt, relocatedStore, shortStoreName, storeFromPoi, storeOfPoi, storeUsage } from "../common/stores"
import { emptyLedger, Store } from "../common/types"
import { poiKind, storePoi, storesByKeyword, storesNearby, STORE_TYPES } from "../stations/store_search"
import { Http } from "../platform/http"

const AMAP_POI = {
  id: "B00155L3J1", name: "示例汽车销售服务有限公司（滨江店）", location: "121.473700,31.230400", address: "示例路100号", pname: "上海市", cityname: "上海市", adname: "徐汇区",
  type: "汽车销售;沃尔沃销售;沃尔沃4S店|汽车维修;沃尔沃维修", distance: "8", business: { tel: "021-00000000;021-11111111", opentime_today: "08:30-17:00" },
}

test("高德的地点：类型取每段的第一级、电话取第一个、营业时间、距离；坐标换成 WGS-84", () => {
  const p = storePoi(AMAP_POI)
  assert.deepEqual([p.poi_id, p.name, p.address, p.district, p.city, p.kind, p.phone, p.hours, p.distance],
    ["B00155L3J1", "示例汽车销售服务有限公司（滨江店）", "示例路100号", "徐汇区", "上海市", "汽车销售 · 汽车维修", "021-00000000", "08:30-17:00", 8])
  assert.ok(Math.abs(p.lng - 121.4737) > 0.001 && Math.abs(p.lng - 121.4737) < 0.01, "GCJ-02 换算成 WGS-84")
  assert.equal(poiKind("洗车场;洗车场"), "洗车场")
  assert.equal(storePoi({ ...AMAP_POI, distance: "", business: undefined }).distance, null)
})

test("周边和关键字搜索：只搜汽车销售、维修、养护和洗车场，带上营业信息；GET 请求；网址里没有没编码的字符", async () => {
  const urls: string[] = []
  const http: Http = async req => {
    urls.push(req.url)
    assert.equal(req.method ?? "GET", "GET")
    return { status: 200, text: JSON.stringify({ status: "1", pois: [AMAP_POI] }) }
  }
  const near = await storesNearby(http, "k", [121.47, 31.23])
  const found = await storesByKeyword(http, "k", "示例", "上海市")
  assert.equal(near[0].poi_id, "B00155L3J1")
  assert.equal(found.length, 1)
  for (const u of urls) {
    assert.ok(u.includes(`types=${encodeURIComponent(STORE_TYPES)}`) && u.includes("show_fields=business"), u)
    // 手机上带「|」这类字符的网址会被整个再编码一次，中文关键字编码两次后高德一条也找不到
    assert.ok(/^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]*$/.test(u), `网址里有没编码的字符：${u}`)
  }
  assert.ok(urls[0].includes("/v5/place/around") && urls[0].includes("sortrule=distance"))
  assert.ok(urls[1].includes("/v5/place/text") && urls[1].includes(`region=${encodeURIComponent("上海市")}`))
})

test("从高德地点建门店：名称去掉末尾括号里的分店名，全称、地址、电话、营业时间、坐标、地点 id 照高德；没有经销商代码", () => {
  assert.equal(shortStoreName("优车美装（正大乐城）"), "优车美装")
  assert.equal(shortStoreName("示例汽车销售服务有限公司"), "示例汽车销售服务有限公司")
  assert.equal(shortStoreName("（只有括号）"), "（只有括号）")
  const s = storeFromPoi(storePoi(AMAP_POI))
  assert.deepEqual([s.id, s.name, s.full_name, s.phone, s.hours, s.poi_id, s.dealer], ["", "示例汽车销售服务有限公司", "示例汽车销售服务有限公司（滨江店）", "021-00000000", "08:30-17:00", "B00155L3J1", null])
})

test("同一个高德地点不重复加；重新定位时 id、名称、经销商代码不变", () => {
  const s: Store = { ...storeFromPoi(storePoi(AMAP_POI)), id: "st1", name: "我起的名字", dealer: { provider: "volvo_cn", code: "SHK" } }
  const again = addStore([s], storeFromPoi(storePoi(AMAP_POI)), () => "st2")
  assert.deepEqual([again.stores.length, again.store.id], [1, "st1"])
  const other = addStore([s], { ...storeFromPoi(storePoi(AMAP_POI)), poi_id: "B0OTHER" }, () => "st2")
  assert.deepEqual([other.stores.length, other.store.id], [2, "st2"])
  assert.equal(storeOfPoi([s], "B00155L3J1")?.id, "st1")
  assert.equal(storeOfPoi([s], ""), null)
  const moved = relocatedStore(s, { ...storePoi(AMAP_POI), poi_id: "B0NEW", name: "新地点", address: "新路1号" })
  assert.deepEqual([moved.id, moved.name, moved.dealer, moved.poi_id, moved.full_name, moved.address], ["st1", "我起的名字", s.dealer, "B0NEW", "新地点", "新路1号"])
})

test("用到这家店的费用和权益卡；读账本时给门店补上 2.1 的字段", () => {
  const l = emptyLedger()
  l.records.push({ kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100003, amount: 10, remark: "", store_id: "st1" })
  l.perks.push({ id: "p1", vehicle_id: "v1", name: "洗车", kind: "count", total: 1, unit: "次", end_ts: null, store_id: "st1", source: "", insurance_id: null, origin: "other", raw: "", note: "", created_ts: 0 })
  assert.deepEqual(storeUsage(l, "st1"), { expenses: 1, perks: 1 })
  const n = normalizeLedger({ ...l, stores: [{ id: "st1", name: "示例店", full_name: "", address: "", phone: "", lng: null, lat: null }] })
  assert.deepEqual([n.stores[0].hours, n.stores[0].poi_id, n.stores[0].dealer], ["", "", null])
})

test("记费用那时停车的地方：停车之后、开走之前；最后一站还没开走也算；在路上时没有", () => {
  const H = 3600e3
  const stops = [{ end_ts: 1 * H, stay_min: 60 }, { end_ts: 5 * H, stay_min: 120 }, { end_ts: 10 * H, stay_min: null }]
  assert.equal(parkedAt(stops, 5.5 * H), stops[1])
  assert.equal(parkedAt(stops, 9 * H), null, "停了 2 小时，过了半小时以上，车已经开走")
  assert.equal(parkedAt(stops, 30 * H), stops[2])
  assert.equal(parkedAt(stops, 0.5 * H), null)
})
