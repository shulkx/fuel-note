// 数据文件：放在 App Group 目录，小组件也能读到。写入先写临时文件再改名。
import { DEFAULT_EXPENSE_CATEGORIES, defaultSettings, emptyLedger, LedgerFile } from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhState } from "../sync/xxyh/types"

const SNAPSHOT_KEEP = 5

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/g, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/")
}

export function dataDirectory(): string {
  return joinPath(FileManager.appGroupDocumentsDirectory, "CarLedger")
}

function filePath(name: string): string {
  return joinPath(dataDirectory(), name)
}

function writeAtomic(path: string, text: string): void {
  const dir = path.slice(0, path.lastIndexOf("/"))
  FileManager.createDirectorySync(dir, true)
  const tmp = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  FileManager.writeAsStringSync(tmp, text)
  try {
    FileManager.renameSync(tmp, path)
  } catch {
    if (FileManager.existsSync(path)) FileManager.removeSync(path)
    FileManager.renameSync(tmp, path)
  }
}

/** 原文件读不了或版本不对时先备份一份，再用默认值，避免覆盖用户数据 */
function backupBroken(path: string): void {
  try { FileManager.copyFileSync(path, `${path}.broken-${Date.now()}`) } catch { /* 忽略 */ }
}

function readJson<T>(name: string, fallback: () => T, valid: (v: any) => boolean): { value: T; warning?: string } {
  const path = filePath(name)
  if (!FileManager.existsSync(path)) return { value: fallback() }
  try {
    const v = JSON.parse(FileManager.readAsStringSync(path))
    if (valid(v)) return { value: v as T }
    backupBroken(path)
    return { value: fallback(), warning: `${name} 的格式无法识别，已备份原文件并重新开始。` }
  } catch {
    backupBroken(path)
    return { value: fallback(), warning: `${name} 读取失败，已备份原文件并重新开始。` }
  }
}

export function readLedger(): { ledger: LedgerFile; warning?: string } {
  const { value, warning } = readJson<LedgerFile>("ledger.json", emptyLedger, v => v && v.schema_version === 1 && Array.isArray(v.vehicles))
  // 补齐后加的字段
  value.records = Array.isArray(value.records) ? value.records : []
  value.stations = Array.isArray(value.stations) ? value.stations : []
  value.expense_categories = Array.isArray(value.expense_categories) && value.expense_categories.length
    ? value.expense_categories
    : DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c }))
  value.settings = { ...defaultSettings(), ...(value.settings || {}) }
  return { ledger: value, warning }
}

export function saveLedger(ledger: LedgerFile): void {
  writeAtomic(filePath("ledger.json"), JSON.stringify(ledger))
}

export function readXxyhState(): { state: XxyhState; warning?: string } {
  const { value, warning } = readJson<XxyhState>("xxyh.json", emptyXxyhState, v => v && v.schema_version === 1 && Array.isArray(v.ops))
  return { state: { ...emptyXxyhState(), ...value }, warning }
}

export function saveXxyhState(state: XxyhState): void {
  writeAtomic(filePath("xxyh.json"), JSON.stringify(state))
}

/** 保存下载或上传过的小熊版本，只留最近几个 */
export function saveSnapshot(version: number, doc: XxyhBackup): void {
  const dir = filePath("xxyh_snapshots")
  writeAtomic(joinPath(dir, `v${version}.json`), JSON.stringify(doc))
  try {
    const versions = FileManager.readDirectorySync(dir)
      .map(name => /^v(\d+)\.json$/.exec(name.split("/").pop() || ""))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => Number(m[1]))
      .sort((a, b) => b - a)
    for (const v of versions.slice(SNAPSHOT_KEEP)) FileManager.removeSync(joinPath(dir, `v${v}.json`))
  } catch { /* 清理失败不影响使用 */ }
}

export function writeExport(name: string, text: string): string {
  const path = joinPath(FileManager.documentsDirectory, "CarLedger", name)
  writeAtomic(path, text)
  return path
}
