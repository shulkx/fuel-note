// 备份与恢复（纯逻辑）：备份文件的格式和校验、凭据加密、恢复时小熊状态的处理。
// 加密用 Node 兼容的 crypto 模块：Scripting 内置（dts/node.d.ts），Node 测试里是真的 Node，两边是同一份代码。
// 在用到时才加载，加载失败不影响油记启动。
//
// 与小熊云端的关系：连接了小熊的车以云端为准。备份里的小熊状态（某个云端版本 + 还没上传的修改）只在
// 恢复后、重新下载云端最新版本之前顶用；恢复不会把备份里的记录上传覆盖云端。还没上传的修改由用户决定要不要保留。
import { LedgerFile } from "./types"
import { XxyhState } from "../sync/xxyh/types"

export const BACKUP_FORMAT = "fuelnote-backup"
export const BACKUP_VERSION = 1
/** OWASP 对 PBKDF2-HMAC-SHA256 的建议（2023）是 60 万次；手机上太慢时最少 10 万次。次数写在备份里，恢复时照用 */
export const KDF_ITERATIONS = 600000
export const KDF_MIN_ITERATIONS = 100000
const CALIBRATE_ITERATIONS = 5000
/** 派生密钥大约用 1 秒 */
const KDF_TARGET_MS = 1000
const AAD = "fuelnote-backup/1"

export type EncryptedSecrets = {
  cipher: "aes-256-gcm"
  kdf: { name: "pbkdf2-sha256"; iterations: number; salt: string }
  iv: string
  tag: string
  data: string
  /** 里面有哪些凭据（只有名称），恢复前显示 */
  labels: string[]
}

export type BackupFile = {
  format: typeof BACKUP_FORMAT
  version: number
  app_version: string
  /** ISO 时间 */
  created_at: string
  ledger: LedgerFile
  xxyh: XxyhState
  secrets: EncryptedSecrets | null
}

/** 用到的 crypto 函数。Scripting 的 Buffer 类型声明与新版 TypeScript 的 Uint8Array 不兼容，所以字节一律按 Buffer（any）传 */
type Bytes = any
type GcmCipher = { setAAD(aad: Bytes): void; update(data: Bytes): Bytes; final(): Bytes; getAuthTag(): Bytes; setAuthTag(tag: Bytes): void }
type NodeCrypto = {
  pbkdf2Sync(password: string, salt: Bytes, iterations: number, keylen: number, digest: string): Bytes
  randomBytes(size: number): Bytes
  createCipheriv(algorithm: string, key: Bytes, iv: Bytes): GcmCipher
  createDecipheriv(algorithm: string, key: Bytes, iv: Bytes): GcmCipher
}

function nodeCrypto(): NodeCrypto {
  return require("crypto")
}

const b64 = (bytes: Bytes): string => Buffer.from(bytes).toString("base64")
const unb64 = (text: string): Bytes => Buffer.from(text, "base64")

function deriveKey(password: string, salt: Bytes, iterations: number): Bytes {
  return nodeCrypto().pbkdf2Sync(password, salt, iterations, 32, "sha256")
}

/** 按试算 5000 次的用时定迭代次数：大约 1 秒，10 万到 60 万次之间，取整到万 */
export function iterationsFor(msPerCalibration: number): number {
  const n = KDF_TARGET_MS / Math.max(msPerCalibration, 0.001) * CALIBRATE_ITERATIONS
  return Math.min(KDF_ITERATIONS, Math.max(KDF_MIN_ITERATIONS, Math.round(n / 10000) * 10000))
}

/** 在这台设备上试算（Scripting 的 pbkdf2 可能没有原生实现，不能写死 60 万次） */
function calibratedIterations(): number {
  const t0 = Date.now()
  deriveKey("calibrate", nodeCrypto().randomBytes(16), CALIBRATE_ITERATIONS)
  return iterationsFor(Date.now() - t0)
}

/** 设置备份密码时的检查；没问题返回 null */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < 6) return "密码至少 6 位"
  if (password !== again) return "两次输入的密码不一致"
  return null
}

export function encryptSecrets(values: Record<string, string>, labels: string[], password: string, iterations = calibratedIterations()): EncryptedSecrets {
  const c = nodeCrypto()
  const salt = c.randomBytes(16)
  const iv = c.randomBytes(12)
  const cipher = c.createCipheriv("aes-256-gcm", deriveKey(password, salt, iterations), iv)
  cipher.setAAD(Buffer.from(AAD))
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(values), "utf8")), cipher.final()])
  return {
    cipher: "aes-256-gcm",
    kdf: { name: "pbkdf2-sha256", iterations, salt: b64(salt) },
    iv: b64(iv),
    tag: b64(cipher.getAuthTag()),
    data: b64(data),
    labels,
  }
}

/** 密码不对（或文件被改过）时报「密码不正确」 */
export function decryptSecrets(s: EncryptedSecrets, password: string): Record<string, string> {
  const c = nodeCrypto()
  let text: string
  try {
    const decipher = c.createDecipheriv("aes-256-gcm", deriveKey(password, unb64(s.kdf.salt), s.kdf.iterations), unb64(s.iv))
    decipher.setAAD(Buffer.from(AAD))
    decipher.setAuthTag(unb64(s.tag))
    text = Buffer.concat([decipher.update(unb64(s.data)), decipher.final()]).toString("utf8")
  } catch {
    throw new Error("密码不正确")
  }
  const v = JSON.parse(text)
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v || {})) if (typeof val === "string") out[k] = val
  return out
}

export function makeBackup(ledger: LedgerFile, xxyh: XxyhState, appVersion: string, now: number, secrets: EncryptedSecrets | null): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: appVersion,
    created_at: new Date(now).toISOString(),
    ledger,
    xxyh: { ...xxyh, last_error: null },
    secrets,
  }
}

const isObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v)

function validSecrets(s: unknown): s is EncryptedSecrets {
  return isObject(s) && s.cipher === "aes-256-gcm" && isObject(s.kdf) && s.kdf.name === "pbkdf2-sha256"
    && Number.isInteger(s.kdf.iterations) && s.kdf.iterations > 0 && typeof s.kdf.salt === "string"
    && typeof s.iv === "string" && typeof s.tag === "string" && typeof s.data === "string" && Array.isArray(s.labels)
}

/** 读备份文件；不是油记的备份、来自更新的版本、内容不完整时报出原因 */
export function parseBackup(text: string): BackupFile {
  let v: any
  try {
    v = JSON.parse(text)
  } catch {
    throw new Error("不是油记的备份文件：无法读取")
  }
  if (isObject(v) && v.app === "fuelnote") throw new Error("这是「导出记录」生成的文件，不能用来恢复。请选择「备份到文件」生成的备份。")
  if (!isObject(v) || v.format !== BACKUP_FORMAT) throw new Error("不是油记的备份文件")
  if (!Number.isInteger(v.version) || v.version > BACKUP_VERSION) throw new Error("这个备份来自更新版本的油记，请先更新油记")
  const l = v.ledger
  if (!isObject(l) || l.schema_version !== 1 || !Array.isArray(l.vehicles) || !Array.isArray(l.records)) throw new Error("备份里的账本不完整")
  const x = v.xxyh
  if (!isObject(x) || x.schema_version !== 1 || !Array.isArray(x.ops)) throw new Error("备份里的小熊油耗同步状态不完整")
  if (v.secrets != null && !validSecrets(v.secrets)) throw new Error("备份里的凭据格式无法识别")
  return {
    format: BACKUP_FORMAT,
    version: v.version,
    app_version: String(v.app_version || ""),
    created_at: String(v.created_at || ""),
    ledger: l as LedgerFile,
    xxyh: x as XxyhState,
    secrets: v.secrets ?? null,
  }
}

export type BackupSummary = {
  created_at: number | null
  app_version: string
  vehicles: number
  /** 本机车辆的记录（连接了小熊的车以云端为准，不算在这里） */
  local_records: number
  linked_vehicles: number
  /** 保险明细的年数（保单原件不在备份里） */
  insurance_years: number
  xxyh_account: string | null
  xxyh_version: number | null
  pending_ops: number
  secrets: string[]
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const t = Date.parse(b.created_at)
  return {
    created_at: Number.isFinite(t) ? t : null,
    app_version: b.app_version,
    vehicles: b.ledger.vehicles.length,
    local_records: b.ledger.records.length,
    linked_vehicles: b.ledger.vehicles.filter(v => v.xxyh_car).length,
    insurance_years: (b.ledger.insurance ?? []).length,
    xxyh_account: b.xxyh.base ? b.xxyh.nickname || b.xxyh.account_id || "已连接" : null,
    xxyh_version: b.xxyh.base ? b.xxyh.base_version : null,
    pending_ops: b.xxyh.ops.length,
    secrets: b.secrets ? b.secrets.labels : [],
  }
}

/** 恢复后的小熊状态：不保留还没上传的修改时清掉；错误和冲突提示不带过来 */
export function restoredXxyh(x: XxyhState, keepOps: boolean): XxyhState {
  return { ...x, ops: keepOps ? x.ops : [], last_error: null, last_conflicts: [] }
}
