// 备份的纯规则（2.0 设计第 6 节）：文件名、要不要自动备份、留哪几份、恢复列表怎么分组、zip 里有几份保单原件。
// 只有一种备份，都放在「油记备份」：自动备份（改了数据就写）、立即备份（手动，不自动删）、恢复前另存的那一份。
// 自动备份按日历分层留存：最近 7 天每天最后一份，再往前 4 周每周最后一份，再往前 12 个月每月最后一份，最新的一份总留着。
// 写 zip、读 zip、放在哪里在 app/backup.ts；这里不碰文件。
import { md5 } from "./hash"
import { LedgerFile } from "./types"

/** 文件名前缀：自动备份、立即备份、恢复前 */
export const BACKUP_PREFIX = "油记备份-"
export const MANUAL_PREFIX = "手动备份-"
export const RESTORE_PREFIX = "恢复前-"
/** 恢复前的副本留几份 */
export const RESTORE_KEEP = 5
/** 保存后等多久没有新的修改再备份 */
export const AUTO_DELAY = 60e3
/** zip 里的数据文件和保单原件的文件夹 */
export const BACKUP_JSON = "backup.json"
export const POLICY_FOLDER = "insurance"

const pad = (n: number) => String(n).padStart(2, "0")

/** 文件名里的时间（设备时区）：20261024-213015 */
export function backupStamp(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 「油记备份-20261024-213015.zip」「手动备份-…」「恢复前-…」 */
export function backupName(prefix: string, ms: number): string {
  return `${prefix}${backupStamp(ms)}.zip`
}

export type BackupKind = "auto" | "manual" | "restore"

/** 文件夹里的一份备份。iCloud 里还没下载到手机的是「.<名字>.icloud」的占位文件，name 是去掉占位写法后的名字 */
export type BackupEntry = {
  /** 文件夹里实际的文件名（占位文件是「.<name>.icloud」） */
  file: string
  name: string
  kind: BackupKind
  /** 名字里的时间（设备时区的年月日时分秒） */
  y: number; mo: number; d: number; h: number; mi: number; s: number
  downloaded: boolean
}

const PREFIX_KIND: Array<[string, BackupKind]> = [[BACKUP_PREFIX, "auto"], [MANUAL_PREFIX, "manual"], [RESTORE_PREFIX, "restore"]]

/** 认出备份文件：名字不对的返回 null */
export function parseBackupFile(file: string): BackupEntry | null {
  const placeholder = /^\.(.+)\.icloud$/.exec(file)
  const name = placeholder ? placeholder[1] : file
  for (const [prefix, kind] of PREFIX_KIND) {
    if (!name.startsWith(prefix)) continue
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/.exec(name.slice(prefix.length))
    if (!m) return null
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number)
    return { file, name, kind, y, mo, d, h, mi, s, downloaded: !placeholder }
  }
  return null
}

/** 名字里的时间（设备时区）的毫秒数 */
export const backupTime = (e: BackupEntry): number => new Date(e.y, e.mo - 1, e.d, e.h, e.mi, e.s).getTime()

/** 用来排序和比较的时间值（按名字里的数字，不换算时区） */
const order = (e: BackupEntry) => ((((e.y * 100 + e.mo) * 100 + e.d) * 100 + e.h) * 100 + e.mi) * 100 + e.s
/** 日期离今天几天（只看年月日） */
const ageDays = (e: BackupEntry, today: Date) =>
  Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(e.y, e.mo - 1, e.d)) / 86400e3)
/** ISO 周（周一开始）：「2026-43」 */
function isoWeek(e: BackupEntry): string {
  const t = new Date(Date.UTC(e.y, e.mo - 1, e.d))
  const day = (t.getUTCDay() + 6) % 7
  t.setUTCDate(t.getUTCDate() - day + 3)
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4))
  const week = 1 + Math.round(((t.getTime() - first.getTime()) / 86400e3 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)
  return `${t.getUTCFullYear()}-${week}`
}

export type AutoBuckets = { daily: BackupEntry[]; weekly: BackupEntry[]; monthly: BackupEntry[] }

/**
 * 自动备份按日历分层，每层每个时段留最后一份（从新到旧）：最近 7 天每天、再往前 4 周每周（ISO 周）、再往前 12 个月每月。
 * 最新的一份总留着：哪一层都不在时放进它所在的那一层
 */
export function autoBuckets(entries: BackupEntry[], now: number): AutoBuckets {
  const today = new Date(now)
  const autos = entries.filter(e => e.kind === "auto").sort((a, b) => order(b) - order(a))
  const daily = new Map<string, BackupEntry>()
  const weekly = new Map<string, BackupEntry>()
  const monthly = new Map<string, BackupEntry>()
  const months = (e: BackupEntry) => (today.getFullYear() - e.y) * 12 + today.getMonth() + 1 - e.mo
  for (const e of autos) {
    const age = ageDays(e, today)
    if (age < 7) {
      if (!daily.has(`${e.y}-${e.mo}-${e.d}`)) daily.set(`${e.y}-${e.mo}-${e.d}`, e)
    } else if (age < 7 + 28) {
      if (!weekly.has(isoWeek(e)) && weekly.size < 4) weekly.set(isoWeek(e), e)
    } else if (months(e) <= 12) {
      if (!monthly.has(`${e.y}-${e.mo}`) && monthly.size < 12) monthly.set(`${e.y}-${e.mo}`, e)
    }
  }
  const out = { daily: [...daily.values()], weekly: [...weekly.values()], monthly: [...monthly.values()] }
  const newest = autos[0]
  if (newest && ![...out.daily, ...out.weekly, ...out.monthly].includes(newest)) out.daily.unshift(newest)
  return out
}

/** 写好一份新的自动备份以后要删的自动备份（文件夹里实际的文件名）：不在分层留存里的 */
export function autoBackupDeletions(files: string[], now: number): string[] {
  const entries = files.map(parseBackupFile).filter((e): e is BackupEntry => !!e)
  const b = autoBuckets(entries, now)
  const kept = new Set([...b.daily, ...b.weekly, ...b.monthly].map(e => e.file))
  return entries.filter(e => e.kind === "auto" && !kept.has(e.file)).map(e => e.file)
}

/** 恢复前的副本按时间留最近 keep 份，返回要删的文件名 */
export function restoreCopyDeletions(files: string[], keep = RESTORE_KEEP): string[] {
  return files.map(parseBackupFile).filter((e): e is BackupEntry => !!e && e.kind === "restore")
    .sort((a, b) => order(b) - order(a)).slice(keep).map(e => e.file)
}

/** 恢复列表：自动备份按分层分组，立即备份、恢复前各一组，都从新到旧 */
export function backupGroups(files: string[], now: number): AutoBuckets & { manual: BackupEntry[]; restore: BackupEntry[] } {
  const entries = files.map(parseBackupFile).filter((e): e is BackupEntry => !!e)
  const byNew = (list: BackupEntry[]) => list.sort((a, b) => order(b) - order(a))
  return {
    ...autoBuckets(entries, now),
    manual: byNew(entries.filter(e => e.kind === "manual")),
    restore: byNew(entries.filter(e => e.kind === "restore")),
  }
}

/** 上一次自动备份（存在数据文件夹的 auto_backup.json，不进备份） */
export type AutoBackupState = {
  schema_version: 1
  /** 上次成功的时间和那时数据的指纹；没备份过为 0 和 "" */
  last_ts: number
  last_hash: string
  last_name: string
  /** 上次写在 iCloud 云盘（false：没开 iCloud，写在本机的文稿目录） */
  icloud: boolean
  /** 上次失败的原因和时间；成功后清掉 */
  last_error: string | null
  error_ts: number | null
}

export const emptyAutoBackupState = (): AutoBackupState =>
  ({ schema_version: 1, last_ts: 0, last_hash: "", last_name: "", icloud: false, last_error: null, error_ts: null })

/** 数据的指纹：不算当前车辆、点过「×」的提醒这类界面状态（它们变了不用再备份一份） */
export function ledgerHash(ledger: LedgerFile): string {
  const { current_vehicle_id: _c, dismissed_stops: _s, dismissed_renewals: _r, ...settings } = ledger.settings
  return md5(JSON.stringify({ ...ledger, settings }))
}

/** 要不要自动备份：数据和上一份备份时不一样（从没备份过也算） */
export function needsAutoBackup(state: AutoBackupState | null, hash: string): boolean {
  return !state || !state.last_ts || hash !== state.last_hash
}

/** zip 里保单原件的份数：insurance/ 下的文件（不算文件夹） */
export function policyFileCount(paths: string[]): number {
  return paths.filter(p => p.startsWith(`${POLICY_FOLDER}/`) && !p.endsWith("/")).length
}
