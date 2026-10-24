// 数据文件：放在 App Group 目录，小组件也能读到。读写规则（先写临时文件再改名、坏文件另存、副本只留几份）在 common/files.ts。
import {
  CACHE_DIR, Fs, joinPath, LEDGER_FILE, readCacheFile, readJson, readLedgerFile,
  writeAtomic, XXYH_FILE,
} from "../common/files"
import { AutoBackupState, emptyAutoBackupState } from "../common/backup_plan"
import { LedgerFile } from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhState } from "../sync/xxyh/types"
import { StatusSnapshot } from "../common/status_source"

const SNAPSHOT_KEEP = 5
const AUTO_BACKUP_FILE = "auto_backup.json"

const fs: Fs = {
  exists: p => FileManager.existsSync(p),
  readText: p => FileManager.readAsStringSync(p),
  writeText: (p, t) => FileManager.writeAsStringSync(p, t),
  rename: (a, b) => FileManager.renameSync(a, b),
  copy: (a, b) => FileManager.copyFileSync(a, b),
  remove: p => FileManager.removeSync(p),
  list: d => FileManager.readDirectorySync(d),
  mkdir: d => FileManager.createDirectorySync(d, true),
}

/** 数据文件夹名：油记是 FuelNote；设备上的自动检查（tools/check）启动时改成 FuelNoteCheck，读写都不碰真实数据 */
let rootName = "FuelNote"

export function setDataRoot(name: string): void {
  rootName = name
}

/** 是不是油记自己的数据文件夹（自动检查的文件夹里不自动备份） */
export const isMainDataRoot = () => rootName === "FuelNote"

export function dataDirectory(): string {
  return joinPath(FileManager.appGroupDocumentsDirectory, rootName)
}

function filePath(name: string): string {
  return joinPath(dataDirectory(), name)
}

/** 读账本；没有文件时是空账本 */
export function readLedger(): { ledger: LedgerFile; warning?: string } {
  return readLedgerFile(fs, filePath(LEDGER_FILE))
}

export function saveLedger(ledger: LedgerFile): void {
  writeAtomic(fs, filePath(LEDGER_FILE), JSON.stringify(ledger))
}

export function readXxyhState(): { state: XxyhState; warning?: string } {
  const { value, warning } = readJson<XxyhState>(fs, filePath(XXYH_FILE), emptyXxyhState, v => v && v.schema_version === 2)
  return { state: { ...emptyXxyhState(), ...value }, warning }
}

export function saveXxyhState(state: XxyhState): void {
  writeAtomic(fs, filePath(XXYH_FILE), JSON.stringify(state))
}

/** 保存下载或上传过的小熊版本，只留最近几个（按版本号，不按名字排） */
export function saveSnapshot(version: number, doc: XxyhBackup): void {
  const dir = filePath("xxyh_snapshots")
  writeAtomic(fs, joinPath(dir, `v${version}.json`), JSON.stringify(doc))
  try {
    const versions = fs.list(dir)
      .map(name => /^v(\d+)\.json$/.exec(name.split("/").pop() || ""))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => Number(m[1]))
      .sort((a, b) => b - a)
    for (const v of versions.slice(SNAPSHOT_KEEP)) fs.remove(joinPath(dir, `v${v}.json`))
  } catch { /* 清理失败不影响使用 */ }
}

/** 最近一份小熊快照（版本最大的）；没有时 null */
export function readLatestSnapshot(): { version: number; doc: XxyhBackup } | null {
  const dir = filePath("xxyh_snapshots")
  try {
    const versions = fs.list(dir)
      .map(name => /^v(\d+)\.json$/.exec(name.split("/").pop() || ""))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => Number(m[1]))
      .sort((a, b) => b - a)
    if (!versions.length) return null
    return { version: versions[0], doc: JSON.parse(fs.readText(joinPath(dir, `v${versions[0]}.json`))) as XxyhBackup }
  } catch {
    return null
  }
}

/** 小组件读取的摘要（很小的文件；小组件不解析整份账本和云备份） */
export function saveWidgetFile(text: string): void {
  writeAtomic(fs, filePath("widget.json"), text)
}

/** 缓存文件（行程、附近油站、车型库、车况）：放在 cache/，读不了就当没有，不提示 */
export function readCache<T>(name: string): T | null {
  return readCacheFile<T>(fs, filePath(joinPath(CACHE_DIR, name)))
}

export function writeCache(name: string, value: unknown): void {
  writeAtomic(fs, filePath(joinPath(CACHE_DIR, name)), JSON.stringify(value))
}

/** 车况缓存（设计文档 18.1 节）：油记和小组件共用 */
const STATUS_CACHE_FILE = "status_cache.json"

export function readStatusCache(): Record<string, StatusSnapshot> {
  const f = readCache<{ schema_version: 1; entries: Record<string, StatusSnapshot> }>(STATUS_CACHE_FILE)
  return f && f.schema_version === 1 && f.entries ? f.entries : {}
}

export function saveStatusSnapshot(snap: StatusSnapshot): void {
  writeCache(STATUS_CACHE_FILE, { schema_version: 1, entries: { ...readStatusCache(), [snap.key]: snap } })
}

// ---------- 备份文件夹（2.0 设计第 6 节） ----------

/**
 * 备份放在哪：开了 iCloud 时是 iCloud 云盘的「油记备份」（「文件」App › iCloud 云盘 › Scripting），没开时是本机文稿目录的「油记备份」。
 * 自动检查的数据文件夹里用它自己的 backups/，不碰 iCloud
 */
export function backupDirectory(): { dir: string; icloud: boolean } {
  if (!isMainDataRoot()) return { dir: joinPath(dataDirectory(), "backups"), icloud: false }
  const icloud = FileManager.isiCloudEnabled
  const base = icloud ? FileManager.iCloudDocumentsDirectory : FileManager.documentsDirectory
  return { dir: joinPath(base, "油记备份"), icloud }
}

/** 文件夹里的文件名（iCloud 里还没下载的是「.<名字>.icloud」）；文件夹不在时为空 */
export function listBackupNames(dir: string): string[] {
  try {
    return fs.exists(dir) ? fs.list(dir).map(p => p.split("/").pop() || p) : []
  } catch {
    return []
  }
}

export function readAutoBackupState(): AutoBackupState {
  const { value } = readJson<AutoBackupState>(fs, filePath(AUTO_BACKUP_FILE), emptyAutoBackupState, v => v && v.schema_version === 1)
  return { ...emptyAutoBackupState(), ...value }
}

export function saveAutoBackupState(state: AutoBackupState): void {
  writeAtomic(fs, filePath(AUTO_BACKUP_FILE), JSON.stringify(state))
}

// ---------- 保单原件（设计文档 20.4 节）：FuelNote/insurance/<保险年度 id>/，不进备份 ----------

const POLICY_DIR = "insurance"

/** 这一年的文件夹里一个没用过的文件名（重名时加序号） */
function policyTarget(yearId: string, name: string): { path: string; rel: string } {
  const dir = joinPath(dataDirectory(), POLICY_DIR, yearId)
  fs.mkdir(dir)
  const safe = name.replace(/[/\\:*?"<>|]/g, "_") || "保单.pdf"
  const dot = safe.lastIndexOf(".")
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ".pdf"
  let file = safe
  for (let n = 2; fs.exists(joinPath(dir, file)); n++) file = `${base} (${n})${ext}`
  return { path: joinPath(dir, file), rel: `${POLICY_DIR}/${yearId}/${file}` }
}

/** 保单原件的文件夹（备份时整个打包，恢复时整个替换） */
export function policyDirectory(): string {
  return joinPath(dataDirectory(), POLICY_DIR)
}

/** 把选的 PDF、图片复制进来，返回相对路径（insurance/<id>/<文件名>）；重名时加序号 */
export function savePolicyFile(yearId: string, srcPath: string, name: string): string {
  const t = policyTarget(yearId, name)
  fs.copy(srcPath, t.path)
  return t.rel
}

/** 写一份新文件（从交强险保单里拆出来的标志页），返回相对路径 */
export function savePolicyData(yearId: string, data: Data, name: string): string {
  const t = policyTarget(yearId, name)
  FileManager.writeAsDataSync(t.path, data)
  return t.rel
}

export function policyFilePath(rel: string): string {
  return joinPath(dataDirectory(), ...rel.split("/"))
}

/** 删一份原件（编辑时换掉或去掉的保单）；删不掉不影响数据 */
export function removePolicyFile(rel: string): void {
  try {
    const path = policyFilePath(rel)
    if (fs.exists(path)) fs.remove(path)
  } catch { /* 忽略 */ }
}

/** 删掉一年的全部原件（删除这一年的保险时） */
export function removePolicyFiles(yearId: string): void {
  try {
    const dir = joinPath(dataDirectory(), POLICY_DIR, yearId)
    if (fs.exists(dir)) fs.remove(dir)
  } catch { /* 忽略 */ }
}
