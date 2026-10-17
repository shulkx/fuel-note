import { test } from "node:test"
import assert from "node:assert/strict"
import {
  linkLocalVehicle, makeAppData, materializeAll, putExpense, putFuel, removeRecord, vehicleRecords, vehiclesForCars,
} from "../common/ledger"
import { emptyLedger, FuelData, LedgerFile, Vehicle } from "../common/types"
import { applyOps } from "../sync/xxyh/ops"
import { carKey } from "../sync/xxyh/mapping"
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

function linkedSetup(): { ledger: LedgerFile; xxyh: XxyhState; v: Vehicle } {
  const xxyh: XxyhState = { ...emptyXxyhState(), base: cloud(), base_version: 309 }
  const ledger = vehiclesForCars(emptyLedger(), [{ uuid: "1000000001", name: "S90", fuel_count: 1, expense_count: 0 }])
  return { ledger, xxyh, v: ledger.vehicles[0] }
}

test("连接小熊后为每辆车新建车辆，并设为当前车辆", () => {
  const { ledger, v } = linkedSetup()
  assert.equal(ledger.vehicles.length, 1)
  assert.equal(v.xxyh_car, "1000000001")
  assert.equal(ledger.settings.current_vehicle_id, v.id)
  // 再次运行不重复新建
  assert.equal(vehiclesForCars(ledger, [{ uuid: "1000000001", name: "S90", fuel_count: 1, expense_count: 0 }]).vehicles.length, 1)
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

test("本机车辆关联到小熊：本机记录变成新增操作，相同时间的跳过", () => {
  const { ledger: l0, xxyh } = linkedSetup()
  const ledger: LedgerFile = { ...l0, vehicles: [{ id: "local", name: "本机", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }], records: [] }
  ledger.records.push({ ...fuel({}), kind: "fuel", id: "f1", vehicle_id: "local" })
  ledger.records.push({ ...fuel({ ts: D("2026-10-12T14:39:52+08:00"), odometer: 82912 }), kind: "fuel", id: "f2", vehicle_id: "local" })
  const r = linkLocalVehicle(makeAppData(ledger, xxyh), "local", "1000000001")
  assert.equal(r.added, 1)
  assert.equal(r.skipped, 1)
  assert.equal(r.ledger.records.length, 0)
  assert.equal(r.ledger.vehicles[0].xxyh_car, "1000000001")
  const applied = applyOps(cloud(), r.xxyh.ops)
  assert.equal(applied.doc.cars.find(c => carKey(c) === "1000000001")!.fuelRecords!.length, 2)
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
