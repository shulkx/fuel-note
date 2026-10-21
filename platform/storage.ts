// 数据文件：放在 App Group 目录，小组件也能读到。写入先写临时文件再改名。
import { DEFAULT_EXPENSE_CATEGORIES, defaultSettings, emptyLedger, LedgerFile } from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhState } from "../sync/xxyh/types"
import { StatusSnapshot } from "../common/status_source"

const SNAPSHOT_KEEP = 5

function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/g, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/")
}

/** 数据文件夹名：油记是 FuelNote；设备上的自动检查（tools/check）启动时改成 FuelNoteCheck，读写都不碰真实数据 */
let rootName = "FuelNote"

export function setDataRoot(name: string): void {
  rootName = name
}

export function dataDirectory(): string {
  return joinPath(FileManager.appGroupDocumentsDirectory, rootName)
}

function filePath(name: string): string {
  return joinPath(dataDirectory(), name)
}

const bakPath = (path: string) => `${path}.bak`

/**
 * 写入新内容：先写临时文件；旧文件改名为 .bak；临时文件改名为正式文件；最后删除 .bak。
 * 任何一步中断，正式文件或 .bak 至少有一个是完整的，读取时会从 .bak 恢复。
 */
function writeAtomic(path: string, text: string): void {
  const dir = path.slice(0, path.lastIndexOf("/"))
  FileManager.createDirectorySync(dir, true)
  const tmp = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const bak = bakPath(path)
  FileManager.writeAsStringSync(tmp, text)
  try {
    if (FileManager.existsSync(path)) {
      if (FileManager.existsSync(bak)) FileManager.removeSync(bak)
      FileManager.renameSync(path, bak)
    }
    FileManager.renameSync(tmp, path)
  } catch (error) {
    // 改名失败：尽量恢复旧文件，清掉临时文件
    try { if (!FileManager.existsSync(path) && FileManager.existsSync(bak)) FileManager.renameSync(bak, path) } catch { /* 读取时还会从 .bak 恢复 */ }
    try { if (FileManager.existsSync(tmp)) FileManager.removeSync(tmp) } catch { /* 忽略 */ }
    throw error
  }
  try { FileManager.removeSync(bak) } catch { /* 留着 .bak 也无妨 */ }
}

/** 正式文件不在而 .bak 在：上次写到一半被中断，用 .bak 恢复 */
function recoverIfNeeded(path: string): void {
  const bak = bakPath(path)
  if (!FileManager.existsSync(path) && FileManager.existsSync(bak)) {
    try { FileManager.renameSync(bak, path) } catch { /* 读取时按不存在处理 */ }
  }
}

/** 原文件读不了或版本不对时先备份一份，再用默认值，避免覆盖用户数据 */
function backupBroken(path: string): void {
  try { FileManager.copyFileSync(path, `${path}.broken-${Date.now()}`) } catch { /* 忽略 */ }
}

function readJson<T>(name: string, fallback: () => T, valid: (v: any) => boolean): { value: T; warning?: string } {
  const path = filePath(name)
  recoverIfNeeded(path)
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

/** 小组件读取的摘要（很小的文件；小组件不解析整份账本和云备份） */
export function saveWidgetFile(text: string): void {
  writeAtomic(filePath("widget.json"), text)
}

/** 缓存文件（行程、附近油站）：读不了就当没有，不提示 */
export function readCache<T>(name: string): T | null {
  const path = filePath(name)
  try {
    recoverIfNeeded(path)
    return FileManager.existsSync(path) ? (JSON.parse(FileManager.readAsStringSync(path)) as T) : null
  } catch {
    return null
  }
}

export function writeCache(name: string, value: unknown): void {
  writeAtomic(filePath(name), JSON.stringify(value))
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

export function writeExport(name: string, text: string): string {
  const path = joinPath(FileManager.documentsDirectory, rootName, name)
  writeAtomic(path, text)
  return path
}

// ---------- 保单原件（设计文档 20.4 节）：FuelNote/insurance/<保险年度 id>/，不进备份 ----------

const POLICY_DIR = "insurance"

/** 这一年的文件夹里一个没用过的文件名（重名时加序号） */
function policyTarget(yearId: string, name: string): { path: string; rel: string } {
  const dir = joinPath(dataDirectory(), POLICY_DIR, yearId)
  FileManager.createDirectorySync(dir, true)
  const safe = name.replace(/[/\\:*?"<>|]/g, "_") || "保单.pdf"
  const dot = safe.lastIndexOf(".")
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ".pdf"
  let file = safe
  for (let n = 2; FileManager.existsSync(joinPath(dir, file)); n++) file = `${base} (${n})${ext}`
  return { path: joinPath(dir, file), rel: `${POLICY_DIR}/${yearId}/${file}` }
}

/** 把选的 PDF、图片复制进来，返回相对路径（insurance/<id>/<文件名>）；重名时加序号 */
export function savePolicyFile(yearId: string, srcPath: string, name: string): string {
  const t = policyTarget(yearId, name)
  FileManager.copyFileSync(srcPath, t.path)
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
    if (FileManager.existsSync(path)) FileManager.removeSync(path)
  } catch { /* 忽略 */ }
}

/** 删掉一年的全部原件（删除这一年的保险时） */
export function removePolicyFiles(yearId: string): void {
  try {
    const dir = joinPath(dataDirectory(), POLICY_DIR, yearId)
    if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
  } catch { /* 忽略 */ }
}
