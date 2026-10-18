// 车辆管理（设计文档第 17 节）：小熊车型库的解析、云端车辆的资料、隐藏车辆与当前车辆
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  fetchBrands, fetchSpec, gradeOf, groupBrands, groupModels, parseBrands, parseItems, parseSpec, replenishModeOf, splitBrandName,
} from "../sync/xxyh/catalog"
import { carProfile, carsOf } from "../sync/xxyh/mapping"
import { currentVehicle, makeAppData, setHidden, visibleVehicles } from "../common/ledger"
import { emptyLedger, Vehicle } from "../common/types"
import { emptyXxyhState } from "../sync/xxyh/types"
import { Http } from "../platform/http"

test("车型库：品牌去掉首字母前缀并按首字母分组；车系、车型；车型按年款分组", () => {
  assert.deepEqual(splitBrandName("W 沃尔沃"), { letter: "W", name: "沃尔沃" })
  assert.deepEqual(splitBrandName("a AIVA"), { letter: "A", name: "AIVA" })
  assert.deepEqual(splitBrandName("Smart"), { letter: "S", name: "Smart" })
  assert.deepEqual(splitBrandName("东风"), { letter: "#", name: "东风" })
  const brands = parseBrands({ idxes: [70, 609, 1], names: ["W 沃尔沃", "A AITO 问界", "东风"], logos: ["https://cdn/70.png", "", null] })
  assert.deepEqual(brands, [
    { id: 70, name: "沃尔沃", letter: "W", logo: "https://cdn/70.png" },
    { id: 609, name: "AITO 问界", letter: "A", logo: null },
    { id: 1, name: "东风", letter: "#", logo: null },
  ])
  assert.deepEqual(groupBrands(brands).map(g => g.letter), ["A", "W", "#"])
  assert.deepEqual(parseItems({ idxes: [3158, 4206], names: ["沃尔沃S60", "沃尔沃S90"] }), [{ id: 3158, name: "沃尔沃S60" }, { id: 4206, name: "沃尔沃S90" }])
  assert.deepEqual(parseItems({}), [])
  const groups = groupModels(parseItems({ idxes: [73607, 73987, 68766, 9], names: ["2026款 B4 智远运动版", "2026款 B4 智远豪华版", "2025款 B4 智逸豪华版", "概念车"] }))
  assert.deepEqual(groups, [
    { year: "2026款", models: [{ id: 73607, name: "B4 智远运动版" }, { id: 73987, name: "B4 智远豪华版" }] },
    { year: "2025款", models: [{ id: 68766, name: "B4 智逸豪华版" }] },
    { year: "其他", models: [{ id: 9, name: "概念车" }] },
  ])
})

test("车型参数：读出燃料、标号、油箱；不支持的车型（status 23）返回 null；标号和补能方式与网页版相同", () => {
  const spec = parseSpec({
    status: 0, id: 39739, name: "沃尔沃S90 2020款 T5 智远豪华版", vehicle_type: 1, pinpai: 70, chexi: 4206,
    fuelType: "汽油", gasType: "95号", engine: "2.0T 254马力 L4", gearbox: "8挡手自一体", tank: 55,
  })
  assert.deepEqual(spec, {
    id: 39739, name: "沃尔沃S90 2020款 T5 智远豪华版", pinpai: 70, chexi: 4206, vehicle_type: 1,
    fuel_type: "汽油", gas_type: "95号", engine: "2.0T 254马力 L4", gearbox: "8挡手自一体", tank: 55,
  })
  assert.equal(parseSpec({ status: 23, id: null }), null)
  assert.throws(() => parseSpec({ status: 1, message: "服务器忙" }), /服务器忙/)
  assert.equal(gradeOf("95号"), 95)
  assert.equal(gradeOf("92#"), 92)
  assert.equal(gradeOf("0号"), 0)
  assert.equal(gradeOf(null, "柴油"), 0)
  assert.equal(gradeOf(null, "纯电动"), null)
  assert.equal(gradeOf("89号"), null)
  assert.equal(replenishModeOf("汽油+48V轻混系统"), 1)
  assert.equal(replenishModeOf("纯电动"), 2)
  assert.equal(replenishModeOf("插电式混合动力"), 3)
  assert.equal(replenishModeOf("增程式"), 3)
  assert.equal(replenishModeOf(null), 1)
})

test("车型库：品牌把汽车、摩托车、货车三份合在一起；车型参数走 index.php", async () => {
  const urls: string[] = []
  const http: Http = async req => {
    urls.push(req.url)
    const c = /[?&]c=([a-z]+)/.exec(req.url)![1]
    const body = c === "chexingspecification"
      ? { status: 23 }
      : { status: 0, data: { idxes: [c === "pinpai" ? 70 : c === "moto" ? 900008 : 601602], names: [`A ${c}`] } }
    return { status: 200, headers: {}, text: JSON.stringify(body) }
  }
  const brands = await fetchBrands(http)
  assert.deepEqual(brands.map(b => b.id), [70, 900008, 601602])
  assert.equal(await fetchSpec(http, 99), null)
  assert.ok(urls.every(u => u.startsWith("https://www.xiaoxiongyouhao.com/api/")))
  assert.ok(urls.some(u => u.includes("/api/index.php?a=q&c=chexingspecification&chexing=99")))
})

test("云端车辆的资料：iOS App 与网页版的字段都认；model 为 -1 时没有车型", () => {
  const ios = carProfile({ uuid: "1045409933", name: "沃尔沃S90", model: 39739, vehicle_type: 1, replenishMode: 1, buyDate: "2020-01-09", sortId: 0 })
  assert.deepEqual(ios, { model: 39739, model_name: null, pinpai: null, chexi: null, vehicle_type: 1, replenish_mode: 1, gas_type: null, buy_date: "2020-01-09" })
  const web = carProfile({ uuid: 384729384729384, name: "S60", model: 73607, gasType: "95号", pinpai: 70, chexi: 3158, replenishMode: 1, sortKey: 1 })
  assert.deepEqual([web.model, web.pinpai, web.chexi, web.gas_type, web.buy_date], [73607, 70, 3158, "95号", null])
  assert.equal(carProfile({ uuid: "1", model: -1, buyDate: "2020/01/09" }).model, null)
  assert.equal(carProfile({ uuid: "1", buyDate: "2020/01/09" }).buy_date, null)
  assert.equal(carsOf({ cars: [{ uuid: "1045409933", name: "沃尔沃S90", model: 39739 }] } as any)[0].profile.model, 39739)
})

const vehicle = (id: string, extra: Partial<Vehicle> = {}): Vehicle => ({ id, name: id, default_grade: 95, created_ts: 0, xxyh_car: null, provider: null, ...extra })

test("隐藏车辆：至少保留一辆；隐藏当前车辆时切到另一辆；当前车辆被隐藏时用第一辆没有隐藏的", () => {
  const ledger = emptyLedger()
  ledger.vehicles = [vehicle("a"), vehicle("b"), vehicle("c")]
  ledger.settings.current_vehicle_id = "a"
  let l = setHidden(ledger, "a", true)
  assert.equal(l.settings.current_vehicle_id, "b")
  assert.deepEqual(l.vehicles.map(v => !!v.hidden), [true, false, false])
  l = setHidden(l, "c", true)
  assert.throws(() => setHidden(l, "b", true), /至少保留一辆/)
  const data = makeAppData(l, emptyXxyhState())
  assert.deepEqual(visibleVehicles(data).map(v => v.id), ["b"])
  assert.equal(currentVehicle(data)?.id, "b")
  // 设置里记的当前车辆被隐藏（例如旧数据）：用第一辆没有隐藏的
  const stale = makeAppData({ ...l, settings: { ...l.settings, current_vehicle_id: "a" } }, emptyXxyhState())
  assert.equal(currentVehicle(stale)?.id, "b")
  // 恢复
  l = setHidden(l, "a", false)
  assert.equal(l.vehicles[0].hidden, false)
  assert.throws(() => setHidden(l, "zzz", true), /找不到车辆/)
})
