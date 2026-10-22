// 与真实数据核对（只读）。需要 XXYH_ROOT=E:\GitHub\xxyh；没有时跳过。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fuelSegments } from "../common/fuel"
import { chooseStop, findStops } from "../common/stops"
import { FuelRecord } from "../common/types"
import { summarize } from "../common/fuel_stats"
import { expenseEntries, expenseSummary, expenseYears, MAINTENANCE_CATEGORY, withoutCarInsurance } from "../common/expense_stats"
import { amountOnlyExpenses, INSURANCE_CATEGORY } from "../common/insurance"
import { mapVolvoTrip } from "../providers/volvo_cn"
import { Trip } from "../providers/types"
import { carKey, fuelFromXxyh, isRefuel, mapBackup } from "../sync/xxyh/mapping"
import { applyOps, validateUpload } from "../sync/xxyh/ops"
import { XxyhBackup, XxyhOp } from "../sync/xxyh/types"
import { latestBackupFile, readJson, XXYH_ROOT } from "./helpers"

const file = latestBackupFile()
const skip = file ? false : "需要 XXYH_ROOT 和 out/xxyh_backup_v*.json"

function load(): { doc: XxyhBackup; car: string; fuel: FuelRecord[] } {
  const doc = readJson(file!) as XxyhBackup
  const car = carKey(doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0])
  const m = mapBackup(doc, k => (k === car ? "veh" : null))
  return { doc, car, fuel: m.records.filter((r): r is FuelRecord => r.kind === "fuel") }
}

test("真实备份：油耗与小熊的 consumption 一致", { skip }, () => {
  const { doc, car, fuel } = load()
  const raw = doc.cars.find(c => carKey(c) === car)!.fuelRecords!.filter(isRefuel)
  const byDate = new Map(raw.map(r => [r.date, r]))
  const segs = fuelSegments(fuel)
  let checked = 0
  const diffs: string[] = []
  for (const s of segs) {
    const start = byDate.get(s.from.ts)!
    const stored = Number(start.consumption)
    if (!(stored > 0)) continue
    checked++
    if (Math.abs(stored - s.consumption) > 0.01) diffs.push(`${new Date(s.to.ts).toISOString().slice(0, 10)} 小熊 ${stored.toFixed(2)} / 油记 ${s.consumption.toFixed(2)}`)
  }
  console.log(`  ${file!.split(/[\\/]/).pop()}：${fuel.length} 条加油，${segs.length} 段，核对 ${checked} 段，不一致 ${diffs.length}`)
  diffs.slice(0, 5).forEach(d => console.log(`    ${d}`))
  assert.ok(checked > 100)
  assert.ok(diffs.length / checked < 0.02, diffs.join("；"))
  const all = summarize(fuel.map(r => ({ ...r, origin: "xxyh" as const, pending: false })), "all")
  console.log(`  平均油耗 ${all.avg_consumption?.toFixed(2)} L/100km（小熊 avgConsumption ${Number(doc.cars[0].avgConsumption).toFixed(2)}）`)
})

test("真实备份：小熊的保养记录都和同一时刻的费用合成一行，维修保养只算一次（设计文档 21.4 节）", { skip }, () => {
  const { doc, car } = load()
  const m = mapBackup(doc, k => (k === car ? "veh" : null))
  const recs = m.records.map(r => ({ ...r, origin: "xxyh" as const, pending: false }))
  const maintenance = recs.filter(r => r.kind === "maintenance")
  const entries = expenseEntries(recs)
  const merged = entries.filter(e => e.maintenance && e.expense)
  // 备份里带 maintain_id 的费用条数与保养记录一样多（保养记录的 id 都是 0，所以按时间对）
  const raw = doc.cars.find(c => carKey(c) === car)!
  const linked = (raw.expenseRecords || []).filter(e => e.maintain_id != null).length
  console.log(`  ${maintenance.length} 条保养，${merged.length} 条和费用合成一行；带 maintain_id 的费用 ${linked} 条`)
  assert.ok(maintenance.length > 0)
  assert.equal(merged.length, maintenance.length)
  assert.equal(linked, maintenance.length)
  assert.equal(entries.length, recs.filter(r => r.kind === "expense").length)
  const expenseFix = recs.reduce((s, r) => s + (r.kind === "expense" && r.category_id === MAINTENANCE_CATEGORY ? r.amount : 0), 0)
  const fix = expenseSummary(entries, "all").categories.find(c => c.category_id === MAINTENANCE_CATEGORY)?.amount ?? 0
  assert.ok(Math.abs(fix - expenseFix) < 0.005, `${fix} ≠ ${expenseFix}`)
})

test("真实备份：费用页只放车险以外的费用，车险都在保险页；各年合计之和等于费用统计「全部」（设计文档 22.5、22.6 节）", { skip }, () => {
  const { doc, car } = load()
  const recs = mapBackup(doc, k => (k === car ? "veh" : null)).records.map(r => ({ ...r, origin: "xxyh" as const, pending: false }))
  const entries = expenseEntries(recs)
  // 没有导入保单时，车险都是「只有金额」的
  const rest = withoutCarInsurance(entries, [])
  const cars = amountOnlyExpenses(recs, [])
  const sum = (list: Array<{ amount: number }>) => list.reduce((t, e) => t + e.amount, 0)
  console.log(`  车险以外 ${rest.length} 笔，车险 ${cars.length} 笔`)
  assert.equal(rest.length + cars.length, entries.length)
  assert.ok(Math.abs(sum(rest) + sum(cars) - sum(entries)) < 0.005)
  assert.ok(rest.every(e => e.category_id !== INSURANCE_CATEGORY || !/险/.test(e.expense?.remark ?? "")))
  const years = expenseYears(rest)
  assert.ok(Math.abs(sum(years.map(y => ({ amount: y.total }))) - expenseSummary(rest, "all").total) < 0.005)
  assert.equal(years.reduce((t, y) => t + y.count, 0), rest.length)
})

test("真实备份：空操作不改动；增改删后检查通过", { skip }, () => {
  const { doc, car } = load()
  const none = applyOps(doc, [])
  assert.deepEqual(none.doc, doc)
  assert.deepEqual(validateUpload(doc, none), [])
  const recs = doc.cars.find(c => carKey(c) === car)!.fuelRecords!.filter(isRefuel).slice().sort((a, b) => b.date - a.date)
  const latest = recs[0]
  const oldest = recs[recs.length - 1]
  const ops: XxyhOp[] = [
    { type: "put_fuel", car, key: null, data: { ...fuelFromXxyh(latest), ts: latest.date + 30 * 86400e3, odometer: latest.odometer + 500, station_id: null }, station: null, at: 1 },
    { type: "put_fuel", car, key: latest.date, data: { ...fuelFromXxyh(latest), remark: "测试备注" }, station: null, at: 2 },
    { type: "delete_fuel", car, key: oldest.date, at: 3 },
  ]
  const r = applyOps(doc, ops)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(validateUpload(doc, r), [])
  const after = r.doc.cars.find(c => carKey(c) === car)!.fuelRecords!
  assert.equal(after.filter(isRefuel).length, recs.length)
  const edited = after.find(x => x.date === latest.date)!
  const changed = Object.keys(edited).filter(k => JSON.stringify(edited[k]) !== JSON.stringify(latest[k]))
  assert.deepEqual(changed, ["remark"]) // 只改了备注
})

test("真实行程：加油停车回放（只用我的油站）", { skip: skip || (existsSync(join(XXYH_ROOT, "out/volvo_trips_archive.json")) ? false : "缺少行程存档") }, async () => {
  const { doc, fuel } = load()
  const stations = mapBackup(doc, () => null).stations
  const trips: Trip[] = (readJson(join(XXYH_ROOT, "out/volvo_trips_archive.json")) as any[]).map(mapVolvoTrip).filter((t): t is Trip => !!t).sort((a, b) => a.start_ts - b.start_ts)
  const recs = fuel.filter(r => r.ts >= trips[0].start_ts).sort((a, b) => a.ts - b.ts)
  let okA = 0
  let okB = 0
  for (const r of recs) {
    const stopsA = await findStops(trips.filter(t => t.end_ts >= r.ts - 86400e3 && t.end_ts <= r.ts + 86400e3), { stations, fuel, nearby: null, now: r.ts })
    const a = chooseStop(stopsA, r.ts)
    const goodA = !!(a && a.kind === "refuel" && a.stop.end_ts <= r.ts + 2 * 60e3 && a.stop.end_ts >= r.ts - 3 * 3600e3)
    const now = r.ts + 6 * 3600e3
    const stopsB = await findStops(trips.filter(t => t.start_ts <= now && t.end_ts >= now - 7 * 86400e3 && t.end_ts <= now), { stations, fuel: fuel.filter(x => x.ts < r.ts - 60e3), nearby: null, now })
    const b = chooseStop(stopsB, null)
    const goodB = !!(b && a && b.kind === "refuel" && b.stop.end_ts === a.stop.end_ts)
    if (goodA) okA++
    if (goodB) okB++
  }
  console.log(`  ${recs.length} 条加油：有支付时间 ${okA} 条选对，回家后再记 ${okB} 条选对`)
  assert.ok(okA >= recs.length - 1)
  assert.ok(okB >= recs.length - 2)
})

test("真实备份：本机车辆转为小熊车辆（20 条真实加油记录），检查通过、原有的车不动、读回来与本机记录相同", { skip }, async () => {
  const { convertToXxyh, makeAppData, vehicleRecords, vehiclesForCars } = await import("../common/ledger")
  const { emptyLedger } = await import("../common/types")
  const { emptyXxyhState } = await import("../sync/xxyh/types")
  const { doc, car, fuel } = load()
  const base = { ...emptyXxyhState(), base: doc, base_version: 1 }
  const ledger = vehiclesForCars(emptyLedger(), makeAppData(emptyLedger(), base).mirror.cars)
  const local = fuel.slice(0, 20).map((r, i) => ({ ...r, id: `l${i}`, vehicle_id: "local" }))
  ledger.vehicles.push({ id: "local", name: "测试车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: null })
  ledger.records = local.map(r => ({ ...r, origin: undefined, pending: undefined } as any))
  const c = convertToXxyh(makeAppData(ledger, base), "local", "4821736590", Date.now())
  const r = applyOps(doc, c.xxyh.ops)
  assert.deepEqual(r.conflicts, [])
  assert.deepEqual(validateUpload(doc, r), [])
  assert.equal(r.doc.cars.length, doc.cars.length + 1)
  assert.deepEqual(r.doc.cars.slice(0, doc.cars.length), doc.cars, "原有的车不动")
  const v = c.ledger.vehicles.find(x => x.id === "local")!
  const back = vehicleRecords(makeAppData(c.ledger, { ...c.xxyh, base: r.doc, ops: [] }), v)
  const pick = (x: any) => JSON.stringify([x.ts, x.odometer, x.liters, x.price, x.amount, x.paid, x.grade, x.full, x.light_on, x.missed_before, x.station_id, x.remark])
  assert.deepEqual(back.map(pick).sort(), local.map(pick).sort())
  assert.ok(car)
})
