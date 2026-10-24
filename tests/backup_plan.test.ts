// 备份的纯规则（common/backup_plan.ts）：文件名、自动备份的时机、留几份（含 iCloud 的占位文件）、zip 里的原件份数。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  AUTO_KEEP, autoBackupDeletions, BACKUP_PREFIX, backupName, emptyAutoBackupState, ledgerHash, needsAutoBackup, policyFileCount, RESTORE_PREFIX, rotation,
} from "../common/backup_plan"
import { emptyLedger } from "../common/types"

test("文件名：前缀加上设备时区的年月日-时分秒", () => {
  const ms = new Date(2026, 9, 24, 21, 30, 5).getTime()
  assert.equal(backupName(BACKUP_PREFIX, ms), "油记备份-20261024-213005.zip")
  assert.equal(backupName(RESTORE_PREFIX, ms), "恢复前-20261024-213005.zip")
})

test("数据的指纹：换当前车辆、点「×」不算变化；记录变了算", () => {
  const a = emptyLedger()
  const b = { ...a, settings: { ...a.settings, current_vehicle_id: "v2", dismissed_stops: [1], dismissed_renewals: ["y1"] } }
  assert.equal(ledgerHash(b), ledgerHash(a))
  const c = { ...a, stations: [{ id: "s1", name: "示例站", address: "", province: "", city: "", district: "", lng: 121, lat: 31, last_used_ts: 0 }] }
  assert.notEqual(ledgerHash(c), ledgerHash(a))
  const d = { ...a, settings: { ...a.settings, default_full: false } }
  assert.notEqual(ledgerHash(d), ledgerHash(a), "别的设置算数据")
})

test("要不要自动备份：从没备份过、或数据和上一份不一样", () => {
  assert.equal(needsAutoBackup(null, "h1"), true)
  assert.equal(needsAutoBackup(emptyAutoBackupState(), "h1"), true)
  const last = { ...emptyAutoBackupState(), last_ts: 1, last_hash: "h1", last_name: "x.zip" }
  assert.equal(needsAutoBackup(last, "h2"), true)
  assert.equal(needsAutoBackup(last, "h1"), false, "没变不备份")
})

test("写好新的自动备份后：同一天更早的删掉，再按天留最近几份；恢复前的、别的文件不动", () => {
  const names = [
    "油记备份-20261024-090000.zip", ".油记备份-20261024-120000.zip.icloud", "油记备份-20261024-213005.zip",
    "油记备份-20261023-200000.zip", "油记备份-20261022-200000.zip", "油记备份-20261021-200000.zip", "恢复前-20261024-100000.zip", "说明.txt",
  ]
  assert.deepEqual(autoBackupDeletions(names, BACKUP_PREFIX, "油记备份-20261024-213005.zip", 3),
    ["油记备份-20261024-090000.zip", ".油记备份-20261024-120000.zip.icloud", "油记备份-20261021-200000.zip"])
  assert.deepEqual(autoBackupDeletions(["油记备份-20261024-213005.zip"], BACKUP_PREFIX, "油记备份-20261024-213005.zip", AUTO_KEEP), [])
})

test("留最近几份：按名字里的时间，iCloud 的占位文件也认；恢复前的和别的文件不动", () => {
  const names = [
    "油记备份-20261001-090000.zip", "油记备份-20261003-090000.zip", ".油记备份-20261002-090000.zip.icloud",
    "油记备份-20261004-090000.zip", "恢复前-20260101-090000.zip", "说明.txt", "油记备份-坏的名字.zip",
  ]
  assert.deepEqual(rotation(names, BACKUP_PREFIX, 2), [".油记备份-20261002-090000.zip.icloud", "油记备份-20261001-090000.zip"])
  assert.deepEqual(rotation(names, BACKUP_PREFIX, AUTO_KEEP), [])
  assert.deepEqual(rotation(names, RESTORE_PREFIX, 0), ["恢复前-20260101-090000.zip"])
})

test("zip 里保单原件的份数：insurance/ 下的文件，不算文件夹和 backup.json", () => {
  assert.equal(policyFileCount(["backup.json", "insurance/", "insurance/y1/", "insurance/y1/保单.pdf", "insurance/y1/标志.jpg", "insurance/y2/保单.pdf"]), 3)
  assert.equal(policyFileCount(["backup.json"]), 0)
})
