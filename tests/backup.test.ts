// 备份与恢复：凭据加密（PBKDF2-SHA256 + AES-256-GCM）、备份文件的读写和校验
import { test } from "node:test"
import assert from "node:assert/strict"
import { createDecipheriv, pbkdf2Sync } from "node:crypto"
import {
  BACKUP_FORMAT, decryptSecrets, encryptSecrets, iterationsFor, KDF_ITERATIONS, KDF_MIN_ITERATIONS, makeBackup, makeBackupKey, parseBackup, parseBackupKey, passwordProblem,
  summarizeBackup,
} from "../common/backup"
import { emptyLedger, LedgerFile } from "../common/types"
import { emptyXxyhState, XxyhBackup, XxyhState } from "../sync/xxyh/types"

const SECRETS = { "xxyh.token": "token-abc", "provider.volvo_cn": "{\"refresh_token\":\"rt\"}", "amap.key": "amap-key-0001" }

test("备份密码：至少 6 位，两次一致", () => {
  assert.equal(passwordProblem("12345", "12345"), "密码至少 6 位")
  assert.equal(passwordProblem("123456", "123457"), "两次输入的密码不一致")
  assert.equal(passwordProblem("123456", "123456"), null)
})

test("凭据加密：密码对时原样解出，并拿回同一个备份密钥；密码不对或文件被改过时报「密码不正确」；文件里没有明文", async () => {
  const key = await makeBackupKey("correct horse", { iterations: 1000 })
  const e = encryptSecrets(SECRETS, ["小熊油耗", "沃尔沃（中国）", "高德"], key)
  assert.deepEqual(await decryptSecrets(e, "correct horse"), { values: SECRETS, key })
  await assert.rejects(decryptSecrets(e, "wrong horse"), /密码不正确/)
  const tampered = { ...e, data: Buffer.from(Buffer.from(e.data, "base64").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64") }
  await assert.rejects(decryptSecrets(tampered, "correct horse"), /密码不正确/)
  const text = JSON.stringify(e)
  for (const v of Object.values(SECRETS)) assert.ok(!text.includes(v))
  assert.deepEqual(e.labels, ["小熊油耗", "沃尔沃（中国）", "高德"])
  // 同一个密钥每次加密的 IV 不同，盐和次数相同；重新设密码换盐
  const again = encryptSecrets(SECRETS, [], key)
  assert.notEqual(again.iv, e.iv)
  assert.deepEqual(again.kdf, e.kdf)
  assert.notEqual((await makeBackupKey("correct horse", { iterations: 1000 })).salt, key.salt)
})

test("派生函数由调用方传入：试算和派生都用它", async () => {
  const calls: number[] = []
  const derive = async (_p: string, _s: unknown, n: number) => { calls.push(n); return Buffer.alloc(32, 7) }
  const key = await makeBackupKey("pw123456", { derive })
  assert.equal(calls[0], 5000, "先试算 5000 次")
  assert.equal(calls[1], key.iterations)
  assert.equal(key.key, Buffer.alloc(32, 7).toString("base64"))
  const e = encryptSecrets(SECRETS, [], key)
  assert.deepEqual((await decryptSecrets(e, "随便什么", derive)).values, SECRETS, "密钥对就能解开")
})

test("钥匙串里的备份密钥：格式不对时为 null", async () => {
  const key = await makeBackupKey("pw123456", { iterations: 1000 })
  assert.deepEqual(parseBackupKey(JSON.stringify(key)), key)
  for (const bad of [null, "", "pw123456", "{}", JSON.stringify({ ...key, iterations: 0 })]) assert.equal(parseBackupKey(bad), null, String(bad))
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

test("凭据加密：标准格式，用 Node 自己的 PBKDF2 和 AES-GCM 也能解开；默认按设备试算次数", async () => {
  const e = encryptSecrets(SECRETS, [], await makeBackupKey("pw123456"))
  assert.ok(e.kdf.iterations >= KDF_MIN_ITERATIONS && e.kdf.iterations <= KDF_ITERATIONS, String(e.kdf.iterations))
  assert.equal(e.kdf.iterations % 10000, 0)
  const key = pbkdf2Sync("pw123456", Buffer.from(e.kdf.salt, "base64"), e.kdf.iterations, 32, "sha256")
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "base64"))
  d.setAAD(Buffer.from("fuelnote-backup/1"))
  d.setAuthTag(Buffer.from(e.tag, "base64"))
  const plain = Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8")
  assert.deepEqual(JSON.parse(plain), SECRETS)
})

function sample(): { ledger: LedgerFile; xxyh: XxyhState } {
  const ledger = emptyLedger()
  ledger.vehicles.push(
    { id: "v1", name: "S90", default_grade: 95, created_ts: 0, xxyh_car: "1000000001", provider: null },
    { id: "v2", name: "小车", default_grade: 92, created_ts: 0, xxyh_car: null, provider: null },
  )
  ledger.records.push(
    { kind: "expense", id: "e1", vehicle_id: "v1", ts: 1, category_id: 100001, amount: 900, remark: "", store_id: "st1" },
    { kind: "maintenance", id: "m1", vehicle_id: "v1", ts: 1, odometer: 80000, items: ["机油"], amount: 900, remark: "", expense_id: "e1" },
  )
  ledger.stores.push({ id: "st1", name: "示例店", full_name: "", address: "", phone: "", lng: null, lat: null })
  ledger.insurance.push({ id: "ins1", vehicle_id: "v1", policies: [], discount: 0, paid_ts: 1, expense_id: null, remark: "" })
  ledger.perks.push({
    id: "p1", vehicle_id: "v1", name: "洗车", kind: "count", total: 5, unit: "次", end_ts: null, store_id: "st1",
    source: "示例洗车卡", insurance_id: null, origin: "other", raw: "", note: "", created_ts: 0,
  })
  ledger.perk_uses.push({ id: "u1", perk_id: "p1", ts: 1, used: 1, expense_id: "e1", note: "" })
  const xxyh: XxyhState = { ...emptyXxyhState(), account_id: "42", nickname: "小熊用户", last_version: 311, last_error: "网络错误" }
  return { ledger, xxyh }
}

const SNAPSHOT = { appVer: "2.3.9", userInfo: { id: 42 }, cars: [{ uuid: "1000000001", name: "S90" }], expenseTypes: [{ _id: 100001, name: "维修保养" }] } as XxyhBackup

test("备份文件：写出再读回内容不变；错误不带进备份；小熊快照只留车、油站和类别；摘要", async () => {
  const { ledger, xxyh } = sample()
  const secrets = encryptSecrets(SECRETS, ["小熊油耗"], await makeBackupKey("pw123456", { iterations: 1000 }))
  const b = makeBackup(ledger, xxyh, SNAPSHOT, "2.0.0", Date.UTC(2026, 9, 19, 2, 30), secrets)
  assert.equal(b.format, BACKUP_FORMAT)
  assert.equal(b.version, 2)
  assert.equal(b.created_at, "2026-10-19T02:30:00.000Z")
  assert.equal(b.xxyh.last_error, null)
  assert.deepEqual(b.xxyh_snapshot, { cars: SNAPSHOT.cars, expenseTypes: SNAPSHOT.expenseTypes })
  const back = parseBackup(JSON.stringify(b))
  assert.deepEqual(back, b)
  assert.deepEqual(summarizeBackup(back), {
    created_at: Date.UTC(2026, 9, 19, 2, 30), app_version: "2.0.0", vehicles: 2, records: 2, insurance_years: 1, benefits: 1,
    xxyh_account: "小熊用户", xxyh_version: 311, problems: [], secrets: ["小熊油耗"],
  })
  const plain = parseBackup(JSON.stringify(makeBackup(ledger, emptyXxyhState(), null, "2.0.0", 0, null)))
  assert.equal(plain.secrets, null)
  assert.equal(plain.xxyh_snapshot, null)
  assert.equal(summarizeBackup(plain).xxyh_account, null)
})

test("备份摘要：列出找不到的引用（恢复前提示）", () => {
  const { ledger, xxyh } = sample()
  const broken: LedgerFile = { ...ledger, stores: [], records: ledger.records.filter(r => r.kind !== "maintenance") }
  broken.perk_uses = [{ ...ledger.perk_uses[0], perk_id: "gone" }]
  const problems = summarizeBackup(parseBackup(JSON.stringify(makeBackup(broken, xxyh, null, "2.0.0", 0, null)))).problems
  assert.ok(problems.length >= 2, problems.join("；"))
})

test("备份文件：不是备份、2.0 以前的备份、更新版本的备份、内容不完整时报出原因", () => {
  const { ledger, xxyh } = sample()
  const good = makeBackup(ledger, xxyh, null, "2.0.0", 0, null) as any
  assert.throws(() => parseBackup("not json"), /无法读取/)
  assert.throws(() => parseBackup(JSON.stringify({ hello: 1 })), /不是油记的备份文件/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, version: 1 })), /2\.0 以前/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, version: 3 })), /更新版本/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, ledger: { ...ledger, schema_version: 1 } })), /账本不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, ledger: { ...ledger, records: null } })), /账本不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, xxyh: { ...xxyh, schema_version: 1 } })), /小熊油耗状态不完整/)
  assert.throws(() => parseBackup(JSON.stringify({ ...good, secrets: { cipher: "aes-128-cbc" } })), /凭据格式/)
})
