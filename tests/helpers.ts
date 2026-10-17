// 测试工具。真实数据只从 XXYH_ROOT（E:\GitHub\xxyh）读取，不提交到本仓库。
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { FuelData, FuelRecord } from "../common/types"
import { Http } from "../platform/http"

export const XXYH_ROOT = process.env.XXYH_ROOT || ""
export const LIVE = process.env.LIVE === "1"

export function fuel(id: string, d: Partial<FuelData>): FuelRecord {
  return {
    kind: "fuel", id, vehicle_id: "v1",
    ts: 0, odometer: 0, liters: 40, price: 8, amount: 320, paid: 320, grade: 95,
    full: true, light_on: false, missed_before: false, station_id: null, remark: "",
    ...d,
  }
}

/** 最新的已下载云备份（out/xxyh_backup_v<N>.json） */
export function latestBackupFile(): string | null {
  if (!XXYH_ROOT) return null
  const dir = join(XXYH_ROOT, "out")
  if (!existsSync(dir)) return null
  const files = readdirSync(dir).map(f => /^xxyh_backup_v(\d+)\.json$/.exec(f)).filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
  return files.length ? join(dir, files[0][0]) : null
}

export function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""))
}

/** 抓包里最新的小熊 token（account_sync 请求） */
export function xxyhTokenFromHar(): string | null {
  if (!XXYH_ROOT) return null
  const dir = join(XXYH_ROOT, "materials")
  const found: Array<[string, string]> = []
  for (const f of readdirSync(dir).filter(f => f.endsWith(".har"))) {
    let entries: any[]
    try { entries = readJson(join(dir, f)).log.entries } catch { continue }
    for (const e of entries) {
      if (!String(e.request.url).includes("/api/account_sync.php")) continue
      const t = new URL(e.request.url).searchParams.get("authToken")
      if (t) found.push([e.startedDateTime, t])
    }
  }
  found.sort()
  return found.length ? found[found.length - 1][1] : null
}

/** Node 的 fetch；POST 一律拒绝，在线测试绝不写入 */
export const readOnlyHttp: Http = async req => {
  if ((req.method || "GET") !== "GET" && !/geo\/index\.php/.test(req.url)) throw new Error(`测试禁止写入：${req.url}`)
  const res = await fetch(req.url, { method: req.method || "GET", headers: req.headers, body: req.body, signal: AbortSignal.timeout((req.timeout || 30) * 1000) })
  return { status: res.status, text: await res.text() }
}
