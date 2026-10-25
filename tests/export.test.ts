// 导出到小熊（sync/xxyh/export.ts，2.0 设计第 7 节）：导入后直接导出和云端逐字段相同；改、删、新增只动这几条；检查认出每一种不允许的改动；
// 小熊里在上次之后的改动；新建的车和保养；费用备注末尾的门店。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { emptyLedger, ExpenseRecord, FuelRecord, LedgerFile, MaintenanceRecord } from "../common/types"
import { buildExport, canon, changeCount, pendingChanges, validateExport } from "../sync/xxyh/export"
import { importCars } from "../sync/xxyh/import"
import { XxyhBackup, XxyhCar } from "../sync/xxyh/types"

const NOW = Date.UTC(2026, 9, 25, 4)
const CAR = "1000000001"

/** 云端：一辆导出的车（加油里有充电、同一时刻两条、小数毫秒、只有金额和单价的旧记录、结尾换行；保养和配对的费用；收入、提醒、不认识的字段），另一辆车 */
function cloud(): XxyhBackup {
  return {
    appVer: "4.0.0",
    userInfo: { id: 42, note: "顶层的其他字段" },
    expenseTypes: [
      { _id: 100000, name: "行车费", sortId: 1 }, { _id: 100001, name: "维修保养", sortId: 2 },
      { _id: 100002, name: "保险和交通规费", sortId: 3 }, { _id: 100003, name: "其它", sortId: 4 },
    ],
    myStations: {
      version: 3,
      stations: [
        { id: "s1", name: "示例加油站", address: "示例路 1 号", longitudeE6: 121480000, latitudeE6: 31230000, timeStamp: 1000 },
        { id: "s2", name: "示例石化", longitudeE6: 121500000, latitudeE6: 31240000, coordinate_type: "wgs84", timeStamp: 900, src: "customized" },
      ],
    },
    cars: [
      {
        uuid: CAR, name: "示例车", model: 12, selected: 1, extra: "保留",
        fuelRecords: [
          { date: 3000.5, odometer: 1200, fueledLiter: 40, price: 7.5, yuan: 300, payYuan: 290, type: 95, gassup: true, stationId: "s1", remark: "第三次", replenishType: 1, wc_id: 3, carId: 1000000001, id: 3, unknownField: "x", remarkImages: ["a.jpg"] },
          { date: 2500, odometer: 1100, replenishType: 2, chargedKwh: 30, wc_id: 4, carId: 1000000001 },
          { date: 2000, odometer: 1000, fueledLiter: 38, price: 7.4, yuan: 281.2, payYuan: 281.2, type: 95, gassup: true, stationId: "s2", remark: "结尾换行\n", replenishType: 1, wc_id: 2, carId: 1000000001 },
          { date: 2000, odometer: 1000, fueledLiter: 2, price: 7.4, yuan: 14.8, payYuan: 14.8, type: 95, gassup: true, stationId: "", remark: "", replenishType: 1, wc_id: 5, carId: 1000000001 },
          { date: 1000, odometer: 600, fueledLiter: 0, price: 7, yuan: 280, type: 92, gassup: false, remark: "", wc_id: 1, carId: 1000000001 },
        ],
        expenseRecords: [
          { date: 3500, type: 100001, expense: 900, description: "第一次保养\n保养里程：1500公里\n保养项目：机油,机油滤清器,\n", wc_id: 2, maintain_id: 1, carId: 1000000001, remarkImages: ["b.jpg"] },
          { date: 1500, type: 100003, expense: 50, description: "停车", wc_id: 1, carId: 1000000001 },
        ],
        maintainRecords: [
          { id: 0, wc_id: 1, carId: 1000000001, addTime: 3600, isCost: false, hasNotify: 0, remarkImages: [], dateTime: 3500, currentMileage: 1500, maintains: "机油,机油滤清器,", customMaintains: "", spend: 900, message: "第一次保养" },
        ],
        incomeRecords: [{ date: 10, amount: 5 }],
        reminderRecords: [{ title: "保养提醒" }],
      },
      { uuid: 1000000002, name: "别的车", fuelRecords: [{ date: 500, odometer: 10, yuan: 100, price: 7, fueledLiter: 14.3, wc_id: 1 }], expenseRecords: [] },
    ],
  }
}

function imported(doc = cloud()): LedgerFile {
  return importCars(emptyLedger(), doc, [CAR], NOW).ledger
}

const carOf = (doc: XxyhBackup, uuid = CAR) => doc.cars.find(c => String(c.uuid) === uuid) as XxyhCar
const byWc = (list: unknown[] | undefined, wc: number) => (list as Array<Record<string, unknown>>).find(r => r.wc_id === wc)
const fuels = (l: LedgerFile) => l.records.filter((r): r is FuelRecord => r.kind === "fuel")
const expenses = (l: LedgerFile) => l.records.filter((r): r is ExpenseRecord => r.kind === "expense")

test("导入后直接导出：和云端逐字段相同（键的顺序、充电、收入、提醒、其他车都照原样），没有修改，检查通过", () => {
  const doc = cloud()
  const plan = buildExport(doc, imported(doc), { now: NOW })
  assert.equal(JSON.stringify(plan.doc), JSON.stringify(doc))
  assert.deepEqual(plan.problems, [])
  assert.equal(changeCount(plan), 0)
  const c = plan.cars[0]
  assert.deepEqual([c.created, c.replaces, c.changes.fuel.count, c.changes.expense.count, c.changes.maintenance.count], [false, 0, 4, 2, 1])
  assert.deepEqual(plan.stations, { total: 2, added: 0 })
  assert.equal(plan.cloud_changed, null)
})

test("改一条、删一条、新增一条：只有这几条变化；改过的只覆盖改了的字段，小熊的编号、图片和不认识的字段都留着", () => {
  const doc = cloud()
  const ledger = imported(doc)
  const third = fuels(ledger).find(f => f.ts === 3000.5)!
  third.remark = "第三次（改过）"
  const parking = expenses(ledger).find(e => e.amount === 50)!
  ledger.records = ledger.records.filter(r => r.id !== parking.id)
  ledger.stations.push({ id: "s9", name: "新油站", address: "", province: "", city: "", district: "", lng: 121.6, lat: 31.3, last_used_ts: 5000 })
  ledger.records.push({ kind: "fuel", id: "f-new", vehicle_id: ledger.vehicles[0].id, ts: 5000, odometer: 1500, liters: 41, price: 7.6, amount: 311.6, paid: 300, grade: 95, full: true, light_on: false, missed_before: false, station_id: "s9", remark: "新记的" })
  const plan = buildExport(doc, ledger, { now: NOW })
  assert.deepEqual(plan.problems, [])
  const ch = plan.cars[0].changes
  assert.deepEqual([ch.fuel.added.length, ch.fuel.modified.length, ch.fuel.deleted.length], [1, 1, 0])
  assert.deepEqual([ch.expense.added.length, ch.expense.modified.length, ch.expense.deleted.length], [0, 0, 1])
  assert.equal(ch.expense.deleted[0].detail, "停车")
  assert.equal(changeCount(plan), 3)
  const car = carOf(plan.doc)
  const before = carOf(doc)
  assert.deepEqual(byWc(car.fuelRecords, 3), { ...byWc(before.fuelRecords, 3), remark: "第三次（改过）" })
  for (const wc of [1, 2, 4, 5]) assert.equal(canon(byWc(car.fuelRecords, wc)), canon(byWc(before.fuelRecords, wc)), `wc ${wc}`)
  // 新记的排在最前（时间最晚），编号是这辆车最大的 + 1（充电记录也算）
  const fresh = car.fuelRecords![0]
  assert.deepEqual([fresh.date, fresh.wc_id, fresh.stationId, fresh.remark, fresh.carId], [5000, 6, "s9", "新记的", 1000000001])
  assert.equal(car.expenseRecords!.length, 1)
  assert.equal(JSON.stringify(carOf(plan.doc, "1000000002")), JSON.stringify(carOf(doc, "1000000002")))
  // 新油站补在末尾（WGS-84），原有的照原样
  assert.deepEqual(plan.stations, { total: 3, added: 1 })
  assert.equal(plan.doc.myStations!.stations![2].coordinate_type, "wgs84")
  assert.equal(plan.doc.myStations!.version, 3)
  // 写进云端的样子存回记录：下次以它为底
  assert.equal(canon(plan.raws["f-new"]), canon(fresh))
  assert.equal(canon(plan.raws[third.id]), canon(byWc(car.fuelRecords, 3)))
  assert.equal(pendingChanges(doc, ledger, NOW), 3)
})

test("改了日期的挪到按时间的位置，同一时刻的排在已有的后面；没改的位置不动", () => {
  const doc = cloud()
  const ledger = imported(doc)
  const old = fuels(ledger).find(f => f.ts === 1000)!
  old.ts = 2000
  const plan = buildExport(doc, ledger, { now: NOW })
  assert.deepEqual(plan.problems, [])
  assert.deepEqual(carOf(plan.doc).fuelRecords!.map(r => r.wc_id), [3, 4, 2, 5, 1])
  assert.equal(plan.cars[0].changes.fuel.modified.length, 1)
})

test("费用备注：末尾加一行门店（和权益用量）；只存了用户写的备注，导入的照原样", () => {
  const doc = cloud()
  const ledger = imported(doc)
  ledger.stores.push({ id: "st1", name: "示例店", full_name: "", address: "", phone: "", lng: null, lat: null })
  ledger.records.push({ kind: "expense", id: "e-new", vehicle_id: ledger.vehicles[0].id, ts: 4000, category_id: 100003, amount: 30, remark: "洗车", store_id: "st1" })
  const plan = buildExport(doc, ledger, { now: NOW })
  const row = carOf(plan.doc).expenseRecords!.find(r => r.date === 4000)!
  assert.deepEqual([row.description, row.wc_id, row.type, row.expense], ["洗车\n示例店", 3, 100003, 30])
  assert.equal(carOf(plan.doc).expenseRecords!.find(r => r.wc_id === 2)!.description, carOf(doc).expenseRecords![0].description)
})

test("新记的保养：写保养记录和那笔费用（maintain_id、「保养里程」「保养项目」两行），保养按 addTime 排在最前", () => {
  const doc = cloud()
  const ledger = imported(doc)
  const vid = ledger.vehicles[0].id
  ledger.records.push(
    { kind: "expense", id: "e-m", vehicle_id: vid, ts: 6000, category_id: 100001, amount: 1200, remark: "第二次保养" },
    { kind: "maintenance", id: "m-new", vehicle_id: vid, ts: 6000, odometer: 3000, items: ["机油", "空调滤芯"], amount: 1200, remark: "第二次保养", expense_id: "e-m" } as MaintenanceRecord,
  )
  const plan = buildExport(doc, ledger, { now: NOW })
  assert.deepEqual(plan.problems, [])
  const car = carOf(plan.doc)
  const m = car.maintainRecords![0]
  assert.deepEqual([m.wc_id, m.addTime, m.maintains, m.customMaintains, m.currentMileage, m.id, m.isCost], [2, NOW, "机油,空调滤芯,", "", 3000, 0, false])
  const e = car.expenseRecords!.find(r => r.date === 6000)!
  assert.deepEqual([e.maintain_id, e.description], [2, "第二次保养\n保养里程：3000公里\n保养项目：机油,空调滤芯,\n"])
})

test("小熊里没有这辆车：在末尾新建；换了导出目标：写明替换原有的几条记录", () => {
  const doc = cloud()
  const ledger = imported(doc)
  ledger.vehicles.push({ id: "v2", name: "新车", default_grade: 92, created_ts: 0, xxyh_car: "1999999999", provider: null })
  ledger.vehicles.push({ id: "v3", name: "换目标的车", default_grade: 92, created_ts: 0, xxyh_car: "1000000002", provider: null })
  ledger.records.push({ kind: "expense", id: "e-v2", vehicle_id: "v2", ts: 100, category_id: 100003, amount: 10, remark: "" })
  const plan = buildExport(doc, ledger, { now: NOW })
  assert.deepEqual(plan.problems, [])
  const created = plan.cars.find(c => c.vehicle_id === "v2")!
  assert.deepEqual([created.created, plan.doc.cars.length, String(plan.doc.cars[2].uuid), plan.doc.cars[2].selected], [true, 3, "1999999999", 0])
  assert.equal(plan.doc.cars[2].expenseRecords!.length, 1)
  const replaced = plan.cars.find(c => c.vehicle_id === "v3")!
  assert.deepEqual([replaced.created, replaced.replaces, replaced.changes.fuel.deleted.length], [false, 1, 1])
})

test("两辆车导出到小熊的同一辆车、小熊里删掉了用到的费用类别：不通过", () => {
  const doc = cloud()
  const ledger = imported(doc)
  ledger.vehicles.push({ id: "v2", name: "第二辆", default_grade: 92, created_ts: 0, xxyh_car: CAR, provider: null })
  assert.ok(buildExport(doc, ledger, { now: NOW }).problems.some(p => p.includes("同一辆车")))
  const ledger2 = imported(doc)
  const noOther = { ...doc, expenseTypes: doc.expenseTypes!.filter(t => t._id !== 100003) }
  assert.ok(buildExport(noOther, ledger2, { now: NOW }).problems.some(p => p.includes("类别「其它」")))
})

test("上传前检查认出每一种不允许的改动", () => {
  const doc = cloud()
  const ledger = imported(doc)
  const good = buildExport(doc, ledger, { now: NOW }).doc
  const tamper = (fn: (d: XxyhBackup) => void) => {
    const d = JSON.parse(JSON.stringify(good)) as XxyhBackup
    fn(d)
    return validateExport(doc, d, ledger)
  }
  assert.deepEqual(validateExport(doc, good, ledger), [])
  const cases: Array<[string, (d: XxyhBackup) => void]> = [
    ["userInfo", d => { (d.userInfo as Record<string, unknown>).id = 43 }],
    ["没有对应的油记车辆", d => { d.cars[1].name = "改名" }],
    ["extra", d => { d.cars[0].extra = "改了" }],
    ["incomeRecords", d => { (d.cars[0].incomeRecords as unknown[]).push({ date: 11 }) }],
    ["充电记录", d => { d.cars[0].fuelRecords = d.cars[0].fuelRecords!.filter(r => r.replenishType !== 2) }],
    ["加油记录 3 条", d => { d.cars[0].fuelRecords!.splice(0, 1) }],
    ["编号重复", d => { d.cars[0].expenseRecords![1].wc_id = 2 }],
    ["不存在的油站", d => { d.cars[0].fuelRecords![0].stationId = "nope" }],
    ["丢失", d => { d.myStations!.stations!.splice(0, 1) }],
    ["被意外修改", d => { d.myStations!.stations![1].timeStamp = 99 }],
    ["myStations.version", d => { d.myStations!.version = 4 }],
    ["车辆列表", d => { d.cars.reverse() }],
  ]
  for (const [want, fn] of cases) assert.ok(tamper(fn).some(p => p.includes(want)), `${want}：${tamper(fn).join("；")}`)
})

test("小熊里在上次之后有改动：列出改过的、新记的、删掉的，导出用油记的覆盖", () => {
  const snapshot = cloud()
  const ledger = imported(snapshot)
  const now = cloud()
  const car = carOf(now)
  car.expenseRecords![1].expense = 60                                   // 小熊里改了金额
  car.expenseRecords!.push({ date: 4500, type: 100000, expense: 20, description: "过路费", wc_id: 3 })  // 小熊里新记的
  car.fuelRecords = car.fuelRecords!.filter(r => r.wc_id !== 2)        // 小熊里删掉的
  const plan = buildExport(now, ledger, { now: NOW, cloudVersion: 12, lastVersion: 11, lastSnapshot: snapshot })
  assert.deepEqual(plan.problems, [])
  const items = plan.cloud_changed!.items!
  assert.deepEqual([plan.cloud_changed!.from, plan.cloud_changed!.to], [11, 12])
  assert.deepEqual(items.map(i => i.change).sort(), ["added", "deleted", "modified"])
  const mod = items.find(i => i.change === "modified")!
  assert.deepEqual([mod.item.amount, mod.ours!.amount], [60, 50])
  // 覆盖：金额回到油记的 50，小熊里新记的删掉，删掉的那条恢复（编号还是 2）
  const out = carOf(plan.doc)
  assert.equal(byWc(out.expenseRecords, 1)!.expense, 50)
  assert.equal(out.expenseRecords!.length, 2)
  assert.equal(canon(byWc(out.fuelRecords, 2)), canon(byWc(carOf(snapshot).fuelRecords, 2)))
  // 没有上次的快照：只知道版本变了
  assert.equal(buildExport(now, ledger, { now: NOW, cloudVersion: 12, lastVersion: 11, lastSnapshot: null }).cloud_changed!.items, null)
  assert.equal(buildExport(now, ledger, { now: NOW, cloudVersion: 11, lastVersion: 11, lastSnapshot: snapshot }).cloud_changed, null)
})
