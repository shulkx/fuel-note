// 导出到小熊时新建的车（2.0.0-beta.4 用）：车辆模板、uuid
import { test } from "node:test"
import assert from "node:assert/strict"
import { newCarUuid, newXxyhCar } from "../sync/xxyh/mapping"

const EMPTY = { model: null, model_name: null, pinpai: null, chexi: null, vehicle_type: null, replenish_mode: null, gas_type: null, buy_date: null }

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
