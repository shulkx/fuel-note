// 1.x 的备份 → 2.0（tools/migrate_v2_core.ts，2.0 设计第 5 节）：小熊车辆的记录变成本机记录、1.x 的编号换成新 id（保险、权益使用跟着换）、
// 保养配上费用、门店只拆有把握的、id 固定（重跑结果一样）、有没上传的修改时不转。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseBackup } from "../common/backup"
import { ledgerProblems } from "../common/ledger_file"
import { ExpenseRecord, MaintenanceRecord } from "../common/types"
import { migrateV1, recordCounts, V1Backup } from "../tools/migrate_v2_core"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const FUEL = BJ("2026-10-12T14:39:52")
const MAINT = BJ("2026-05-01T09:00:00")
const INS = BJ("2025-12-20T10:00:00")
const WASH = BJ("2026-06-01T10:00:00")
const USED = BJ("2026-07-01T10:00:00")
const WAX = BJ("2026-08-01T10:00:00")
const PARK = BJ("2026-09-01T10:00:00")

function input(): V1Backup {
  const fuel = (date: number, odometer: number) => ({
    date, odometer, fueledLiter: 40, price: 8, yuan: 320, payYuan: 320, type: 95, gassup: true, stationId: "", remark: "", wc_id: odometer, carId: 1000000001, replenishType: 1,
  })
  const expense = (date: number, type: number, amount: number, description: string, wc = date % 1000) =>
    ({ date, type, expense: amount, description, wc_id: wc, carId: 1000000001 })
  return {
    format: "fuelnote-backup", version: 1, app_version: "1.7.0", created_at: "2026-10-24T02:00:00.000Z",
    ledger: {
      schema_version: 1,
      vehicles: [
        { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: "1000000001", provider: null },
        { id: "v2", name: "本机车", default_grade: 92, created_ts: 0, xxyh_car: null, provider: null, former_xxyh_car: "3000000003" },
      ],
      records: [
        { kind: "expense", id: "l1", vehicle_id: "v2", ts: INS, category_id: 100002, amount: 950, remark: "2026 车险 · 示例财险" },
        { kind: "fuel", id: "l2", vehicle_id: "v2", ts: FUEL, odometer: 100, liters: 30, price: 8, amount: 240, paid: 240, grade: 92, full: true, light_on: false, missed_before: false, station_id: null, remark: "" },
      ],
      stations: [],
      expense_categories: [{ id: 100000, name: "行车费", description: "" }],
      settings: { current_vehicle_id: "v1", xxyh_auto_upload: true },
      xxyh_ignored_cars: ["2000000002"],
      insurance: [
        { id: "y1", vehicle_id: "v1", policies: [], discount: 0, paid_ts: INS, expense_id: `x:1000000001:e:${INS}`, remark: "" },
        { id: "y2", vehicle_id: "v2", policies: [], discount: 0, paid_ts: INS, expense_id: "l1", remark: "" },
        { id: "y3", vehicle_id: "v1", policies: [], discount: 0, paid_ts: INS, expense_id: "x:1000000001:e:1", remark: "" },
      ],
      stores: [{ id: "st1", name: "示例沃尔沃", full_name: "", address: "", phone: "", lng: null, lat: null, source: "manual" }],
      perks: [{
        id: "fund", vehicle_id: "v1", name: "维修保养券", kind: "balance", total: 1000, unit: "元", end_ts: null, store: "示例沃尔沃",
        source: "2026 车险", insurance_id: "y1", origin: "insurance", raw: "", note: "", created_ts: 0,
      }],
      perk_uses: [
        { id: "u1", perk_id: "fund", ts: USED, used: 300, deduct: 300, expense_ts: USED, note: "" },
        { id: "u2", perk_id: "fund", ts: USED, used: 100, deduct: 100, expense_ts: null, note: "" },
        { id: "u3", perk_id: "fund", ts: USED, used: 1, deduct: 1, expense_ts: 12345, note: "" },
      ],
    },
    xxyh: {
      schema_version: 1, account_id: "42", nickname: "示例用户", base_version: 317, ops: [],
      base: {
        expenseTypes: [{ _id: 100001, name: "维修保养", sortId: 1 }, { _id: 100002, name: "保险和交通规费", sortId: 2 }],
        myStations: { stations: [{ id: "130176295072566815", name: "三桥", longitudeE6: 121600287, latitudeE6: 31236122, coordinate_type: "wgs84", timeStamp: 1 }] },
        cars: [{
          uuid: "1000000001", name: "示例车", selected: 1, gasType: "95号",
          // 同一时刻两条加油：1.x 的编号是 …#2
          fuelRecords: [fuel(FUEL, 82912), fuel(FUEL, 82913)],
          expenseRecords: [
            expense(INS, 100002, 6830.5, "2026 车险 · 示例财险"),
            expense(MAINT, 100001, 900, "小保养"),
            expense(WASH, 1646374903, 60, "洗车\n示例洗车店"),
            expense(USED, 100001, 0, "保养\n维修保养券抵扣 ¥300.00 · 示例沃尔沃"),
            expense(WAX, 1646374903, 200, "打蜡\n某某汽车美容"),
            expense(PARK, 100000, 10, "停车\n示例沃尔沃"),
          ],
          maintainRecords: [{ dateTime: MAINT, currentMileage: 80000, maintains: "机油,", spend: 900, message: "小保养" }],
        }],
      },
    },
  }
}

const LIST = { split: ["示例洗车店"], rename: {} }

test("转换：小熊车辆的记录变成本机记录，本机车辆的照旧；保养配上费用；条数对得上；结果能当 2.0 的备份恢复", () => {
  const { backup, report } = migrateV1(input(), LIST, "2.0.0-beta.2")
  const l = backup.ledger
  assert.equal(l.schema_version, 2)
  assert.deepEqual(recordCounts(l.records), { v1: { fuel: 2, expense: 6, maintenance: 1 }, v2: { fuel: 1, expense: 1, maintenance: 0 } })
  assert.deepEqual(report.vehicles, [{ name: "示例车", fuel: 2, expense: 6, maintenance: 1, paired: 1 }])
  const m = l.records.find((r): r is MaintenanceRecord => r.kind === "maintenance")!
  const paired = l.records.find(r => r.id === m.expense_id) as ExpenseRecord
  assert.deepEqual([paired.ts, paired.amount, m.items], [MAINT, 900, ["机油"]])
  assert.ok(l.records.filter(r => r.vehicle_id === "v1").every(r => r.xxyh_raw), "小熊的原样留着，导出时用")
  assert.ok(l.records.find(r => r.id === "l2"), "本机记录的 id 不变")
  // 车辆：去掉 1.x 的字段，补上车型资料；油站、类别从小熊补齐；去掉自动上传的设置
  assert.equal("former_xxyh_car" in l.vehicles[1], false)
  assert.equal(l.vehicles[0].profile?.gas_type, "95号")
  assert.equal("xxyh_ignored_cars" in l, false)
  assert.equal("xxyh_auto_upload" in l.settings, false)
  assert.deepEqual(l.stations.map(s => s.id), ["130176295072566815"])
  assert.ok(l.expense_categories.some(c => c.name === "维修保养"))
  // 小熊状态：账号和版本留着
  assert.deepEqual([backup.xxyh.schema_version, backup.xxyh.account_id, backup.xxyh.last_version], [2, "42", 317])
  assert.ok(backup.xxyh_snapshot?.cars.length)
  assert.deepEqual(parseBackup(JSON.stringify(backup)), backup)
  assert.deepEqual(ledgerProblems(l), [])
})

test("转换：保险按 1.x 的编号换成新 id，本机费用的 id 不变，找不到的清掉并写进报告", () => {
  const { backup, report } = migrateV1(input(), LIST, "2.0.0")
  const l = backup.ledger
  const y1 = l.insurance.find(y => y.id === "y1")!
  const e = l.records.find(r => r.id === y1.expense_id) as ExpenseRecord
  assert.deepEqual([e.ts, e.amount, e.category_id], [INS, 6830.5, 100002])
  assert.equal(l.insurance.find(y => y.id === "y2")!.expense_id, "l1")
  assert.equal(l.insurance.find(y => y.id === "y3")!.expense_id, null)
  assert.deepEqual(report.insurance.map(i => [i.id, i.ok]), [["y1", true], ["y2", true], ["y3", false]])
})

test("转换：权益使用按费用的时间找到那一笔；记一次使用照旧；对不上的写进报告", () => {
  const { backup, report } = migrateV1(input(), LIST, "2.0.0")
  const l = backup.ledger
  const used = l.records.find(r => r.kind === "expense" && r.ts === USED)!
  assert.deepEqual(l.perk_uses.map(u => [u.id, u.expense_id]), [["u1", used.id], ["u2", null], ["u3", null]])
  assert.equal("expense_ts" in l.perk_uses[0], false)
  assert.deepEqual([report.uses.total, report.uses.matched, report.uses.unmatched.length], [3, 2, 1])
})

test("转换的门店：最后一行是这笔的用量写法、已知门店或白名单里的才拆；车险的不拆；认不准的列进报告", () => {
  const { backup, report } = migrateV1(input(), LIST, "2.0.0")
  const l = backup.ledger
  const at = (ts: number) => l.records.find(r => r.kind === "expense" && r.ts === ts) as ExpenseRecord
  const storeName = (e: ExpenseRecord) => l.stores.find(s => s.id === e.store_id)?.name ?? null
  // 用量写法 + 已知门店
  assert.deepEqual([at(USED).remark, storeName(at(USED))], ["保养", "示例沃尔沃"])
  // 白名单
  assert.deepEqual([at(WASH).remark, storeName(at(WASH))], ["洗车", "示例洗车店"])
  // 只写了已知门店
  assert.deepEqual([at(PARK).remark, storeName(at(PARK))], ["停车", "示例沃尔沃"])
  // 认不准：备注不动，列进报告
  assert.deepEqual([at(WAX).remark, at(WAX).store_id], ["打蜡\n某某汽车美容", undefined])
  assert.deepEqual(report.pending, [{ name: "某某汽车美容", count: 1, ts: [WAX] }])
  // 车险不拆
  assert.equal(at(INS).remark, "2026 车险 · 示例财险")
  assert.deepEqual(report.stores.map(s => [s.name, s.count]).sort(), [["示例沃尔沃", 2], ["示例洗车店", 1]])
  assert.equal(l.stores.filter(s => s.name === "示例沃尔沃").length, 1, "已有的门店不重复建")
  // 白名单里改名：并成同一家
  const renamed = migrateV1(input(), { split: ["示例洗车店"], rename: { 示例洗车店: "示例沃尔沃" } }, "2.0.0").backup.ledger
  const wash = renamed.records.find(r => r.kind === "expense" && r.ts === WASH) as ExpenseRecord
  assert.equal(wash.store_id, "st1")
})

test("转换：id 固定，重跑结果一样；有没上传的修改、不是 1.x 的备份时不转", () => {
  const a = migrateV1(input(), LIST, "2.0.0").backup
  const b = migrateV1(input(), LIST, "2.0.0").backup
  assert.deepEqual(a, b)
  const pending = input()
  pending.xxyh.ops = [{ type: "put_fuel" }]
  assert.throws(() => migrateV1(pending, LIST, "2.0.0"), /1 条没上传的修改.*立即同步/)
  assert.throws(() => migrateV1({ ...input(), version: 2 }, LIST, "2.0.0"), /不是 1\.x/)
})
