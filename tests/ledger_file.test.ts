// 账本文件的检查（common/ledger_file.ts，2.0 设计第 3 节）：认出 1.x 的格式、找出每一种断开的引用。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { isLedgerV2, isLegacyLedger, ledgerProblems } from "../common/ledger_file"
import { emptyLedger, LedgerFile } from "../common/types"

test("1.x 和 2.0 的格式：1.x 只认 schema_version 1；2.0 要有车辆和记录", () => {
  assert.equal(isLegacyLedger({ schema_version: 1, vehicles: [] }), true)
  assert.equal(isLegacyLedger({ schema_version: 2, vehicles: [] }), false)
  assert.equal(isLegacyLedger(null), false)
  assert.equal(isLedgerV2({ schema_version: 2, vehicles: [], records: [] }), true)
  assert.equal(isLedgerV2({ schema_version: 2, vehicles: [] }), false)
  assert.equal(isLedgerV2({ schema_version: 1, vehicles: [], records: [] }), false)
})

test("引用检查：车辆、油站、门店、费用、权益卡找不到，记录 id 重复，都列出来；没有问题时是空的", () => {
  const ok: LedgerFile = {
    ...emptyLedger(),
    vehicles: [{ id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null }],
    stations: [{ id: "s1", name: "示例站", address: "", province: "", city: "", district: "", lng: 121, lat: 31, last_used_ts: 0 }],
    stores: [{ id: "st1", name: "示例店", full_name: "", address: "", phone: "", lng: null, lat: null, source: "manual" }],
    records: [
      { kind: "fuel", id: "f1", vehicle_id: "v1", ts: 1, odometer: 1, liters: 1, price: 1, amount: 1, paid: 1, grade: 95, full: true, light_on: false, missed_before: false, station_id: "s1", remark: "" },
      { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 1, remark: "", store_id: "st1" },
      { kind: "maintenance", id: "m1", vehicle_id: "v1", ts: 1, odometer: 1, items: [], amount: 1, remark: "", expense_id: "e1" },
    ],
    insurance: [{ id: "y1", vehicle_id: "v1", policies: [], discount: 0, paid_ts: 1, expense_id: "e1", remark: "" }],
    perks: [{ id: "p1", vehicle_id: "v1", name: "洗车", kind: "count", total: 1, unit: "次", end_ts: null, store: "", source: "示例", insurance_id: null, origin: "other", raw: "", note: "", created_ts: 0 }],
    perk_uses: [{ id: "u1", perk_id: "p1", ts: 1, used: 1, deduct: 0, expense_id: "e1", note: "" }],
  }
  assert.deepEqual(ledgerProblems(ok), [])
  const broken: LedgerFile = { ...ok, vehicles: [], stations: [], stores: [], perks: [], records: [...ok.records.filter(r => r.kind !== "expense"), { ...ok.records[0] }] }
  const problems = ledgerProblems(broken)
  for (const want of [/记录 f1 重复/, /记录 f1 的车辆不存在/, /f1 的油站/, /保养记录 m1 对应的费用/, /保险 y1 的车辆/, /保险 y1 对应的费用/, /使用记录 u1 的权益/, /使用记录 u1 对应的费用/]) {
    assert.ok(problems.some(p => want.test(p)), `${want} 不在：${problems.join("；")}`)
  }
  const noStore = ledgerProblems({ ...ok, stores: [] })
  assert.deepEqual(noStore, ["费用 e1 的门店不在门店列表里"])
  const noVehiclePerk = ledgerProblems({ ...ok, perks: [{ ...ok.perks[0], vehicle_id: "gone" }] })
  assert.deepEqual(noVehiclePerk, ["权益 p1 的车辆不存在"])
})
