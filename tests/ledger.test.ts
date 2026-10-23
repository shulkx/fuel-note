import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addCarVehicle, carUuidFor, convertDeletedCars, convertToLocal, convertToXxyh, deletedCars, deletedCarsNotice, EMPTY_PROFILE, makeAppData,
  materializeAll, newCars, putExpense, putFuel, rebaseSync, removeRecord, setCarIgnored, vehicleRecords, vehiclesForCars,
} from "../common/ledger"
import { emptyLedger, FuelData, LedgerFile, Vehicle } from "../common/types"
import { applyOps, validateUpload } from "../sync/xxyh/ops"
import { carProfile, carsOf, XxyhCarInfo } from "../sync/xxyh/mapping"
import { emptyXxyhState, XxyhBackup, XxyhState } from "../sync/xxyh/types"

const D = (s: string) => Date.parse(s)

function cloud(): XxyhBackup {
  return {
    expenseTypes: [{ _id: 100000, name: "行车费" }],
    myStations: { stations: [{ id: "130176295072566815", name: "三桥", longitudeE6: 121600287, latitudeE6: 31236122, coordinate_type: "wgs84", timeStamp: 1 }] },
    cars: [{
      uuid: "1000000001", name: "S90", selected: 1,
      fuelRecords: [{ date: D("2026-10-12T14:39:52+08:00"), odometer: 82912, fueledLiter: 42.68, price: 11.12, yuan: 474.6, payYuan: 389.24, type: 98, gassup: true, stationId: "", remark: "", wc_id: 216, carId: 1000000001, replenishType: 1 }],
      expenseRecords: [],
      maintainRecords: [{ dateTime: D("2026-05-01T09:00:00+08:00"), currentMileage: 80000, maintains: "机油,", spend: 900, message: "小保养" }],
    }],
  }
}

const fuel = (d: Partial<FuelData>): FuelData => ({
  ts: D("2026-10-17T09:00:00+08:00"), odometer: 83200, liters: 40, price: 8.6, amount: 344, paid: 330, grade: 95,
  full: true, light_on: false, missed_before: false, station_id: null, remark: "", ...d,
})

const carInfo = (uuid: string, name: string, extra: Record<string, unknown> = {}): XxyhCarInfo =>
  ({ uuid, name, fuel_count: 1, expense_count: 0, profile: carProfile({ uuid, ...extra }) })

function linkedSetup(): { ledger: LedgerFile; xxyh: XxyhState; v: Vehicle } {
  const xxyh: XxyhState = { ...emptyXxyhState(), base: cloud(), base_version: 309 }
  const ledger = vehiclesForCars(emptyLedger(), [carInfo("1000000001", "S90", { gasType: "95号" })])
  return { ledger, xxyh, v: ledger.vehicles[0] }
}

test("第一次连接（油记里还没有车辆）：小熊里的车全部加入，默认标号按车型；之后新出现的车不自动加入", () => {
  const { ledger, v } = linkedSetup()
  assert.equal(ledger.vehicles.length, 1)
  assert.equal(v.xxyh_car, "1000000001")
  assert.equal(v.default_grade, 95)
  assert.equal(ledger.settings.current_vehicle_id, v.id)
  // 再次运行不重复新建；新出现的车也不自动加入
  const cars = [carInfo("1000000001", "S90"), carInfo("2000000002", "S60")]
  const again = vehiclesForCars(ledger, cars)
  assert.equal(again.vehicles.length, 1)
  assert.deepEqual(newCars(again, cars).map(c => c.uuid), ["2000000002"])
  // 添加到油记、忽略、恢复
  const added = addCarVehicle(again, cars[1])
  assert.equal(added.vehicles.length, 2)
  assert.equal(added.vehicles[1].xxyh_car, "2000000002")
  assert.deepEqual(newCars(added, cars), [])
  const ignored = setCarIgnored(again, "2000000002", true)
  assert.deepEqual(newCars(ignored, cars), [])
  assert.deepEqual(newCars(setCarIgnored(ignored, "2000000002", false), cars).map(c => c.uuid), ["2000000002"])
  // 第一次连接时忽略列表里的车不加入
  assert.equal(vehiclesForCars({ ...emptyLedger(), xxyh_ignored_cars: ["2000000002"] }, cars).vehicles.length, 1)
})

test("关联小熊的车辆：保存变成待上传操作，显示数据立即包含修改并标「待上传」", () => {
  const { ledger, xxyh, v } = linkedSetup()
  const data = makeAppData(ledger, xxyh)
  assert.equal(vehicleRecords(data, v).length, 2) // 1 加油 + 1 保养
  const c = putFuel(data, v, null, fuel({}), null)
  assert.equal(c.linked, true)
  assert.equal(c.xxyh.ops.length, 1)
  assert.equal(c.ledger.records.length, 0)
  const next = makeAppData(c.ledger, c.xxyh)
  const recs = vehicleRecords(next, v)
  assert.equal(recs.length, 3)
  assert.equal(recs[0].kind, "fuel")
  assert.equal(recs[0].pending, true)
  assert.equal(recs[1].pending, false)
  // 再编辑这条待上传的记录、然后删除
  const edited = putFuel(next, v, recs[0].id, fuel({ paid: 300 }), null)
  const after = makeAppData(edited.ledger, edited.xxyh)
  const rec = vehicleRecords(after, v).find(r => r.kind === "fuel" && r.odometer === 83200)
  assert.ok(rec && rec.kind === "fuel" && rec.paid === 300)
  const del = removeRecord(after, v, rec!)
  assert.equal(vehicleRecords(makeAppData(del.ledger, del.xxyh), v).length, 2)
  assert.equal(applyOps(cloud(), del.xxyh.ops).conflicts.length, 0)
})

test("本机车辆：直接写入本机文件", () => {
  const ledger = emptyLedger()
  ledger.vehicles.push({ id: "v1", name: "测试", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null })
  const data = makeAppData(ledger, emptyXxyhState())
  const st = { id: "s1", name: "新站", address: "", province: "", city: "", district: "", lng: 121, lat: 31, last_used_ts: 0 }
  const c = putFuel(data, ledger.vehicles[0], null, fuel({ station_id: "s1" }), st)
  assert.equal(c.linked, false)
  assert.equal(c.ledger.records.length, 1)
  assert.equal(c.ledger.stations.length, 1)
  assert.equal(c.xxyh.ops.length, 0)
  const e = putExpense(makeAppData(c.ledger, c.xxyh), ledger.vehicles[0], null, { ts: 1, category_id: 100000, amount: 20, remark: "停车" })
  assert.equal(e.ledger.records.length, 2)
})

test("本机车辆转为小熊车辆：在小熊新建一辆车，全部记录变成新增；云端原有的车不动；读回来与本机记录相同", () => {
  const { ledger: l0, xxyh } = linkedSetup()
  const profile = { model: 73607, model_name: "沃尔沃S60 2026款 B4 智远运动版", pinpai: 70, chexi: 3158, vehicle_type: 1, replenish_mode: 1, gas_type: "95号", buy_date: "2026-10-19" }
  const ledger: LedgerFile = { ...l0, vehicles: [...l0.vehicles, { id: "local", name: "S60", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null, profile }], records: [] }
  const st = { id: "s-new", name: "新站", address: "", province: "", city: "", district: "", lng: 121.6, lat: 31.23, last_used_ts: 0 }
  ledger.stations = [...ledger.stations, st]
  const f1 = { ...fuel({ station_id: "s-new" }), kind: "fuel" as const, id: "f1", vehicle_id: "local" }
  // 与云端 S90 的记录同一时间：新车是空的，照样上传（不判断重复）
  const f2 = { ...fuel({ ts: D("2026-10-12T14:39:52+08:00"), odometer: 82912 }), kind: "fuel" as const, id: "f2", vehicle_id: "local" }
  const e1 = { kind: "expense" as const, id: "e1", vehicle_id: "local", ts: D("2026-10-13T08:00:00+08:00"), category_id: 100000, amount: 20, remark: "停车" }
  ledger.records.push(f1, f2, e1)
  const c = convertToXxyh(makeAppData(ledger, xxyh), "local", "4821736590", 1792300000000)
  assert.deepEqual(c.xxyh.ops.map(o => o.type), ["add_car", "put_fuel", "put_expense", "put_fuel"]) // 记录按时间顺序
  assert.equal(c.ledger.records.length, 0)
  const v = c.ledger.vehicles.find(x => x.id === "local")!
  assert.equal(v.xxyh_car, "4821736590")
  assert.equal(v.profile, undefined)
  assert.throws(() => convertToXxyh(makeAppData(c.ledger, c.xxyh), "local", "1", 0), /已经在小熊/)

  const r = applyOps(cloud(), c.xxyh.ops)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(validateUpload(cloud(), r), [])
  assert.equal(r.doc.cars.length, 2)
  assert.equal(r.doc.cars[0].fuelRecords!.length, 1, "原有的车不动")
  const car = r.doc.cars[1]
  assert.deepEqual({ ...car, fuelRecords: undefined, expenseRecords: undefined }, {
    uuid: "4821736590", name: "S60", model: 73607, vehicle_type: 1, replenishMode: 1, gasType: "95号", pinpai: 70, chexi: 3158,
    buyDate: "2026-10-19", sortId: 1, sortKey: 1, selected: 0, avgConsumption: 0, odometerCorrection: 0,
    fuelRecords: undefined, expenseRecords: undefined, maintainRecords: [], incomeRecords: [], reminderRecords: [],
  })
  assert.ok(r.doc.myStations!.stations!.some(s => String(s.id) === "s-new"), "本机油站一起上传")
  // 读回来：记录与本机的相同，车辆资料（车型等）也在
  const after = makeAppData(c.ledger, { ...c.xxyh, base: r.doc, ops: [] })
  const pick = (x: any) => JSON.stringify(x.kind === "fuel"
    ? [x.ts, x.odometer, x.liters, x.price, x.amount, x.paid, x.grade, x.full, x.light_on, x.missed_before, x.station_id, x.remark]
    : [x.ts, x.category_id, x.amount, x.remark])
  assert.deepEqual(vehicleRecords(after, v).map(pick).sort(), [f1, f2, e1].map(pick).sort())
  assert.deepEqual(carsOf(r.doc)[1].profile, { ...profile, model_name: null })
})

test("小熊车辆转为本机车辆：记录和资料复制到本机，记入忽略列表；云端不动；有待上传的修改时先上传", () => {
  const { ledger, xxyh, v } = linkedSetup()
  const base = cloud()
  base.cars[0].model = 39739
  base.cars[0].buyDate = "2020-01-09"
  const data = makeAppData(ledger, { ...xxyh, base })
  const local = convertToLocal(data, v.id)
  const lv = local.vehicles[0]
  assert.equal(lv.xxyh_car, null)
  assert.equal(lv.profile!.model, 39739)
  assert.equal(lv.profile!.buy_date, "2020-01-09")
  assert.deepEqual(local.xxyh_ignored_cars, ["1000000001"])
  assert.equal(local.records.length, 2) // 1 加油 + 保养转成的费用
  // 之后拉取不再列为新车，也不自动加回来
  const after = makeAppData(local, { ...xxyh, base })
  assert.deepEqual(newCars(local, after.mirror.cars), [])
  assert.equal(vehiclesForCars(local, after.mirror.cars).vehicles.length, 1)
  // 有待上传的修改
  const pending = putFuel(data, v, null, fuel({}), null)
  assert.throws(() => convertToLocal(makeAppData(pending.ledger, pending.xxyh), v.id), /先上传/)
})

test("断开小熊：显示的数据转成本机数据，保养转成维修保养费用", () => {
  const { ledger, xxyh, v } = linkedSetup()
  const c = putFuel(makeAppData(ledger, xxyh), v, null, fuel({}), null)
  const local = materializeAll(makeAppData(c.ledger, c.xxyh))
  assert.equal(local.vehicles[0].xxyh_car, null)
  assert.equal(local.records.length, 3)
  const maint = local.records.find(r => r.kind === "expense" && r.category_id === 100001)
  assert.ok(maint && maint.kind === "expense" && maint.amount === 900 && /机油/.test(maint.remark))
  assert.equal(local.stations.length, 1)
  assert.equal(local.expense_categories.some(x => x.id === 100000), true)
  const after = makeAppData(local, emptyXxyhState())
  assert.equal(vehicleRecords(after, local.vehicles[0]).every(r => r.origin === "local"), true)
})

test("断开小熊：有对应费用的保养（小熊同时写的那笔维修保养）不再转一笔，花费不重复", () => {
  const { ledger } = linkedSetup()
  const base = cloud()
  const ts = base.cars[0].maintainRecords![0].dateTime
  base.cars[0].expenseRecords = [{ date: ts, type: 100001, expense: 900, description: "小保养\n保养里程：80000公里\n保养项目：机油", maintain_id: 1, wc_id: 1, carId: 1000000001 }]
  const local = materializeAll(makeAppData(ledger, { ...emptyXxyhState(), base, base_version: 309 }))
  const fix = local.records.filter(r => r.kind === "expense" && r.category_id === 100001)
  assert.equal(fix.length, 1)
  assert.equal(fix[0].kind === "expense" && fix[0].amount, 900)
  assert.match(fix[0].kind === "expense" ? fix[0].remark : "", /保养里程/) // 留下的是小熊里那笔原来的费用
})

test("小熊云端删除了车：自动转为本机车辆，用删除前的数据（含待上传的修改），记下原来的 uuid；没关联、还没上传的车不算", () => {
  const { ledger: l0, xxyh, v } = linkedSetup()
  const old = cloud()
  ;(old.cars[0] as any).model = 39739
  old.cars.push({ uuid: "3000000003", name: "没加到油记的车", fuelRecords: [], expenseRecords: [] })
  // 一条还没上传的新增；另有一辆还没上传的新车（add_car）
  const data0 = makeAppData(l0, { ...xxyh, base: old })
  const pending = putFuel(data0, v, null, fuel({}), null)
  const withNew: XxyhState = { ...pending.xxyh, ops: [...pending.xxyh.ops, { type: "add_car", car: "4821736590", name: "S60", profile: EMPTY_PROFILE, at: 0 }] }
  const ledger = { ...pending.ledger, vehicles: [...pending.ledger.vehicles, { id: "new", name: "S60", default_grade: 95, created_ts: 0, xxyh_car: "4821736590", provider: null }] }
  const before = makeAppData(ledger, withNew)
  // 云端最新版本：S90 和没加到油记的车都被删了
  const latest: XxyhBackup = { ...cloud(), cars: [] }
  assert.deepEqual(deletedCars(old, latest, ledger), ["1000000001"])
  const r = convertDeletedCars(before, { ...withNew, base: latest, base_version: 310 })
  assert.deepEqual(r.converted, [{ name: "S90", records: 3 }]) // 云端 1 加油 + 1 保养 + 待上传的 1 加油
  const lv = r.ledger.vehicles.find(x => x.id === v.id)!
  assert.equal(lv.xxyh_car, null)
  assert.equal(lv.former_xxyh_car, "1000000001")
  assert.equal(lv.profile!.model, 39739)
  assert.deepEqual(r.xxyh.ops.map(o => o.type), ["add_car"], "S90 的待上传修改已并进本机记录；S60 的新建保留")
  assert.equal(r.ledger.vehicles.find(x => x.id === "new")!.xxyh_car, "4821736590")
  const notice = deletedCarsNotice(r.converted)!
  assert.match(notice, /「S90」已从小熊云端删除，油记已把它转为本机车辆，3 条记录都在/)
  assert.match(notice, /转为小熊车辆」重新上传/)
  assert.equal(deletedCarsNotice([]), null)
  // 没有删除时原样返回
  const same = convertDeletedCars(before, { ...withNew, base: old })
  assert.equal(same.ledger, ledger)
  assert.deepEqual(same.converted, [])
})

test("重新上传：云端还没有原来的 uuid 时用回它（真正的恢复），已被占用时新建一个", () => {
  const v: Vehicle = { id: "v", name: "S90", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null, former_xxyh_car: "1000000001" }
  assert.equal(carUuidFor(v, new Set()), "1000000001")
  const other = carUuidFor(v, new Set(["1000000001"]))
  assert.match(other, /^[1-9]\d{9}$/)
  assert.notEqual(other, "1000000001")
  assert.match(carUuidFor({ ...v, former_xxyh_car: undefined }, new Set()), /^[1-9]\d{9}$/)
  // 转为小熊车辆后不再记原来的 uuid
  const { ledger: l0, xxyh } = linkedSetup()
  const ledger: LedgerFile = { ...l0, vehicles: [...l0.vehicles, { ...v, id: "back" }], records: [] }
  const c = convertToXxyh(makeAppData(ledger, xxyh), "back", "1000000002")
  assert.equal(c.ledger.vehicles.find(x => x.id === "back")!.former_xxyh_car, undefined)
})

test("同步途中又改了数据：上传掉的修改去掉，途中新记的一笔保留，本机的改动（权益卡、设置）不被开始那一刻的数据覆盖", () => {
  const { ledger: l0, xxyh, v } = linkedSetup()
  const ledger: LedgerFile = { ...l0, perks: [{
    id: "p1", vehicle_id: v.id, name: "洗车", kind: "count", total: 5, unit: "次", face_value: null, value: null, end_ts: null, store: "",
    source: "示例洗车卡", insurance_id: null, origin: "other", raw: "", note: "", created_ts: 0,
  }] }
  // 开始同步时有一条待上传的加油
  const c0 = putFuel(makeAppData(ledger, xxyh), v, null, fuel({}), null)
  const start = makeAppData(c0.ledger, c0.xxyh)
  // 同步途中：又记了一笔加油，删了权益卡
  const c1 = putFuel(start, v, null, fuel({ ts: D("2026-10-18T09:00:00+08:00"), odometer: 83600 }), null)
  const latest = makeAppData({ ...c1.ledger, perks: [] }, c1.xxyh)
  // 同步结果：开始时的那条已上传，云端到了 310
  const uploaded = applyOps(cloud(), start.xxyh.ops).doc
  const result: XxyhState = { ...start.xxyh, base: uploaded, base_version: 310, ops: [], last_push_ts: 1 }
  const r = rebaseSync(start, latest, result, start.xxyh.ops, false)!
  assert.equal(r.xxyh.base_version, 310)
  assert.deepEqual(r.xxyh.ops, [c1.xxyh.ops[1]], "只剩途中新记的一笔")
  assert.deepEqual(r.ledger.perks, [], "删掉的权益卡不回来")
  const shown = vehicleRecords(makeAppData(r.ledger, r.xxyh), v).filter(x => x.kind === "fuel")
  assert.equal(shown.length, 3, "云端原来的 1 条 + 上传的 1 条 + 待上传的 1 条")
  // 没上传（只拉取）：现在的修改都保留
  const pulledOnly = rebaseSync(start, latest, { ...start.xxyh, last_pull_ts: 2 }, null, false)!
  assert.deepEqual(pulledOnly.xxyh.ops, c1.xxyh.ops)
  assert.equal(pulledOnly.xxyh.last_pull_ts, 2)
  // 途中断开了小熊、换了账号：丢掉这次结果
  assert.equal(rebaseSync(start, makeAppData(latest.ledger, emptyXxyhState()), result, start.xxyh.ops, false), null)
  assert.equal(rebaseSync(start, makeAppData(latest.ledger, { ...latest.xxyh, account_id: "other" }), result, start.xxyh.ops, false), null)
})

test("同步途中又改了数据，拉到的新版本里车被删了：用现在的数据转为本机车辆，途中记的那笔也在", () => {
  const { ledger, xxyh, v } = linkedSetup()
  const start = makeAppData(ledger, xxyh)
  const c1 = putFuel(start, v, null, fuel({}), null)
  const latest = makeAppData(c1.ledger, c1.xxyh)
  const gone: XxyhState = { ...xxyh, base: { ...cloud(), cars: [] }, base_version: 310 }
  const r = rebaseSync(start, latest, gone, null, true)!
  const lv = r.ledger.vehicles.find(x => x.id === v.id)!
  assert.equal(lv.xxyh_car, null)
  assert.equal(r.ledger.records.filter(x => x.vehicle_id === v.id && x.kind === "fuel").length, 2, "云端原来的 1 条 + 途中记的 1 条")
  assert.deepEqual(r.xxyh.ops, [])
})
