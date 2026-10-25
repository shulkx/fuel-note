// 与真实数据核对（只读）。需要 XXYH_ROOT=E:\GitHub\xxyh；没有时跳过。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fuelSegments } from "../common/fuel"
import { chooseStop, findStops } from "../common/stops"
import { emptyLedger, FuelRecord, LedgerFile, LocalRecord } from "../common/types"
import { summarize } from "../common/fuel_stats"
import { expenseEntries, expenseSummary, expenseYears, MAINTENANCE_CATEGORY, withoutCarInsurance } from "../common/expense_stats"
import { amountOnlyExpenses, INSURANCE_CATEGORY } from "../common/insurance"
import { mapVolvoTrip } from "../providers/volvo_cn"
import { Trip } from "../providers/types"
import { ledgerProblems } from "../common/ledger_file"
import { buildExport, canon, changeCount } from "../sync/xxyh/export"
import { importCars, recordsFromCar } from "../sync/xxyh/import"
import { carKey, isRefuel, stationFromXxyh } from "../sync/xxyh/mapping"
import { XxyhBackup } from "../sync/xxyh/types"
import { latestBackupFile, readJson, XXYH_ROOT } from "./helpers"

const file = latestBackupFile()
const skip = file ? false : "需要 XXYH_ROOT 和 out/xxyh_backup_v*.json"

function load(): { doc: XxyhBackup; car: string; recs: LocalRecord[]; fuel: FuelRecord[] } {
  const doc = readJson(file!) as XxyhBackup
  const selected = doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0]
  const recs = recordsFromCar(selected, "veh")
  return { doc, car: carKey(selected), recs, fuel: recs.filter((r): r is FuelRecord => r.kind === "fuel") }
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
  const all = summarize(fuel, "all")
  console.log(`  平均油耗 ${all.avg_consumption?.toFixed(2)} L/100km（小熊 avgConsumption ${Number(doc.cars[0].avgConsumption).toFixed(2)}）`)
})

test("真实备份：导入时保养都配上同一时刻的费用（expense_id），合成一行，维修保养只算一次（设计文档 21.4 节）", { skip }, () => {
  const { doc, car, recs } = load()
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
  const { recs } = load()
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

test("真实备份：导入全部的车，记录条数与小熊里的一致（充电除外），引用都找得到", { skip }, () => {
  const { doc } = load()
  const r = importCars(emptyLedger(), doc, doc.cars.map(carKey), Date.now())
  const want = doc.cars.reduce((t, c) => t + (c.fuelRecords || []).filter(isRefuel).length + (c.expenseRecords || []).length + (c.maintainRecords || []).length, 0)
  console.log(`  ${r.added.map(a => `「${a.name}」${a.records} 条`).join("、")}`)
  assert.equal(r.ledger.records.length, want)
  assert.equal(r.ledger.vehicles.length, doc.cars.length)
  assert.deepEqual(ledgerProblems(r.ledger), [])
  assert.equal(new Set(r.ledger.records.map(x => x.id)).size, want, "id 不重复")
})

test("真实行程：加油停车回放（只用我的油站）", { skip: skip || (existsSync(join(XXYH_ROOT, "out/volvo_trips_archive.json")) ? false : "缺少行程存档") }, async () => {
  const { doc, fuel } = load()
  const stations = (doc.myStations?.stations || []).map(stationFromXxyh)
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

const converted = XXYH_ROOT ? join(XXYH_ROOT, "out/fuelnote/backup-v2.json") : ""
test("真实数据：用户恢复的那份账本直接导出，和云端 v321 只差恢复后删掉的那几笔费用，其他逐字段相同（2.0 设计第 7 节）", { skip: converted && existsSync(converted) ? false : "需要 XXYH_ROOT/out/fuelnote/backup-v2.json" }, () => {
  const b = readJson(converted) as { ledger: LedgerFile; xxyh_snapshot: XxyhBackup }
  const plan = buildExport(b.xxyh_snapshot, b.ledger, { now: Date.now() })
  assert.deepEqual(plan.problems, [])
  const kept = new Set(b.ledger.records.filter(r => r.xxyh_raw).map(r => canon(r.xxyh_raw)))
  const expected = JSON.parse(JSON.stringify(b.xxyh_snapshot)) as XxyhBackup
  for (const car of expected.cars) car.expenseRecords = (car.expenseRecords || []).filter(r => kept.has(canon(r)))
  assert.equal(JSON.stringify(plan.doc), JSON.stringify(expected))
  const gone = (b.xxyh_snapshot.cars.reduce((n, c) => n + (c.expenseRecords || []).length, 0)) - expected.cars.reduce((n, c) => n + (c.expenseRecords || []).length, 0)
  assert.equal(changeCount(plan), gone)
  assert.ok(plan.cars.every(c => !c.created && !c.replaces))
})
