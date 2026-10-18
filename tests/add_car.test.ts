// 在小熊云端新建车辆（add_car，设计文档 17.4 节）：车辆模板、重复应用、上传前检查
import { test } from "node:test"
import assert from "node:assert/strict"
import { applyOps, describeOp, validateUpload } from "../sync/xxyh/ops"
import { newCarUuid, newXxyhCar } from "../sync/xxyh/mapping"
import { XxyhBackup, XxyhOp } from "../sync/xxyh/types"

const EMPTY = { model: null, model_name: null, pinpai: null, chexi: null, vehicle_type: null, replenish_mode: null, gas_type: null, buy_date: null }

const base = (): XxyhBackup => ({ cars: [{ uuid: "1045409933", name: "沃尔沃S90", sortId: 0, selected: 1, fuelRecords: [], expenseRecords: [] }], myStations: { stations: [] } })

test("新车模板：没选车型时 model -1、燃油、汽车；购车日期默认建车当天；不改当前车辆", () => {
  const car = newXxyhCar("4821736590", "S60", EMPTY, 1, new Date(2026, 9, 19, 9).getTime())
  assert.deepEqual(car, {
    uuid: "4821736590", name: "S60", model: -1, vehicle_type: 1, replenishMode: 1, buyDate: "2026-10-19", sortId: 1, sortKey: 1, selected: 0,
    avgConsumption: 0, odometerCorrection: 0, fuelRecords: [], expenseRecords: [], maintainRecords: [], incomeRecords: [], reminderRecords: [],
  })
})

test("新车 uuid：10 位数字字符串，首位不为 0，不与已有的重复", () => {
  const seq = [0, 0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.95, 0.5, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
  let i = 0
  const first = newCarUuid(new Set(), () => seq[i++ % seq.length])
  assert.match(first, /^[1-9]\d{9}$/)
  i = 0
  const second = newCarUuid(new Set([first]), () => seq[i++ % seq.length])
  assert.notEqual(second, first)
  for (let k = 0; k < 200; k++) assert.match(newCarUuid(new Set()), /^[1-9]\d{9}$/)
})

test("add_car：追加在末尾，记录操作接在后面；同一个 uuid 已在云端时不重复新建", () => {
  const ops: XxyhOp[] = [
    { type: "add_car", car: "4821736590", name: "S60", profile: EMPTY, at: 0 },
    { type: "put_expense", car: "4821736590", key: null, data: { ts: 1, category_id: 100000, amount: 20, remark: "停车" }, at: 0 },
  ]
  assert.equal(describeOp(ops[0]), "新建车辆「S60」")
  const r = applyOps(base(), ops)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual([...r.addedCars], ["4821736590"])
  assert.deepEqual(r.doc.cars.map(c => c.uuid), ["1045409933", "4821736590"])
  assert.equal(r.doc.cars[1].expenseRecords!.length, 1)
  assert.equal(r.doc.cars[1].expenseRecords![0].carId, 4821736590)
  assert.deepEqual(validateUpload(base(), r), [])
  // 上次上传成功但没收到回应：再应用一次，不重复新建、不重复插入
  const again = applyOps(r.doc, ops)
  assert.equal(again.doc.cars.length, 2)
  assert.equal(again.addedCars.size, 0)
  assert.equal(again.doc.cars[1].expenseRecords!.length, 1)
  assert.deepEqual(validateUpload(r.doc, again), [])
  // 没有 add_car 的记录操作仍是冲突
  assert.match(applyOps(base(), [ops[1]]).conflicts[0].reason, /没有这辆车/)
})

test("上传前检查：只允许在末尾追加本次新建的车，新车里只能有本次新增的记录", () => {
  const ops: XxyhOp[] = [{ type: "add_car", car: "4821736590", name: "S60", profile: EMPTY, at: 0 }]
  const r = applyOps(base(), ops)
  // 车不在末尾
  const moved = { ...r, doc: { ...r.doc, cars: [r.doc.cars[1], r.doc.cars[0]] } }
  assert.match(validateUpload(base(), moved).join(), /车辆列表/)
  // 多出一辆没有 add_car 的车
  const extra = { ...r, doc: { ...r.doc, cars: [...r.doc.cars, { uuid: "9", name: "多出来的" }] } }
  assert.match(validateUpload(base(), extra).join(), /车辆列表/)
  // 新车里出现了不是本次新增的记录
  const dirty = { ...r, doc: JSON.parse(JSON.stringify(r.doc)) as XxyhBackup }
  dirty.doc.cars[1].fuelRecords!.push({ date: 5, odometer: 1 })
  ;(dirty.doc.cars[1].maintainRecords as unknown[]).push({ dateTime: 5 })
  const problems = validateUpload(base(), dirty).join()
  assert.match(problems, /加油记录条数不符/)
  assert.match(problems, /maintainRecords/)
  // 原有的车被改动仍会发现
  const touched = { ...r, doc: JSON.parse(JSON.stringify(r.doc)) as XxyhBackup }
  touched.doc.cars[0].name = "改名"
  assert.match(validateUpload(base(), touched).join(), /name 被意外修改/)
})
