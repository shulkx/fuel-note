import { test } from "node:test"
import assert from "node:assert/strict"
import {
  addCarVehicle, convertToLocal, convertToXxyh, makeAppData, materializeAll, newCars, putExpense, putFuel, removeRecord, setCarIgnored,
  vehicleRecords, vehiclesForCars,
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
