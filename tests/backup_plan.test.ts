// 备份的纯规则（common/backup_plan.ts）：文件名、认出备份文件（含 iCloud 的占位文件）、自动备份的分层留存、恢复前留几份、
// 恢复列表的分组、要不要自动备份、数据指纹、zip 里的原件份数。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  autoBackupDeletions, autoBuckets, BACKUP_PREFIX, backupGroups, backupName, BackupEntry, backupTime, emptyAutoBackupState, ledgerHash, MANUAL_PREFIX, needsAutoBackup,
  parseBackupFile, policyFileCount, RESTORE_PREFIX, restoreCopyDeletions,
} from "../common/backup_plan"
import { emptyLedger } from "../common/types"

const NOW = new Date(2026, 9, 25, 12, 0, 0).getTime()
const auto = (stamp: string) => `油记备份-${stamp}.zip`
const names = (list: BackupEntry[]) => list.map(e => e.name)

test("文件名：前缀加上设备时区的年月日-时分秒", () => {
  const ms = new Date(2026, 9, 24, 21, 30, 5).getTime()
  assert.equal(backupName(BACKUP_PREFIX, ms), "油记备份-20261024-213005.zip")
  assert.equal(backupName(MANUAL_PREFIX, ms), "手动备份-20261024-213005.zip")
  assert.equal(backupName(RESTORE_PREFIX, ms), "恢复前-20261024-213005.zip")
})

test("认出备份文件：三种前缀、iCloud 的占位文件；名字不对的不算", () => {
  assert.deepEqual(parseBackupFile("油记备份-20261024-213005.zip"),
    { file: "油记备份-20261024-213005.zip", name: "油记备份-20261024-213005.zip", kind: "auto", y: 2026, mo: 10, d: 24, h: 21, mi: 30, s: 5, downloaded: true })
  const p = parseBackupFile(".手动备份-20261001-080000.zip.icloud")!
  assert.deepEqual([p.kind, p.name, p.downloaded], ["manual", "手动备份-20261001-080000.zip", false])
  assert.equal(parseBackupFile("恢复前-20260101-000000.zip")!.kind, "restore")
  assert.equal(backupTime(p), new Date(2026, 9, 1, 8, 0, 0).getTime())
  for (const bad of ["油记备份-坏的.zip", "说明.txt", "油记备份-20261024.zip", "其他-20261024-213005.zip"]) assert.equal(parseBackupFile(bad), null, bad)
})

test("自动备份的分层留存：最近 7 天每天最后一份、再往前 4 周每周最后一份、再往前 12 个月每月最后一份", () => {
  const files = [
    auto("20261025-080000"), auto("20261025-110000"), auto("20261020-090000"),          // 最近 7 天：10/25 留 11:00，10/20
    auto("20261015-090000"), auto("20261013-090000"), auto("20261001-090000"), auto("20260922-090000"),   // 4 周：第 42 周留 10/15，第 40、39 周
    auto("20260920-090000"), auto("20260905-090000"), auto("20251103-090000"), auto("20251001-090000"), auto("20250930-090000"),   // 12 个月
    "手动备份-20200101-000000.zip", "恢复前-20200101-000000.zip",
  ]
  const entries = files.map(parseBackupFile).filter((e): e is BackupEntry => !!e)
  const b = autoBuckets(entries, NOW)
  assert.deepEqual(names(b.daily), [auto("20261025-110000"), auto("20261020-090000")])
  assert.deepEqual(names(b.weekly), [auto("20261015-090000"), auto("20261001-090000"), auto("20260922-090000")])
  assert.deepEqual(names(b.monthly), [auto("20260920-090000"), auto("20251103-090000"), auto("20251001-090000")])
  assert.deepEqual(autoBackupDeletions(files, NOW).sort(),
    [auto("20250930-090000"), auto("20260905-090000"), auto("20261013-090000"), auto("20261025-080000")].sort(), "立即备份和恢复前的不删")
})

test("最新的一份总留着；占位文件按实际的文件名删", () => {
  const old = [auto("20240101-090000"), ".油记备份-20231201-090000.zip.icloud"]
  const b = autoBuckets(old.map(parseBackupFile).filter((e): e is BackupEntry => !!e), NOW)
  assert.deepEqual(names(b.daily), [auto("20240101-090000")])
  assert.deepEqual(autoBackupDeletions(old, NOW), [".油记备份-20231201-090000.zip.icloud"])
})

test("恢复前的副本留最近 5 份；恢复列表分组、从新到旧", () => {
  const restores = ["01", "02", "03", "04", "05", "06", "07"].map(d => `恢复前-202610${d}-090000.zip`)
  assert.deepEqual(restoreCopyDeletions(restores), ["恢复前-20261002-090000.zip", "恢复前-20261001-090000.zip"])
  const g = backupGroups([auto("20261025-110000"), "手动备份-20261001-090000.zip", "手动备份-20261010-090000.zip", ...restores.slice(0, 2), "说明.txt"], NOW)
  assert.deepEqual(names(g.daily), [auto("20261025-110000")])
  assert.deepEqual(names(g.manual), ["手动备份-20261010-090000.zip", "手动备份-20261001-090000.zip"])
  assert.deepEqual(names(g.restore), ["恢复前-20261002-090000.zip", "恢复前-20261001-090000.zip"])
})

test("数据的指纹：换当前车辆、点「×」不算变化；记录、别的设置变了算", () => {
  const a = emptyLedger()
  const b = { ...a, settings: { ...a.settings, current_vehicle_id: "v2", dismissed_stops: [1], dismissed_renewals: ["y1"] } }
  assert.equal(ledgerHash(b), ledgerHash(a))
  const c = { ...a, stations: [{ id: "s1", name: "示例站", address: "", province: "", city: "", district: "", lng: 121, lat: 31, last_used_ts: 0 }] }
  assert.notEqual(ledgerHash(c), ledgerHash(a))
  assert.notEqual(ledgerHash({ ...a, settings: { ...a.settings, default_full: false } }), ledgerHash(a))
})

test("要不要自动备份：从没备份过、或数据和上一份不一样", () => {
  assert.equal(needsAutoBackup(null, "h1"), true)
  assert.equal(needsAutoBackup(emptyAutoBackupState(), "h1"), true)
  const last = { ...emptyAutoBackupState(), last_ts: 1, last_hash: "h1", last_name: "x.zip" }
  assert.equal(needsAutoBackup(last, "h2"), true)
  assert.equal(needsAutoBackup(last, "h1"), false)
})

test("zip 里保单原件的份数：insurance/ 下的文件，不算文件夹和 backup.json", () => {
  assert.equal(policyFileCount(["backup.json", "insurance/", "insurance/y1/", "insurance/y1/保单.pdf", "insurance/y1/标志.jpg", "insurance/y2/保单.pdf"]), 3)
})
