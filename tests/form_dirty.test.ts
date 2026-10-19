// 编辑记录时「有没有改动」（下滑能否关闭、保存时写什么）：没改过的字段用原值。
// 小熊的金额、单价、升数常有两位以上小数，输入框只显示两位；按显示的值比较会把一半的记录当成已改动（2026-10-19 用户发现）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { keptNumber, numText } from "../common/form"
import { FuelRecord } from "../common/types"
import { carKey, mapBackup } from "../sync/xxyh/mapping"
import { XxyhBackup } from "../sync/xxyh/types"
import { latestBackupFile, readJson } from "./helpers"

test("没改过的数值用原值；改过或清空时按输入框的内容", () => {
  const opened = numText(392.3756)
  assert.equal(opened, "392.38")
  assert.equal(keptNumber(opened, opened, 392.3756), 392.3756)
  assert.equal(keptNumber("392.4", opened, 392.3756), 392.4)
  assert.equal(keptNumber("", opened, 392.3756), null)
  // 新记录（没有原值）
  assert.equal(keptNumber("7.85", "", undefined), 7.85)
  assert.equal(keptNumber("", "", undefined), null)
})

const file = latestBackupFile()

test("真实备份：每条加油记录打开后不改，数值都与原值相同（不算改动，保存也不会改成两位小数）", { skip: file ? false : "需要 XXYH_ROOT 和 out/xxyh_backup_v*.json" }, () => {
  const doc = readJson(file!) as XxyhBackup
  const car = carKey(doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0])
  const fuel = mapBackup(doc, k => (k === car ? "veh" : null)).records.filter((r): r is FuelRecord => r.kind === "fuel")
  assert.ok(fuel.length > 100)
  let roundedBefore = 0
  const changed: string[] = []
  for (const r of fuel) {
    for (const f of ["price", "liters", "amount", "paid", "odometer"] as const) {
      const shown = f === "odometer" ? String(r[f]) : numText(r[f])
      if (Number(shown) !== r[f]) roundedBefore++
      if (keptNumber(shown, shown, r[f]) !== r[f]) changed.push(`${new Date(r.ts).toISOString().slice(0, 10)} ${f}`)
    }
  }
  assert.ok(roundedBefore > 50, "真实数据里确实有两位以上小数的值")
  assert.deepEqual(changed, [])
})
