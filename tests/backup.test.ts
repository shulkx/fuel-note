// 备份与恢复：凭据加密（PBKDF2-SHA256 + AES-256-GCM）、备份文件的读写和校验、恢复时小熊状态的处理
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import {
  BACKUP_FORMAT, decryptSecrets, encryptSecrets, iterationsFor, KDF_ITERATIONS, KDF_MIN_ITERATIONS, makeBackup, parseBackup, passwordProblem, restoredXxyh,
  summarizeBackup,
} from "../common/backup"
import { emptyLedger } from "../common/types"
import { emptyXxyhState } from "../sync/xxyh/types"

const SECRETS = { "xxyh.token": "token-abc", "provider.volvo_cn": "{\"refresh_token\":\"rt\"}", "amap.key": "k1" }

test("备份密码：至少 6 位，两次一致", () => {
  assert.equal(passwordProblem("12345", "12345"), "密码至少 6 位")
  assert.equal(passwordProblem("123456", "123457"), "两次输入的密码不一致")
  assert.equal(passwordProblem("123456", "123456"), null)
})

test("凭据加密：密码对时原样解出；密码不对或文件被改过时报「密码不正确」；文件里没有明文", () => {
  const e = encryptSecrets(SECRETS, ["小熊油耗", "沃尔沃（中国）", "高德"], "correct horse", 1000)
  assert.deepEqual(decryptSecrets(e, "correct horse"), SECRETS)
  assert.throws(() => decryptSecrets(e, "wrong horse"), /密码不正确/)
  const tampered = { ...e, data: Buffer.from(Buffer.from(e.data, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") }
  assert.throws(() => decryptSecrets(tampered, "correct horse"), /密码不正确/)
  const text = JSON.stringify(e)
  for (const v of Object.values(SECRETS)) assert.ok(!text.includes(v))
  assert.deepEqual(e.labels, ["小熊油耗", "沃尔沃（中国）", "高德"])
  // 每次加密的盐和 IV 都不同
  const again = encryptSecrets(SECRETS, [], "correct horse", 1000)
  assert.notEqual(again.kdf.salt, e.kdf.salt)
  assert.notEqual(again.iv, e.iv)
})

test("凭据加密：迭代次数按设备试算，约 1 秒，10 万到 60 万次", () => {
  assert.equal(KDF_ITERATIONS, 600000)
  assert.equal(KDF_MIN_ITERATIONS, 100000)
  assert.equal(iterationsFor(1), 600000, "原生实现很快：用上限")
  assert.equal(iterationsFor(10), 500000)
  assert.equal(iterationsFor(25), 200000)
  assert.equal(iterationsFor(500), 100000, "很慢：用下限")
  assert.equal(iterationsFor(0), 600000)
})

test("凭据加密：标准格式，用 Node 自己的 PBKDF2 和 AES-GCM 也能解开；默认按设备试算次数", () => {
  const e = encryptSecrets(SECRETS, [], "pw123456")
  assert.ok(e.kdf.iterations >= KDF_MIN_ITERATIONS && e.kdf.iterations <= KDF_ITERATIONS, String(e.kdf.iterations))
  assert.equal(e.kdf.iterations % 10000, 0)
  const key = pbkdf2Sync("pw123456", Buffer.from(e.kdf.salt, "base64"), e.kdf.iterations, 32, "sha256")
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"))
  d.setAAD(Buffer.from("fuelnote-backup/1"))
  d.setAuthTag(Buffer.from(e.tag, "base64"))
  const plain = Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8")
  assert.deepEqual(JSON.parse(plain), SECRETS)
})

function sample() {
  const ledger = emptyLedger()
  ledger.vehicles.push({ id: "v1", name: "S90", default_grade: 95 } as any, { id: "v2", name: "小车", default_grade: 92, xxyh_car: "c1" } as any)
  ledger.records.push({ id: "r1" } as any, { id: "r2" } as any)
  const xxyh = { ...emptyXxyhState(), account_id: "42", nickname: "小熊用户", base_version: 311, base: { cars: [] } as any, ops: [{ type: "delete_fuel" } as any], last_error: "网络错误", last_conflicts: ["x"] }
  return { ledger, xxyh }
}

test("备份文件：写出再读回内容不变；同步错误不带进备份；摘要", () => {
  const { ledger, xxyh } = sample()
  const secrets = encryptSecrets(SECRETS, ["小熊油耗"], "pw123456", 1000)
  const b = makeBackup(ledger, xxyh, "1.1.5", Date.UTC(2026, 9, 19, 2, 30), secrets)
  assert.equal(b.format, BACKUP_FORMAT)
  assert.equal(b.created_at, "2026-10-19T02:30:00.000Z")
  assert.equal(b.xxyh.last_error, null)
  const back = parseBackup(JSON.stringify(b))
  assert.deepEqual(back, b)
  assert.deepEqual(summarizeBackup(back), {
    created_at: Date.UTC(2026, 9, 19, 2, 30), app_version: "1.1.5", vehicles: 2, local_records: 2, linked_vehicles: 1,
    xxyh_account: "小熊用户", xxyh_version: 311, pending_ops: 1, secrets: ["小熊油耗"],
  })
  const plain = parseBackup(JSON.stringify(makeBackup(ledger, emptyXxyhState(), "1.1.5", 0, null)))
  assert.equal(plain.secrets, null)
  assert.equal(summarizeBackup(plain).xxyh_account, null)
})

test("备份文件：不是备份、导出记录的文件、更新版本的备份、内容不完整时报出原因", () => {
  const { ledger, xxyh } = sample()
  const good = makeBackup(ledger, xxyh, "1.1.5", 0, null) as any
  assert.throws(() => parseBackup("not json"), /无法读取/)
  assert.throws(() => parseBackup(JSON.stringify({ app: "fuelnote", schema_version: 1, vehicles: [] })), /导出记录/)
  assert.throws(() => parseBackup(JSON.stringify({ hello: 1 })), /不是油记的备份文件/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, version: 2 })), /更新版本/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, ledger: { ...ledger, schema_version: 2 } })), /账本不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, ledger: { ...ledger, records: null } })), /账本不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, xxyh: { ...xxyh, ops: null } })), /同步状态不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, secrets: { cipher: "aes-128-cbc" } })), /凭据格式/)
})

test("恢复：小熊状态保留云端版本；未上传的修改按用户选择保留或清掉；错误和冲突提示不带过来", () => {
  const { xxyh } = sample()
  const kept = restoredXxyh(xxyh, true)
  assert.equal(kept.ops.length, 1)
  assert.equal(kept.base_version, 311)
  assert.equal(kept.last_error, null)
  assert.deepEqual(kept.last_conflicts, [])
  assert.equal(restoredXxyh(xxyh, false).ops.length, 0)
  assert.equal(restoredXxyh(xxyh, false).base, xxyh.base)
})
