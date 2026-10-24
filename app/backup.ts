// 备份与恢复（2.0 设计第 6 节；纯规则在 common/backup.ts、common/backup_plan.ts）。
// 只有一种备份：一个 zip（backup.json 和 insurance/），都放在「油记备份」——自动备份（改了数据就写）、立即备份（不自动删）、恢复前的副本。
// 「包含凭据」：设了备份密码（只存在这台手机的钥匙串）就在每一份备份里放用它加密的凭据，自动和立即备份都一样。
import { Script } from "scripting"
import { BackupFile, decryptSecrets, encryptSecrets, makeBackup, parseBackup, passwordProblem } from "../common/backup"
import {
  AUTO_DELAY, autoBackupDeletions, AutoBackupState, BACKUP_JSON, BACKUP_PREFIX, BackupEntry, backupGroups, backupName, backupTime, ledgerHash, MANUAL_PREFIX,
  needsAutoBackup, parseBackupFile, POLICY_FOLDER, policyFileCount, RESTORE_PREFIX, restoreCopyDeletions,
} from "../common/backup_plan"
import { joinPath } from "../common/files"
import { yearFiles, yearLabel } from "../common/insurance"
import { AppData } from "../common/ledger"
import { PROVIDERS } from "../providers/registry"
import {
  getSecret, providerSecretKey, providerSessionKey, removeSecret, SECRET_AMAP_KEY, SECRET_AZURE, SECRET_BACKUP_PASSWORD, SECRET_XXYH_TOKEN, setSecret,
} from "../platform/secrets"
import {
  backupDirectory, isMainDataRoot, listBackupNames, policyDirectory, policyFilePath, readAutoBackupState, readLatestSnapshot, saveAutoBackupState, saveLedger,
  saveSnapshot, saveXxyhState,
} from "../platform/storage"
import { errorText } from "./errors"
import { loadData } from "./store"

/** 备份里的凭据：钥匙串里的原文（JSON 凭据也是字符串）。车辆数据的会话只是缓存，备份密码本身也不放进去 */
function secretItems(): Array<{ key: string; label: string }> {
  return [
    { key: SECRET_XXYH_TOKEN, label: "小熊油耗" },
    ...PROVIDERS.map(p => ({ key: providerSecretKey(p.id), label: p.name })),
    { key: SECRET_AMAP_KEY, label: "高德" },
    { key: SECRET_AZURE, label: "Azure OpenAI" },
  ]
}

/** 本机现在保存了哪些凭据（名称）；FuelNote Check 的数据文件夹里不读钥匙串 */
export const storedSecretLabels = (): string[] => (isMainDataRoot() ? secretItems().filter(i => getSecret(i.key)).map(i => i.label) : [])

// ---------- 包含凭据：备份密码 ----------

/** FuelNote Check 的数据文件夹里不读钥匙串：备份都不带凭据 */
const backupPassword = (): string | null => (isMainDataRoot() ? getSecret(SECRET_BACKUP_PASSWORD) : null)

/** 设了备份密码就带凭据 */
export const credentialsIncluded = (): boolean => !!backupPassword()

/** 设或改备份密码（之后的每一份备份都用它加密凭据） */
export function setBackupPassword(password: string): void {
  const problem = passwordProblem(password, password)
  if (problem) throw new Error(problem)
  setSecret(SECRET_BACKUP_PASSWORD, password)
}

/** 关掉「包含凭据」：删掉存着的密码，之后的备份不带凭据 */
export function clearBackupPassword(): void {
  removeSecret(SECRET_BACKUP_PASSWORD)
}

/** password 为 null 时不带凭据；带上最近一份小熊快照（恢复后照样能算还没导出的修改） */
function backupText(data: AppData, password: string | null, now: number): string {
  let secrets = null
  if (password) {
    const items = secretItems().map(i => ({ ...i, value: getSecret(i.key) })).filter(i => i.value)
    if (items.length) secrets = encryptSecrets(Object.fromEntries(items.map(i => [i.key, i.value as string])), items.map(i => i.label), password)
  }
  return JSON.stringify(makeBackup(data.ledger, data.xxyh, readLatestSnapshot()?.doc ?? null, Script.metadata.version, now, secrets))
}

const removeQuietly = (path: string) => {
  try { if (FileManager.existsSync(path)) FileManager.removeSync(path) } catch { /* 清理失败不影响结果 */ }
}

/** 删一份备份：实际的文件和 iCloud 的占位文件都删（占位文件这一点未在手机上核实） */
function removeBackupFile(dir: string, file: string): void {
  const e = parseBackupFile(file)
  removeQuietly(joinPath(dir, e ? e.name : file))
  if (e && e.file !== e.name) removeQuietly(joinPath(dir, e.file))
}

// ---------- 写和读一份 zip ----------

/** 选中的备份：读出的数据，zip 里保单原件的份数，复制到临时目录的 zip（恢复时从这里解出）和它的大小 */
export type PickedBackup = { name: string; path: string; backup: BackupFile; policyFiles: number; size?: number }

/** 只读出 zip 里的 backup.json 和条目列表，不解出原件 */
export async function readBackupZip(path: string): Promise<{ backup: BackupFile; policyFiles: number }> {
  let archive: Archive
  try {
    archive = Archive.openForMode(path, "read")
  } catch {
    throw new Error("不是油记的备份文件：不是 zip")
  }
  if (!archive.contains(BACKUP_JSON)) throw new Error("不是油记的备份文件：zip 里没有 backup.json")
  // 回调给的 Data 会被下一块复用（手机上 2026-10-24 试过），每块先复制一份
  const chunks: Data[] = []
  await archive.extract(BACKUP_JSON, chunk => { chunks.push(chunk.slice()) })
  const text = Data.combine(chunks).toRawString("utf-8")
  if (text == null) throw new Error("备份里的 backup.json 读不出来")
  return { backup: parseBackup(text), policyFiles: policyFileCount(archive.getEntryPaths()) }
}

/**
 * 写一份备份 zip 到 dest：先在临时目录放好 backup.json 和保单原件，打包，读回来核对（数据条数、账本里的原件都在包里），再复制到 dest。
 * password 为 null 时不带凭据
 */
export async function writeBackupZip(dest: string, data: AppData, password: string | null, now = Date.now()): Promise<void> {
  const work = joinPath(FileManager.temporaryDirectory, `fuelnote-backup-${now}-${Math.random().toString(36).slice(2, 8)}`)
  const stage = joinPath(work, "stage")
  const zip = joinPath(work, "backup.zip")
  try {
    FileManager.createDirectorySync(stage, true)
    FileManager.writeAsStringSync(joinPath(stage, BACKUP_JSON), backupText(data, password, now))
    const policies = policyDirectory()
    if (FileManager.existsSync(policies)) FileManager.copyFileSync(policies, joinPath(stage, POLICY_FOLDER))
    await Archive.createZip({ sourcePath: stage, destinationPath: zip, shouldKeepParent: false, compressionMethod: "deflate" })
    // 读回来核对
    const back = await readBackupZip(zip)
    if (back.backup.ledger.records.length !== data.ledger.records.length) throw new Error("备份读回来的记录条数不对")
    const archive = Archive.openForMode(zip, "read")
    const lost = data.ledger.insurance.flatMap(yearFiles).filter(f => FileManager.existsSync(policyFilePath(f)) && !archive.contains(f))
    if (lost.length) throw new Error(`备份里少了 ${lost.length} 份保单原件`)
    FileManager.createDirectorySync(dest.slice(0, dest.lastIndexOf("/")), true)
    removeQuietly(dest)
    FileManager.copyFileSync(zip, dest)
  } finally {
    removeQuietly(work)
  }
}

/** 复制到临时目录后读出（恢复时从这份复制解出，原文件不动） */
async function pickCopy(path: string, name: string): Promise<PickedBackup> {
  const copy = joinPath(FileManager.temporaryDirectory, `fuelnote-pick-${Date.now()}.zip`)
  FileManager.copyFileSync(path, copy)
  try {
    return { name, path: copy, size: FileManager.statSync(copy).size, ...(await readBackupZip(copy)) }
  } catch (e) {
    removeQuietly(copy)
    throw e
  }
}

// ---------- 立即备份、另存一份、恢复列表 ----------

/** 立即备份：写一份「手动备份-…zip」到备份文件夹（不自动删），返回文件名 */
export async function backupNow(data: AppData): Promise<string> {
  const now = Date.now()
  const name = backupName(MANUAL_PREFIX, now)
  await writeBackupZip(joinPath(backupDirectory().dir, name), data, backupPassword(), now)
  return name
}

/** 下载还在 iCloud 里的备份，返回本机路径 */
async function localPath(entry: BackupEntry): Promise<string> {
  const { dir, icloud } = backupDirectory()
  const path = joinPath(dir, entry.name)
  if (icloud && (!entry.downloaded || !FileManager.isiCloudFileDownloaded(path))) {
    if (!(await FileManager.downloadFileFromiCloud(path))) throw new Error("没能从 iCloud 下载这份备份")
  }
  return path
}

/** 另存一份：把最新的一份（自动或立即备份）交给分享面板（存到「文件」别处、隔空投送）；没有备份时报错 */
export async function shareLatestBackup(): Promise<boolean> {
  const g = backupGroups(listBackupNames(backupDirectory().dir), Date.now())
  const latest = [...g.daily, ...g.weekly, ...g.monthly, ...g.manual].sort((a, b) => backupTime(b) - backupTime(a))[0]
  if (!latest) throw new Error("还没有备份，先点「立即备份」")
  return ShareSheet.present([await localPath(latest)])
}

/** 恢复列表：备份文件夹里的全部备份，按分层、立即备份、恢复前分组 */
export function listBackups(now = Date.now()) {
  return backupGroups(listBackupNames(backupDirectory().dir), now)
}

/** 打开列表里的一份：下载（还在 iCloud 里时）、复制到临时目录、读出 backup.json */
export async function openBackup(entry: BackupEntry): Promise<PickedBackup> {
  return pickCopy(await localPath(entry), entry.name)
}

/** 删掉列表里的一份（立即备份、恢复前的副本） */
export function deleteBackup(entry: BackupEntry): void {
  removeBackupFile(backupDirectory().dir, entry.file)
}

/** 从其他位置选一个备份 zip；取消时返回 null */
export async function pickBackupFile(): Promise<PickedBackup | null> {
  const paths = await DocumentPicker.pickFiles({ types: ["public.zip-archive"] })
  if (!paths.length) return null
  try {
    return await pickCopy(paths[0], paths[0].split("/").pop() || paths[0])
  } finally {
    DocumentPicker.stopAcessingSecurityScopedResources()
  }
}

/** 用完了（恢复了或不恢复）：删掉打开备份时复制的临时文件。恢复失败时这份还在，可以改了密码再试 */
export function discardPickedBackup(picked: PickedBackup): void {
  removeQuietly(picked.path)
}

// ---------- 恢复 ----------

/**
 * 用备份替换本机数据和保单原件。密码不对、zip 解不开时什么都不改。
 * 替换前把现在的数据和原件存一份「恢复前-…zip」到备份文件夹（留最近 5 份）。
 * password 为 null 时不恢复凭据，保留本机现有的；用密码恢复了凭据时，这个密码存回钥匙串（「包含凭据」打开）
 */
export async function restoreBackup(picked: PickedBackup, opts: { password: string | null }): Promise<{
  data: AppData; safetyName: string; secrets: string[]; missing: string[]
}> {
  const b = picked.backup
  const secrets = b.secrets && opts.password ? decryptSecrets(b.secrets, opts.password) : null
  const now = Date.now()
  const out = joinPath(FileManager.temporaryDirectory, `fuelnote-restore-${now}`)
  try {
    // 解到新的临时文件夹：越界的路径、过多过大的条目都会被拒绝
    await Archive.extractZip({ sourcePath: picked.path, destinationPath: out, overwrite: "error", maxEntries: 20000, maxUncompressedBytes: 2 * 1024 ** 3 })
    const { dir } = backupDirectory()
    const safetyName = backupName(RESTORE_PREFIX, now)
    await writeBackupZip(joinPath(dir, safetyName), loadData().data, backupPassword(), now)
    for (const f of restoreCopyDeletions(listBackupNames(dir))) removeBackupFile(dir, f)

    saveLedger(b.ledger)
    saveXxyhState({ ...b.xxyh, last_error: null })
    if (b.xxyh_snapshot && b.xxyh.last_version != null) {
      try { saveSnapshot(b.xxyh.last_version, b.xxyh_snapshot) } catch { /* 没有快照时导出前会重新下载 */ }
    }
    const policies = policyDirectory()
    removeQuietly(policies)
    const from = joinPath(out, POLICY_FOLDER)
    if (FileManager.existsSync(from)) FileManager.copyFileSync(from, policies)

    const restored: string[] = []
    if (secrets && opts.password) {
      for (const i of secretItems()) {
        if (!secrets[i.key]) continue
        setSecret(i.key, secrets[i.key])
        restored.push(i.label)
      }
      for (const p of PROVIDERS) removeSecret(providerSessionKey(p.id)) // 会话按新凭据重新换
      setSecret(SECRET_BACKUP_PASSWORD, opts.password) // 之后的备份接着用这个密码（「包含凭据」打开）
    }
    const data = loadData().data
    const missing = data.ledger.insurance.filter(y => yearFiles(y).some(f => !FileManager.existsSync(policyFilePath(f)))).map(yearLabel)
    return { data, safetyName, secrets: restored, missing }
  } finally {
    removeQuietly(out)
  }
}

// ---------- 自动备份 ----------

let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
let again = false
let source: (() => AppData) | null = null

/** 数据变了：1 分钟内没有新的修改就备份 */
export function scheduleAutoBackup(get: () => AppData): void {
  source = get
  if (timer != null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runAutoBackup()
  }, AUTO_DELAY)
}

/** 离开油记、打开时：有还没备份的修改就马上备份 */
export function flushAutoBackup(get: () => AppData): Promise<void> {
  source = get
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  return runAutoBackup()
}

/** 关闭主界面前：还没备份的修改马上写，最多等 20 秒 */
export async function finishAutoBackup(ms = 20000): Promise<void> {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  if (!source && !running) return
  await Promise.race([runAutoBackup(), new Promise<void>(resolve => setTimeout(resolve, ms))])
}

async function runAutoBackup(): Promise<void> {
  if (!source || !isMainDataRoot()) return
  if (running) {
    again = true
    return running
  }
  const data = source()
  if (!data.ledger.settings.auto_backup) return
  const state = readAutoBackupState()
  const hash = ledgerHash(data.ledger)
  if (!needsAutoBackup(state, hash)) return
  running = (async () => {
    let kept = false
    try { kept = await BackgroundKeeper.keepAlive() } catch { /* 只在主界面能用 */ }
    const now = Date.now()
    const { dir, icloud } = backupDirectory()
    try {
      const name = backupName(BACKUP_PREFIX, now)
      await writeBackupZip(joinPath(dir, name), data, backupPassword(), now)
      for (const f of autoBackupDeletions(listBackupNames(dir), now)) removeBackupFile(dir, f)
      saveAutoBackupState({ ...state, last_ts: now, last_hash: hash, last_name: name, icloud, last_error: null, error_ts: null })
    } catch (e) {
      saveAutoBackupState({ ...state, last_error: errorText(e), error_ts: now })
    } finally {
      if (kept) {
        try { await BackgroundKeeper.stopKeepAlive() } catch { /* 忽略 */ }
      }
      running = null
    }
  })()
  await running
  if (again) {
    again = false
    await runAutoBackup()
  }
}

/** 设置里显示的自动备份状态和位置 */
export function autoBackupInfo(): AutoBackupState & { place: string; icloudOn: boolean } {
  const { icloud } = backupDirectory()
  return { ...readAutoBackupState(), place: icloud ? "iCloud 云盘" : "本机", icloudOn: icloud }
}
