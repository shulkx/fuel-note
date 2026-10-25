// 备份密码派生密钥用的 PBKDF2-HMAC-SHA256（一块 32 字节），用 Scripting 原生的 Crypto.hmacSHA256 逐轮算。
// Scripting 的 Node 兼容 crypto.pbkdf2Sync / pbkdf2 是 JS 实现：手机上 10 万次 8–13 秒，异步写法也占住线程；WebCrypto 没有 PBKDF2。
// 原生 HMAC 10 万次约 0.9 秒，结果和标准 PBKDF2 相同；每 2000 轮让出一次，界面照常响应（2.0.0-beta.5 用 FuelNote Check 在手机上量过）。

const CHUNK = 2000

/** 返回 Buffer（common/backup.ts 的 Bytes） */
export async function nativePbkdf2(password: string, salt: any, iterations: number): Promise<any> {
  const key = Data.fromRawString(password, "utf-8") ?? Data.fromIntArray([])
  let u = Crypto.hmacSHA256(Data.combine([Data.fromIntArray(Array.from(salt as Uint8Array)), Data.fromIntArray([0, 0, 0, 1])]), key)
  const t = Uint8Array.from(u.toIntArray())
  for (let i = 1; i < iterations; i++) {
    u = Crypto.hmacSHA256(u, key)
    const b = u.toUint8Array() as Uint8Array
    for (let j = 0; j < 32; j++) t[j] ^= b[j]
    if (i % CHUNK === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
  }
  return Buffer.from(t)
}
