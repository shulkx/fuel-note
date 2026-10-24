// 备份的纯规则（2.0 设计第 6 节）：文件名、要不要自动备份、留哪几份、zip 里有几份保单原件。
// 自动备份的时机（用户 2026-10-24）：改了数据就备份——保存后 1 分钟内没有新的修改、离开油记、打开时补上次没写完的；同一天只留最新的一份，留最近 10 天。
// 写 zip、读 zip、放在哪里在 app/backup.ts；这里不碰文件。
import { md5 } from "./hash"
import { LedgerFile } from "./types"

/** 手动和自动备份的文件名前缀；恢复前另存的那一份用「恢复前-」 */
export const BACKUP_PREFIX = "油记备份-"
export const RESTORE_PREFIX = "恢复前-"
/** 自动备份留几天（每天一份）；恢复前的副本留几份 */
export const AUTO_KEEP = 10
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

/** 「油记备份-20261024-213015.zip」「恢复前-20261024-213015.zip」 */
export function backupName(prefix: string, ms: number): string {
  return `${prefix}${backupStamp(ms)}.zip`
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

/**
 * 备份文件夹里同一前缀的文件，按名字里的时间从新到旧保留 keep 份，返回要删的名字。
 * iCloud 里还没下载到手机的文件是「.<名字>.icloud」的占位文件，也按名字认；别的文件不动
 */
export function rotation(names: string[], prefix: string, keep: number): string[] {
  const re = new RegExp(`^\\.?${prefix}(\\d{8}-\\d{6})\\.zip(\\.icloud)?$`)
  return names
    .map(name => ({ name, m: re.exec(name) }))
    .filter((x): x is { name: string; m: RegExpExecArray } => !!x.m)
    .sort((a, b) => (a.m[1] < b.m[1] ? 1 : a.m[1] > b.m[1] ? -1 : 0))
    .slice(keep)
    .map(x => x.name)
}

/**
 * 写好一份新的自动备份以后要删的：同一天更早的那几份（同一天只留最新的），再按天留最近 keep 份。
 * 只看这个前缀、名字是备份格式的文件
 */
export function autoBackupDeletions(names: string[], prefix: string, newName: string, keep: number): string[] {
  const re = new RegExp(`^\\.?${prefix}(\\d{8})-\\d{6}\\.zip(\\.icloud)?$`)
  const day = re.exec(newName)?.[1]
  const sameDay = names.filter(n => n !== newName && n !== `.${newName}.icloud` && re.exec(n)?.[1] === day)
  const rest = names.filter(n => !sameDay.includes(n))
  return [...sameDay, ...rotation(rest, prefix, keep)]
}

/** zip 里保单原件的份数：insurance/ 下的文件（不算文件夹） */
export function policyFileCount(paths: string[]): number {
  return paths.filter(p => p.startsWith(`${POLICY_FOLDER}/`) && !p.endsWith("/")).length
}
