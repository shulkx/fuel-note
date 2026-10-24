// 从小熊云备份导入（2.0 设计第 8 节）：凭据、映射（加油、费用、保养、油站，充电跳过）、保养和费用配对、导入选中的车、
// 已导入的不再导入、油站和类别补齐、小熊原样留在 xxyh_raw。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseXxyhToken } from "../sync/xxyh/api"
import { carsNotImported, importCars, recordsFromCar } from "../sync/xxyh/import"
import { categoriesOf, stationIdFor } from "../sync/xxyh/mapping"
import { XxyhBackup } from "../sync/xxyh/types"
import { emptyLedger, ExpenseRecord, FuelRecord, MaintenanceRecord } from "../common/types"

const D = (s: string) => Date.parse(s)
const MAINT_TS = D("2026-05-01T09:00:00+08:00")

function sample(): XxyhBackup {
  return {
    appVer: "2.3.9", dataVer: 8, expenseTypes: [{ _id: 100001, name: "维修保养", sortId: 1 }, { _id: 100000, name: "行车费", sortId: 0 }],
    myStations: { stations: [{ id: "130176295072566815", name: "三桥", longitudeE6: 121600287, latitudeE6: 31236122, coordinate_type: "wgs84", timeStamp: 1, src: "customized" }] },
    cars: [{
      uuid: "1000000001", name: "S90", selected: 1, gasType: "95号", unknownCarField: { keep: true },
      fuelRecords: [
        { date: D("2026-10-12T14:39:52+08:00"), odometer: 82912, fueledLiter: 42.68, price: 11.12, yuan: 474.6, payYuan: 389.24, type: 98, gassup: true, stationId: "130176295072566815", remark: "", wc_id: 216, carId: 1000000001, replenishType: 1, someFutureField: "x" },
        { date: D("2016-01-01T08:00:00+08:00"), odometer: 100, fueledLiter: 0, price: 6.6, yuan: 300, payYuan: 0, type: 93, gassup: true, stationId: "", remark: "老记录", wc_id: 2, carId: 1000000001, replenishType: 1 },
        { date: D("2026-08-01T08:00:00+08:00"), odometer: 82000, chargedKwh: 30, replenishType: 2, wc_id: 3, carId: 1000000001 },
      ],
      expenseRecords: [
        { date: D("2026-10-01T09:00:00+08:00"), type: 100000, expense: 50, description: "停车", wc_id: 1, carId: 1000000001, remarkImages: [] },
        // 保养同一时刻的两笔：配「维修保养」那一笔
        { date: MAINT_TS, type: 100000, expense: 20, description: "停车", wc_id: 2, carId: 1000000001 },
        { date: MAINT_TS, type: 100001, expense: 900, description: "小保养", maintain_id: 7, wc_id: 3, carId: 1000000001 },
      ],
      maintainRecords: [{ dateTime: MAINT_TS, currentMileage: 80000, maintains: "机油,机滤,", customMaintains: "", spend: 900, message: "小保养", wc_id: 7 }],
    }, {
      uuid: "2000000002", name: "S60", selected: 0, fuelRecords: [], expenseRecords: [{ date: 1, type: 100000, expense: 10, description: "", wc_id: 1, carId: 2000000002 }],
    }],
  }
}

test("凭据：BoxJS JSON 或纯 token", () => {
  assert.equal(parseXxyhToken('{"authToken":"abc123"}'), "abc123")
  assert.equal(parseXxyhToken(' "abc123" '), "abc123")
  assert.equal(parseXxyhToken("{bad json"), "")
})

test("一辆车的记录：加油（充电跳过）、费用、保养的顺序固定；保养配同一时刻的维修保养费用；小熊原样留在 xxyh_raw", () => {
  let n = 0
  const records = recordsFromCar(sample().cars[0], "veh", k => `${k}${++n}`)
  assert.deepEqual(records.map(r => [r.kind, r.id]), [["fuel", "f1"], ["fuel", "f2"], ["expense", "e3"], ["expense", "e4"], ["expense", "e5"], ["maintenance", "m6"]])
  const [first, old] = records as FuelRecord[]
  assert.equal(old.liters, 45.455) // fueledLiter 为 0：300 / 6.6
  assert.equal(old.paid, 300) // payYuan 为 0 时等于应付
  assert.equal(first.station_id, "130176295072566815")
  assert.equal(first.xxyh_raw!.someFutureField, "x")
  const m = records[5] as MaintenanceRecord
  assert.deepEqual([m.items, m.amount, m.odometer, m.expense_id], [["机油", "机滤"], 900, 80000, "e5"])
  assert.equal((records[4] as ExpenseRecord).xxyh_raw!.maintain_id, 7)
  assert.ok(records.every(r => r.vehicle_id === "veh"))
})

test("同一时刻没有费用的保养不配对；一笔费用只配一条保养", () => {
  const car = sample().cars[0]
  car.maintainRecords = [car.maintainRecords![0], { ...car.maintainRecords![0], message: "第二条" }, { dateTime: 5, currentMileage: 1, maintains: "", spend: 0, message: "" }]
  const m = recordsFromCar(car, "veh").filter((r): r is MaintenanceRecord => r.kind === "maintenance")
  const ids = m.map(x => x.expense_id)
  assert.ok(ids[0] && ids[1] && ids[0] !== ids[1], "同一时刻还有第二笔，配给第二条")
  assert.equal(ids[2], undefined)
})

test("导入选中的车：车辆（标号按车型）、记录、油站、类别（小熊的顺序在前）；当前车辆用第一辆；已导入的不再导入", () => {
  const doc = sample()
  const r = importCars(emptyLedger(), doc, ["1000000001"], 123)
  assert.deepEqual(r.added, [{ name: "S90", records: 6 }])
  const v = r.ledger.vehicles[0]
  assert.deepEqual([v.name, v.xxyh_car, v.default_grade, v.created_ts], ["S90", "1000000001", 95, 123])
  assert.equal(r.ledger.settings.current_vehicle_id, v.id)
  assert.deepEqual(r.ledger.stations.map(s => s.id), ["130176295072566815"])
  assert.deepEqual(r.ledger.expense_categories.slice(0, 2).map(c => c.name), ["行车费", "维修保养"])
  assert.deepEqual(carsNotImported(r.ledger, doc).map(c => c.uuid), ["2000000002"])
  // 再导入同一辆：跳过；另一辆接着导入，当前车辆不变
  const again = importCars(r.ledger, doc, ["1000000001", "2000000002"], 456)
  assert.deepEqual(again.added, [{ name: "S60", records: 1 }])
  assert.equal(again.ledger.vehicles.length, 2)
  assert.equal(again.ledger.settings.current_vehicle_id, v.id)
  assert.equal(again.ledger.stations.length, 1, "油站不重复")
  assert.deepEqual(carsNotImported(again.ledger, doc), [])
  assert.deepEqual(carsNotImported(again.ledger, null), [])
  // 什么都没选：原样
  assert.deepEqual(importCars(r.ledger, doc, [], 0).added, [])
})

test("油站 id 与小熊 App 的算法一致", () => {
  assert.equal(stationIdFor(121.600287, 31.236122), "130176295072566815")
})

test("小熊的费用类别按 sortId 排（记费用顶部的分段照这个顺序）；没有 sortId 的排在后面", () => {
  const doc: XxyhBackup = {
    cars: [],
    expenseTypes: [
      { _id: 100002, name: "保险和交通规费", sortId: 3 },
      { _id: 100003, name: "其它", sortId: 4 },
      { _id: 100000, name: "行车费", sortId: 0 },
      { _id: 1646374903, name: "清洗护理", sortId: 2 },
      { _id: 9, name: "没有顺序" },
      { _id: 100001, name: "维修保养", sortId: 1 },
    ],
  }
  assert.deepEqual(categoriesOf(doc).map(c => c.name), ["行车费", "维修保养", "清洗护理", "保险和交通规费", "其它", "没有顺序"])
})
