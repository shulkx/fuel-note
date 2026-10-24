// 备份与恢复（2.0 设计第 6 节；纯逻辑在 common/backup.ts）。2.0.0-beta.2 先是一个 JSON 文件，zip 和自动备份在 beta.3
import { Script } from "scripting"
import { BackupFile, decryptSecrets, encryptSecrets, makeBackup, parseBackup } from "../common/backup"
import { AppData } from "../common/ledger"
import { fmtDate, fmtTime } from "../common/time"
import { PROVIDERS } from "../providers/registry"
import { getSecret, providerSecretKey, providerSessionKey, removeSecret, SECRET_AMAP_KEY, SECRET_AZURE, SECRET_XXYH_TOKEN, setSecret } from "../platform/secrets"
import { readLatestSnapshot, readLegacyFiles, saveLedger, saveSnapshot, saveXxyhState, writeRestoreCopy } from "../platform/storage"
import { loadData } from "./store"

/** 备份里的凭据：钥匙串里的原文（JSON 凭据也是字符串）。车辆数据的会话只是缓存，不备份 */
function secretItems(): Array<{ key: string; label: string }> {
  return [
    { key: SECRET_XXYH_TOKEN, label: "小熊油耗" },
    ...PROVIDERS.map(p => ({ key: providerSecretKey(p.id), label: p.name })),
    { key: SECRET_AMAP_KEY, label: "高德" },
    { key: SECRET_AZURE, label: "Azure OpenAI" },
  ]
}

/** 本机现在保存了哪些凭据（名称） */
export const storedSecretLabels = (): string[] => secretItems().filter(i => getSecret(i.key)).map(i => i.label)

const stamp = (ms: number) => `${fmtDate(ms).replace(/-/g, "")}-${fmtTime(ms).replace(":", "")}`

/** password 为 null 时不备份凭据；带上最近一份小熊快照（恢复后照样能算还没导出的修改） */
function backupText(data: AppData, password: string | null, now: number): string {
  let secrets = null
  if (password) {
    const items = secretItems().map(i => ({ ...i, value: getSecret(i.key) })).filter(i => i.value)
    if (items.length) secrets = encryptSecrets(Object.fromEntries(items.map(i => [i.key, i.value as string])), items.map(i => i.label), password)
  }
  return JSON.stringify(makeBackup(data.ledger, data.xxyh, readLatestSnapshot()?.doc ?? null, Script.metadata.version, now, secrets))
}

/** 存到「文件」（用户选位置，建议 iCloud 云盘）；取消时返回 false */
export async function saveBackupToFiles(data: AppData, password: string | null): Promise<boolean> {
  const now = Date.now()
  const file = Data.fromString(backupText(data, password, now))
  if (!file) throw new Error("备份内容无法转换")
  const saved = await DocumentPicker.exportFiles({ files: [{ data: file, name: `fuelnote-backup-${stamp(now)}.json` }] })
  return saved.length > 0
}

/** 让用户选一个备份文件并读取；取消时返回 null。1.x 的备份报出要先在电脑上转换 */
export async function pickBackupFile(): Promise<{ name: string; backup: BackupFile } | null> {
  const paths = await DocumentPicker.pickFiles({ types: ["public.json"] })
  if (!paths.length) return null
  try {
    const path = paths[0]
    return { name: path.split("/").pop() || path, backup: parseBackup(FileManager.readAsStringSync(path)) }
  } finally {
    DocumentPicker.stopAcessingSecurityScopedResources()
  }
}

/**
 * 用备份替换本机数据。密码不对时什么都不改。替换前把当前数据另存到文稿目录（「文件」App 能看到，只留最近几份）；
 * 现在只有 1.x 的数据时另存 1.x 的原文件。password 为 null 时不恢复凭据，保留本机现有的
 */
export async function restoreBackup(b: BackupFile, opts: { password: string | null }): Promise<{ data: AppData; safetyPath: string; secrets: string[] }> {
  const secrets = b.secrets && opts.password ? decryptSecrets(b.secrets, opts.password) : null
  const now = Date.now()
  const current = loadData()
  const legacy = current.legacy ? readLegacyFiles() : null
  const safetyPath = legacy
    ? writeRestoreCopy(`${stamp(now)}-1x`, JSON.stringify({ format: "fuelnote-1x-files", ledger: legacy.ledger, xxyh: legacy.xxyh }))
    : writeRestoreCopy(stamp(now), backupText(current.data, null, now))
  saveLedger(b.ledger)
  saveXxyhState({ ...b.xxyh, last_error: null })
  if (b.xxyh_snapshot && b.xxyh.last_version != null) {
    try { saveSnapshot(b.xxyh.last_version, b.xxyh_snapshot) } catch { /* 没有快照时导出前会重新下载 */ }
  }
  const restored: string[] = []
  if (secrets) {
    for (const i of secretItems()) {
      if (!secrets[i.key]) continue
      setSecret(i.key, secrets[i.key])
      restored.push(i.label)
    }
    for (const p of PROVIDERS) removeSecret(providerSessionKey(p.id)) // 会话按新凭据重新换
  }
  return { data: loadData().data, safetyPath, secrets: restored }
}
