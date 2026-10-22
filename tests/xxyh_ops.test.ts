import { test } from "node:test"
import assert from "node:assert/strict"
import { applyOps, validateUpload } from "../sync/xxyh/ops"
import { fuelFromXxyh, mapBackup, parseXxyhRecordId, stationIdFor, xxyhRecordId } from "../sync/xxyh/mapping"
import { parseXxyhToken } from "../sync/xxyh/api"
import { XxyhBackup, XxyhOp } from "../sync/xxyh/types"
import { FuelData } from "../common/types"

const D = (s: string) => Date.parse(s)

function sample(): XxyhBackup {
  return {
    appVer: "2.3.9", dataVer: 8, expenseTypes: [{ _id: 100000, name: "行车费", description: "", color: 1, sortId: 0, spendType: 1 }],
    myStations: { stations: [{ id: "130176295072566815", name: "三桥", longitudeE6: 121600287, latitudeE6: 31236122, coordinate_type: "wgs84", timeStamp: 1, src: "customized" }] },
    cars: [{
      uuid: "1000000001", name: "S90", selected: 1, unknownCarField: { keep: true },
      fuelRecords: [
        { date: D("2026-10-12T14:39:52+08:00"), odometer: 82912, fueledLiter: 42.68, price: 11.12, yuan: 474.6, payYuan: 389.24, type: 98, gassup: true, stationId: "130176295072566815", remark: "", wc_id: 216, carId: 1000000001, replenishType: 1, someFutureField: "x" },
        { date: D("2026-09-06T10:34:00+08:00"), odometer: 82544, fueledLiter: 45.70000076293945, price: 8.56, yuan: 391.19, payYuan: 391.19, type: 95, gassup: true, stationId: "", remark: "", wc_id: 1, carId: 1000000001, replenishType: 1, consumption: 11.6 },
        { date: D("2016-01-01T08:00:00+08:00"), odometer: 100, fueledLiter: 0, price: 6.6, yuan: 300, payYuan: 0, type: 93, gassup: true, stationId: "", remark: "老记录", wc_id: 2, carId: 1000000001, replenishType: 1 },
        { date: D("2026-08-01T08:00:00+08:00"), odometer: 82000, chargedKwh: 30, replenishType: 2, wc_id: 3, carId: 1000000001 },
      ],
      expenseRecords: [{ date: D("2026-10-01T09:00:00+08:00"), type: 100000, expense: 50, description: "停车", wc_id: 1, carId: 1000000001, remarkImages: [] }],
      maintainRecords: [{ dateTime: D("2026-05-01T09:00:00+08:00"), currentMileage: 80000, maintains: "机油,机滤,", customMaintains: "", spend: 900, message: "小保养" }],
    }],
  }
}

const fuelData = (d: Partial<FuelData>): FuelData => ({
  ts: D("2026-10-17T09:00:00+08:00"), odometer: 83200, liters: 40, price: 8.6, amount: 344, paid: 330, grade: 95,
  full: true, light_on: false, missed_before: false, station_id: null, remark: "", ...d,
})

test("凭据：BoxJS JSON 或纯 token", () => {
  assert.equal(parseXxyhToken('{"authToken":"abc123"}'), "abc123")
  assert.equal(parseXxyhToken(' "abc123" '), "abc123")
  assert.equal(parseXxyhToken("{bad json"), "")
})

test("映射：加油、费用、保养、油站；充电记录跳过", () => {
  const m = mapBackup(sample(), car => (car === "1000000001" ? "veh" : null))
  const fuel = m.records.filter(r => r.kind === "fuel")
  assert.equal(fuel.length, 3)
  assert.equal(m.records.filter(r => r.kind === "expense").length, 1)
  const maint = m.records.find(r => r.kind === "maintenance")
  assert.ok(maint && maint.kind === "maintenance" && maint.items === "机油、机滤")
  const old = fuel.find(r => r.odometer === 100)!
  assert.equal(old.kind === "fuel" && old.liters, 45.455) // fueledLiter 为 0：300 / 6.6
  assert.equal(old.kind === "fuel" && old.paid, 300) // payYuan 为 0 时等于应付
  assert.equal(m.stations[0].id, "130176295072566815")
  assert.ok(Math.abs(m.stations[0].lng - 121.600287) < 1e-9)
  const id = xxyhRecordId("1000000001", "f", 123)
  assert.deepEqual(parseXxyhRecordId(id), { car: "1000000001", kind: "f", date: 123, n: 1 })
  assert.deepEqual(parseXxyhRecordId(`${id}#2`), { car: "1000000001", kind: "f", date: 123, n: 2 })
})

test("油站 id 与小熊 App 的算法一致", () => {
  assert.equal(stationIdFor(121.600287, 31.236122), "130176295072566815")
})

test("没有操作时不改动任何内容", () => {
  const base = sample()
  const r = applyOps(base, [])
  assert.deepEqual(r.doc, base)
  assert.deepEqual(validateUpload(base, r), [])
})

test("新增、修改、删除，未涉及的记录与字段保持原样", () => {
  const base = sample()
  const st = { id: stationIdFor(121.5, 31.2), name: "新站", address: "某路 1 号", province: "上海市", city: "上海市", district: "浦东新区", lng: 121.5, lat: 31.2, last_used_ts: 0 }
  const ops: XxyhOp[] = [
    { type: "put_fuel", car: "1000000001", key: null, data: fuelData({ station_id: st.id }), station: st, at: 1 },
    { type: "put_fuel", car: "1000000001", key: D("2026-09-06T10:34:00+08:00"), data: { ...fuelFromXxyh(base.cars[0].fuelRecords![1]), liters: 45.7, remark: "改备注" }, station: null, at: 2 },
    { type: "delete_expense", car: "1000000001", key: D("2026-10-01T09:00:00+08:00"), at: 3 },
  ]
  const r = applyOps(base, ops)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(validateUpload(base, r), [])
  const recs = r.doc.cars[0].fuelRecords!
  assert.equal(recs.length, 5)
  assert.equal(recs[0].odometer, 83200) // 倒序：新记录在最前
  assert.equal(recs[0].wc_id, 217)
  assert.equal(recs[0].carId, 1000000001)
  assert.equal(recs[0].stationId, st.id)
  const edited = recs.find(x => x.wc_id === 1)!
  assert.equal(edited.remark, "改备注")
  assert.equal(edited.fueledLiter, 45.70000076293945) // 升数没变：不改写原值
  assert.equal(edited.consumption, 11.6)
  assert.equal(recs.find(x => x.wc_id === 216)!.someFutureField, "x")
  assert.equal(r.doc.cars[0].expenseRecords!.length, 0)
  assert.deepEqual(r.doc.cars[0].unknownCarField, { keep: true })
  const added = r.doc.myStations!.stations!.find(s => s.id === st.id)!
  assert.equal(added.coordinate_type, "wgs84")
  assert.equal(added.src, "customized")
})

test("同一条新增重复应用（上次上传没收到回应）不会重复插入", () => {
  const base = sample()
  const op: XxyhOp = { type: "put_fuel", car: "1000000001", key: null, data: fuelData({}), station: null, at: 1 }
  const once = applyOps(base, [op]).doc
  const twice = applyOps(once, [op])
  assert.equal(twice.doc.cars[0].fuelRecords!.length, once.cars[0].fuelRecords!.length)
  assert.deepEqual(validateUpload(once, twice), [])
})

test("修改云端已删除的记录：冲突；删除已删除的记录：不算冲突", () => {
  const base = sample()
  const r = applyOps(base, [
    { type: "put_fuel", car: "1000000001", key: 999, data: fuelData({}), station: null, at: 1 },
    { type: "delete_fuel", car: "1000000001", key: 999, at: 2 },
    { type: "put_fuel", car: "nope", key: null, data: fuelData({}), station: null, at: 3 },
  ])
  assert.equal(r.conflicts.length, 2)
  assert.deepEqual(validateUpload(base, r), [])
})

test("新增后未上传就修改、删除：按顺序应用结果正确", () => {
  const base = sample()
  const ts = D("2026-10-17T09:00:00+08:00")
  const r = applyOps(base, [
    { type: "put_fuel", car: "1000000001", key: null, data: fuelData({}), station: null, at: 1 },
    { type: "put_fuel", car: "1000000001", key: ts, data: fuelData({ ts: ts + 60e3, paid: 300 }), station: null, at: 2 },
  ])
  const rec = r.doc.cars[0].fuelRecords!.find(x => x.date === ts + 60e3)!
  assert.equal(rec.payYuan, 300)
  const del = applyOps(r.doc, [{ type: "delete_fuel", car: "1000000001", key: ts + 60e3, at: 3 }])
  assert.equal(del.doc.cars[0].fuelRecords!.length, 4)
})

test("引用的油站已不在云端：清掉油站，不留悬空引用", () => {
  const base = sample()
  const r = applyOps(base, [{ type: "put_fuel", car: "1000000001", key: null, data: fuelData({ station_id: "404" }), station: null, at: 1 }])
  assert.equal(r.notes.length, 1)
  assert.equal(r.doc.cars[0].fuelRecords![0].stationId, "")
  assert.deepEqual(validateUpload(base, r), [])
})

test("上传前检查能发现意外改动", () => {
  const base = sample()
  const r = applyOps(base, [])
  r.doc.cars[0].fuelRecords![2].remark = "被改了"
  assert.match(validateUpload(base, r).join(), /意外修改/)
  const r2 = applyOps(base, [])
  r2.doc.cars[0].fuelRecords!.pop()
  assert.match(validateUpload(base, r2).join(), /条数不符/)
  const r3 = applyOps(base, [])
  r3.doc.myStations!.stations = []
  assert.match(validateUpload(base, r3).join(), /丢失/)
  const r4 = applyOps(base, [])
  ;(r4.doc as any).expenseTypes = []
  assert.match(validateUpload(base, r4).join(), /expenseTypes/)
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
  assert.deepEqual(mapBackup(doc, () => null).categories.map(c => c.name), ["行车费", "维修保养", "清洗护理", "保险和交通规费", "其它", "没有顺序"])
})
