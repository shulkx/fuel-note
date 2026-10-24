// 数据文件的读写规则（纯逻辑）：先写临时文件再改名、读取时从 .bak 恢复、读不了时另存一份坏文件再用默认值、副本只留最近几份。
// 文件系统由调用方注入：platform/storage.ts 用 Scripting 的 FileManager，Node 测试用内存里的实现。
import { DEFAULT_EXPENSE_CATEGORIES, defaultSettings, emptyLedger, LedgerFile, Settings } from "./types"

/** 用到的文件操作（都是同步的）。list 返回文件夹里的名字，有的实现会带路径，按最后一段取 */
export type Fs = {
  exists(path: string): boolean
  readText(path: string): string
  writeText(path: string, text: string): void
  rename(from: string, to: string): void
  copy(from: string, to: string): void
  remove(path: string): void
  list(dir: string): string[]
  /** 连同上级文件夹一起建 */
  mkdir(dir: string): void
}

/** 坏文件、恢复前副本这类留底的文件，各留最近几份 */
export const COPIES_KEEP = 5

/** 缓存的文件夹：都能重新读，不进备份 */
export const CACHE_DIR = "cache"

/** 2.0 之前放在数据文件夹根上的缓存，打开时删掉 */
export const LEGACY_CACHE_FILES = [
  "catalog_cache.json", "poi_cache.json", "trips_cache.json", "status_cache.json", "widget_status_lock.json", "widget_status_log.json",
]

export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/g, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/")
}

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"))
const baseName = (path: string) => path.split("/").pop() || ""
const bakPath = (path: string) => `${path}.bak`

/**
 * 写入新内容：先写临时文件；旧文件改名为 .bak；临时文件改名为正式文件；最后删除 .bak。
 * 任何一步中断，正式文件或 .bak 至少有一个是完整的，读取时会从 .bak 恢复。
 */
export function writeAtomic(fs: Fs, path: string, text: string): void {
  fs.mkdir(dirOf(path))
  const tmp = `${path}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  const bak = bakPath(path)
  fs.writeText(tmp, text)
  try {
    if (fs.exists(path)) {
      if (fs.exists(bak)) fs.remove(bak)
      fs.rename(path, bak)
    }
    fs.rename(tmp, path)
  } catch (error) {
    // 改名失败：尽量恢复旧文件，清掉临时文件
    try { if (!fs.exists(path) && fs.exists(bak)) fs.rename(bak, path) } catch { /* 读取时还会从 .bak 恢复 */ }
    try { if (fs.exists(tmp)) fs.remove(tmp) } catch { /* 忽略 */ }
    throw error
  }
  try { fs.remove(bak) } catch { /* 留着 .bak 也无妨 */ }
}

/** 正式文件不在而 .bak 在：上次写到一半被中断，用 .bak 恢复 */
export function recoverIfNeeded(fs: Fs, path: string): void {
  const bak = bakPath(path)
  if (!fs.exists(path) && fs.exists(bak)) {
    try { fs.rename(bak, path) } catch { /* 读取时按不存在处理 */ }
  }
}

/** 文件夹里以 prefix 开头的文件按名字倒序（名字里带时间，新的在前），留前 keep 个，其余删掉 */
export function pruneCopies(fs: Fs, dir: string, prefix: string, keep = COPIES_KEEP): void {
  try {
    const names = fs.list(dir).map(baseName).filter(n => n.startsWith(prefix)).sort().reverse()
    for (const n of names.slice(keep)) fs.remove(joinPath(dir, n))
  } catch { /* 清理失败不影响使用 */ }
}

/** 原文件读不了或版本不对时先另存一份，再用默认值，避免覆盖用户数据；这样的副本只留最近几份 */
function backupBroken(fs: Fs, path: string): void {
  try { fs.copy(path, `${path}.broken-${Date.now()}`) } catch { /* 忽略 */ }
  pruneCopies(fs, dirOf(path), `${baseName(path)}.broken-`)
}

export function readJson<T>(fs: Fs, path: string, fallback: () => T, valid: (v: any) => boolean): { value: T; warning?: string } {
  const name = baseName(path)
  recoverIfNeeded(fs, path)
  if (!fs.exists(path)) return { value: fallback() }
  try {
    const v = JSON.parse(fs.readText(path))
    if (valid(v)) return { value: v as T }
    backupBroken(fs, path)
    return { value: fallback(), warning: `${name} 的格式无法识别，已备份原文件并重新开始。` }
  } catch {
    backupBroken(fs, path)
    return { value: fallback(), warning: `${name} 读取失败，已备份原文件并重新开始。` }
  }
}

/** 缓存：读不了就当没有，不提示 */
export function readCacheFile<T>(fs: Fs, path: string): T | null {
  try {
    recoverIfNeeded(fs, path)
    return fs.exists(path) ? (JSON.parse(fs.readText(path)) as T) : null
  } catch {
    return null
  }
}

/** 读账本并补齐后加的字段 */
export function readLedgerFile(fs: Fs, path: string): { ledger: LedgerFile; warning?: string } {
  const { value, warning } = readJson<LedgerFile>(fs, path, emptyLedger, v => v && v.schema_version === 1 && Array.isArray(v.vehicles))
  value.records = Array.isArray(value.records) ? value.records : []
  value.stations = Array.isArray(value.stations) ? value.stations : []
  value.expense_categories = Array.isArray(value.expense_categories) && value.expense_categories.length
    ? value.expense_categories
    : DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c }))
  value.settings = { ...defaultSettings(), ...(value.settings || {}) }
  // 2.0：油站搜索只剩开关；交强险标志的旧迁移已删
  if (value.settings.station_search !== "off") value.settings.station_search = "auto"
  delete (value.settings as Settings & { insurance_marks_checked?: boolean }).insurance_marks_checked
  return { ledger: value, warning }
}

/** 删掉 2.0 之前放在数据文件夹根上的缓存 */
export function removeLegacyCaches(fs: Fs, dataDir: string): void {
  for (const name of LEGACY_CACHE_FILES) {
    const path = joinPath(dataDir, name)
    try { if (fs.exists(path)) fs.remove(path) } catch { /* 下次再删 */ }
  }
}
