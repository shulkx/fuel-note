// 备份与恢复（纯逻辑）：备份文件的格式和校验、凭据加密（2.0 设计第 6 节）。
// 加密用 Node 兼容的 crypto 模块：Scripting 内置（dts/node.d.ts），Node 测试里是真的 Node，两边是同一份代码。
// 在用到时才加载，加载失败不影响油记启动。派生密钥由调用方传入：手机上用原生 HMAC 的 platform/kdf.ts（Scripting 的 pbkdf2 是 JS 实现，太慢），
// 默认用 Node 的 pbkdf2Sync（测试）。设备份密码时派生一次，存下密钥；每份备份只做 AES。
// 2.0 起数据都在账本里，备份就是全部数据；另带一份精简的小熊快照，恢复后照样能算「几条修改没导出」。2.0 以前的备份不能恢复。
import { isLedgerV2, ledgerProblems, normalizeLedger } from "./ledger_file"
import { LedgerFile } from "./types"
import { XxyhBackup, XxyhState } from "../sync/xxyh/types"

export const BACKUP_FORMAT = "fuelnote-backup"
export const BACKUP_VERSION = 2
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
  /** 上次导入或导出的小熊备份，只留 cars、myStations、expenseTypes；没有连接小熊时为 null */
  xxyh_snapshot: XxyhBackup | null
  secrets: EncryptedSecrets | null
}

/** 小熊快照只留导出要比较的部分 */
export function trimSnapshot(doc: XxyhBackup | null): XxyhBackup | null {
  if (!doc) return null
  return { cars: doc.cars || [], ...(doc.myStations ? { myStations: doc.myStations } : {}), ...(doc.expenseTypes ? { expenseTypes: doc.expenseTypes } : {}) }
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

/** 派生 32 字节的 PBKDF2-HMAC-SHA256 密钥 */
export type Derive = (password: string, salt: Bytes, iterations: number) => Promise<Bytes>

const nodeDerive: Derive = async (password, salt, iterations) => nodeCrypto().pbkdf2Sync(password, salt, iterations, 32, "sha256")

/** 先让出一下：派生密钥约 1 秒，让界面先画出「进行中」 */
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 50))

/** 按试算 5000 次的用时定迭代次数：大约 1 秒，10 万到 60 万次之间，取整到万 */
export function iterationsFor(msPerCalibration: number): number {
  const n = KDF_TARGET_MS / Math.max(msPerCalibration, 0.001) * CALIBRATE_ITERATIONS
  return Math.min(KDF_ITERATIONS, Math.max(KDF_MIN_ITERATIONS, Math.round(n / 10000) * 10000))
}

/** 用同一个派生函数在这台设备上试算（各设备、各实现的速度差很多，不能写死 60 万次） */
async function calibratedIterations(derive: Derive): Promise<number> {
  const t0 = Date.now()
  await derive("calibrate", nodeCrypto().randomBytes(16), CALIBRATE_ITERATIONS)
  return iterationsFor(Date.now() - t0)
}

/**
 * 备份密钥：备份密码派生出的 AES 密钥和派生用的盐、次数（base64 / 整数）。
 * 存在本机钥匙串（代替密码本身），每份备份直接用它加密；盐和次数写进备份，恢复时按密码重新派生
 */
export type BackupKey = { salt: string; iterations: number; key: string }

/** 设备份密码时派生一次（没给次数时按设备试算） */
export async function makeBackupKey(password: string, opts: { derive?: Derive; iterations?: number } = {}): Promise<BackupKey> {
  const derive = opts.derive ?? nodeDerive
  await pause()
  const n = opts.iterations ?? await calibratedIterations(derive)
  const salt = nodeCrypto().randomBytes(16)
  return { salt: b64(salt), iterations: n, key: b64(await derive(password, salt, n)) }
}

/** 钥匙串里存的备份密钥；不是这个格式时为 null */
export function parseBackupKey(text: string | null): BackupKey | null {
  if (!text) return null
  try {
    const v = JSON.parse(text)
    return isObject(v) && typeof v.salt === "string" && Number.isInteger(v.iterations) && v.iterations > 0 && typeof v.key === "string" ? v as BackupKey : null
  } catch {
    return null
  }
}

/** 设置备份密码时的检查；没问题返回 null */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < 6) return "密码至少 6 位"
  if (password !== again) return "两次输入的密码不一致"
  return null
}

/** 用备份密钥加密（只做 AES-256-GCM，每次新的 IV） */
export function encryptSecrets(values: Record<string, string>, labels: string[], key: BackupKey): EncryptedSecrets {
  const c = nodeCrypto()
  const iv = c.randomBytes(12)
  const cipher = c.createCipheriv("aes-256-gcm", unb64(key.key), iv)
  cipher.setAAD(Buffer.from(AAD))
  const data = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(values), "utf8")), cipher.final()])
  return {
    cipher: "aes-256-gcm",
    kdf: { name: "pbkdf2-sha256", iterations: key.iterations, salt: key.salt },
    iv: b64(iv),
    tag: b64(cipher.getAuthTag()),
    data: b64(data),
    labels,
  }
}

/** 按密码派生密钥后解开，连同这个备份密钥一起返回（恢复后之后的备份接着用它）。密码不对（或文件被改过）时报「密码不正确」 */
export async function decryptSecrets(s: EncryptedSecrets, password: string, derive: Derive = nodeDerive): Promise<{ values: Record<string, string>; key: BackupKey }> {
  const c = nodeCrypto()
  await pause()
  const key: BackupKey = { salt: s.kdf.salt, iterations: s.kdf.iterations, key: b64(await derive(password, unb64(s.kdf.salt), s.kdf.iterations)) }
  let text: string
  try {
    const decipher = c.createDecipheriv("aes-256-gcm", unb64(key.key), unb64(s.iv))
    decipher.setAAD(Buffer.from(AAD))
    decipher.setAuthTag(unb64(s.tag))
    text = Buffer.concat([decipher.update(unb64(s.data)), decipher.final()]).toString("utf8")
  } catch {
    throw new Error("密码不正确")
  }
  const v = JSON.parse(text)
  const values: Record<string, string> = {}
  for (const [k, val] of Object.entries(v || {})) if (typeof val === "string") values[k] = val
  return { values, key }
}

export function makeBackup(ledger: LedgerFile, xxyh: XxyhState, snapshot: XxyhBackup | null, appVersion: string, now: number, secrets: EncryptedSecrets | null): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app_version: appVersion,
    created_at: new Date(now).toISOString(),
    ledger,
    xxyh: { ...xxyh, last_error: null },
    xxyh_snapshot: trimSnapshot(snapshot),
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
  if (!isObject(v) || v.format !== BACKUP_FORMAT) throw new Error("不是油记的备份文件")
  if (!Number.isInteger(v.version) || v.version > BACKUP_VERSION) throw new Error("这个备份来自更新版本的油记，请先更新油记")
  if (v.version < BACKUP_VERSION) throw new Error("这个备份来自 2.0 以前的油记，不能恢复")
  if (!isLedgerV2(v.ledger)) throw new Error("备份里的账本不完整")
  const x = v.xxyh
  if (!isObject(x) || x.schema_version !== 2) throw new Error("备份里的小熊油耗状态不完整")
  if (v.secrets != null && !validSecrets(v.secrets)) throw new Error("备份里的凭据格式无法识别")
  return {
    format: BACKUP_FORMAT,
    version: v.version,
    app_version: String(v.app_version || ""),
    created_at: String(v.created_at || ""),
    ledger: normalizeLedger(v.ledger),
    xxyh: x as XxyhState,
    xxyh_snapshot: isObject(v.xxyh_snapshot) && Array.isArray(v.xxyh_snapshot.cars) ? (v.xxyh_snapshot as XxyhBackup) : null,
    secrets: v.secrets ?? null,
  }
}

export type BackupSummary = {
  created_at: number | null
  app_version: string
  vehicles: number
  records: number
  /** 保险明细的年数 */
  insurance_years: number
  /** 权益的张数（1.7） */
  benefits: number
  xxyh_account: string | null
  /** 上次导入或导出时的小熊版本 */
  xxyh_version: number | null
  /** 找不到的引用（恢复前列出来） */
  problems: string[]
  secrets: string[]
}

export function summarizeBackup(b: BackupFile): BackupSummary {
  const t = Date.parse(b.created_at)
  return {
    created_at: Number.isFinite(t) ? t : null,
    app_version: b.app_version,
    vehicles: b.ledger.vehicles.length,
    records: b.ledger.records.length,
    insurance_years: b.ledger.insurance.length,
    benefits: b.ledger.perks.length,
    xxyh_account: b.xxyh.account_id ? b.xxyh.nickname || b.xxyh.account_id : null,
    xxyh_version: b.xxyh.last_version,
    problems: ledgerProblems(b.ledger),
    secrets: b.secrets ? b.secrets.labels : [],
  }
}
