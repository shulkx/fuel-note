// 数据文件的读写规则（common/files.ts）：用内存里的文件系统，写到一半失败、坏文件、副本数量、缓存位置
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  COPIES_KEEP, Fs, joinPath, LEDGER_FILE, LEGACY_CACHE_FILES, LEGACY_LEDGER_FILE, pruneCopies, readCacheFile, readJson, readLedgerFile, readLedgerOrLegacy,
  removeLegacyCaches, writeAtomic,
} from "../common/files"

type MemoryFs = Fs & { files: Map<string, string>; failRename: ((from: string, to: string) => boolean) | null }

function memoryFs(): MemoryFs {
  const files = new Map<string, string>()
  const fs: MemoryFs = {
    files,
    failRename: null,
    exists: p => files.has(p) || [...files.keys()].some(k => k.startsWith(`${p}/`)),
    readText: p => {
      const t = files.get(p)
      if (t == null) throw new Error(`没有 ${p}`)
      return t
    },
    writeText: (p, t) => { files.set(p, t) },
    rename: (a, b) => {
      if (fs.failRename && fs.failRename(a, b)) throw new Error("改名失败")
      const t = files.get(a)
      if (t == null) throw new Error(`没有 ${a}`)
      files.delete(a)
      files.set(b, t)
    },
    copy: (a, b) => { files.set(b, fs.readText(a)) },
    remove: p => { for (const k of [...files.keys()]) if (k === p || k.startsWith(`${p}/`)) files.delete(k) },
    list: d => [...new Set([...files.keys()].filter(k => k.startsWith(`${d}/`)).map(k => k.slice(d.length + 1).split("/")[0]))],
    mkdir: () => undefined,
  }
  return fs
}

const DIR = "/group/FuelNote"
const LEDGER = joinPath(DIR, "ledger.json")

test("写入：覆盖旧文件后不留 .bak 和临时文件", () => {
  const fs = memoryFs()
  writeAtomic(fs, LEDGER, "一")
  writeAtomic(fs, LEDGER, "二")
  assert.equal(fs.files.get(LEDGER), "二")
  assert.deepEqual([...fs.files.keys()], [LEDGER])
})

test("写入时改名失败：原文件还在，临时文件清掉，错误照样抛出", () => {
  const fs = memoryFs()
  writeAtomic(fs, LEDGER, "旧")
  fs.failRename = (from, to) => from.endsWith(".tmp") && to === LEDGER
  assert.throws(() => writeAtomic(fs, LEDGER, "新"), /改名失败/)
  assert.equal(fs.files.get(LEDGER), "旧")
  assert.deepEqual([...fs.files.keys()], [LEDGER])
})

test("上次写到一半中断（只剩 .bak）：读取时用 .bak 恢复", () => {
  const fs = memoryFs()
  fs.files.set(`${LEDGER}.bak`, JSON.stringify({ ok: 1 }))
  assert.deepEqual(readJson(fs, LEDGER, () => ({ ok: 0 }), v => v && v.ok === 1).value, { ok: 1 })
  assert.equal(fs.files.has(LEDGER), true)
  assert.equal(fs.files.has(`${LEDGER}.bak`), false)
})

test("读不了或格式不对：另存一份坏文件、用默认值并提示；坏文件只留最近几份", () => {
  const fs = memoryFs()
  for (let i = 0; i < 7; i++) fs.files.set(`${LEDGER}.broken-${1000 + i}`, "旧的坏文件")
  fs.files.set(LEDGER, "{不是 JSON")
  const r = readJson(fs, LEDGER, () => ({ ok: 0 }), () => true)
  assert.deepEqual(r.value, { ok: 0 })
  assert.match(r.warning!, /ledger\.json 读取失败/)
  assert.equal(fs.files.get(LEDGER), "{不是 JSON", "原文件不动，下次保存才覆盖")
  const broken = fs.list(DIR).filter(n => n.startsWith("ledger.json.broken-"))
  assert.equal(broken.length, COPIES_KEEP)
  assert.ok(!broken.includes("ledger.json.broken-1000"), "删掉最旧的")
  fs.files.set(LEDGER, JSON.stringify({ schema_version: 9 }))
  assert.match(readJson(fs, LEDGER, () => ({}), v => v.schema_version === 1).warning!, /格式无法识别/)
})

test("2.0 的账本：补齐列表和设置；油站搜索只剩开关；去掉不再用的设置项；不认识的字段原样保留", () => {
  const fs = memoryFs()
  const path = joinPath(DIR, LEDGER_FILE)
  fs.files.set(path, JSON.stringify({
    schema_version: 2, vehicles: [], records: [], future_field: { keep: true },
    settings: { station_search: "amap", insurance_marks_checked: true, xxyh_auto_upload: true },
  }))
  const { ledger, warning } = readLedgerFile(fs, path)
  assert.equal(warning, undefined)
  assert.deepEqual([ledger.stations, ledger.insurance, ledger.stores, ledger.perks, ledger.perk_uses], [[], [], [], [], []])
  assert.equal(ledger.expense_categories.length, 4)
  assert.equal(ledger.settings.station_search, "auto")
  assert.equal(ledger.settings.default_full, true)
  assert.equal("insurance_marks_checked" in ledger.settings, false)
  assert.equal("xxyh_auto_upload" in ledger.settings, false)
  assert.deepEqual((ledger as unknown as Record<string, unknown>).future_field, { keep: true })
  fs.files.set(path, JSON.stringify({ schema_version: 2, vehicles: [], records: [], settings: { station_search: "off" } }))
  assert.equal(readLedgerFile(fs, path).ledger.settings.station_search, "off")
  // 1.x 的格式不当作 2.0 读
  fs.files.set(path, JSON.stringify({ schema_version: 1, vehicles: [], records: [] }))
  assert.match(readLedgerFile(fs, path).warning!, /格式无法识别/)
})

test("只有 1.x 的账本（ledger.json）：不读也不改，标为旧数据；有 2.0 的账本时读它；都没有时是空账本", () => {
  const fs = memoryFs()
  assert.deepEqual([readLedgerOrLegacy(fs, DIR).legacy, readLedgerOrLegacy(fs, DIR).ledger.vehicles], [false, []])
  const old = JSON.stringify({ schema_version: 1, vehicles: [{ id: "v1" }], records: [] })
  fs.files.set(joinPath(DIR, LEGACY_LEDGER_FILE), old)
  const legacy = readLedgerOrLegacy(fs, DIR)
  assert.equal(legacy.legacy, true)
  assert.deepEqual(legacy.ledger.vehicles, [])
  assert.equal(fs.files.get(joinPath(DIR, LEGACY_LEDGER_FILE)), old, "旧文件不动")
  assert.equal(fs.files.has(joinPath(DIR, LEDGER_FILE)), false)
  fs.files.set(joinPath(DIR, LEDGER_FILE), JSON.stringify({ schema_version: 2, vehicles: [{ id: "v2" }], records: [] }))
  const now = readLedgerOrLegacy(fs, DIR)
  assert.equal(now.legacy, false)
  assert.deepEqual(now.ledger.vehicles.map(v => v.id), ["v2"])
})

test("缓存：读不了就当没有", () => {
  const fs = memoryFs()
  const path = joinPath(DIR, "cache", "poi_cache.json")
  assert.equal(readCacheFile(fs, path), null)
  fs.files.set(path, "坏的")
  assert.equal(readCacheFile(fs, path), null)
  fs.files.set(path, JSON.stringify({ a: 1 }))
  assert.deepEqual(readCacheFile(fs, path), { a: 1 })
})

test("副本按名字里的时间只留最近几份；别的文件不动", () => {
  const fs = memoryFs()
  const docs = "/docs/FuelNote"
  for (const d of ["20261001-0900", "20261002-0900", "20261003-0900", "20261004-0900", "20261005-0900", "20261006-0900", "20261007-0900"]) {
    fs.files.set(joinPath(docs, `fuelnote-before-restore-${d}.json`), "{}")
  }
  fs.files.set(joinPath(docs, "fuelnote-backup-20260101-0900.json"), "{}")
  pruneCopies(fs, docs, "fuelnote-before-restore-")
  const left = fs.list(docs).sort()
  assert.deepEqual(left, [
    "fuelnote-backup-20260101-0900.json",
    "fuelnote-before-restore-20261003-0900.json", "fuelnote-before-restore-20261004-0900.json", "fuelnote-before-restore-20261005-0900.json",
    "fuelnote-before-restore-20261006-0900.json", "fuelnote-before-restore-20261007-0900.json",
  ])
})

test("2.0 之前放在数据文件夹根上的缓存被删掉；cache/ 里的和账本不动", () => {
  const fs = memoryFs()
  for (const name of LEGACY_CACHE_FILES) fs.files.set(joinPath(DIR, name), "{}")
  fs.files.set(joinPath(DIR, "cache", "trips_cache.json"), "{}")
  fs.files.set(LEDGER, "{}")
  removeLegacyCaches(fs, DIR)
  assert.deepEqual([...fs.files.keys()].sort(), [joinPath(DIR, "cache", "trips_cache.json"), LEDGER])
})
