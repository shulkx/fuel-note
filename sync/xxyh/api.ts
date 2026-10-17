// 小熊油耗接口：账号、云备份下载与上传、附近油站
import { md5 } from "../../common/hash"
import { randomCode } from "../../common/ids"
import { bd09ToWgs84, LngLat } from "../../common/geo"
import { Poi } from "../../common/types"
import { formEncode, Http, parseJson } from "../../platform/http"
import { XxyhBackup } from "./types"

const API = "https://www.xiaoxiongyouhao.com/api"
/** 与 iOS App 相同：md5 固定盐，不含设备 id */
export const BACKUP_KEY = md5("051f51b60f2611e491910800200c9a66")

export type XxyhErrorKind = "auth" | "server" | "network" | "parse"

export class XxyhError extends Error {
  kind: XxyhErrorKind
  constructor(kind: XxyhErrorKind, message: string) {
    super(message)
    this.name = "XxyhError"
    this.kind = kind
  }
}

/** 粘贴内容可以是 BoxJS 的 xxyh_auth（JSON，含 authToken），也可以只是 token */
export function parseXxyhToken(text: string): string {
  const s = String(text || "").trim()
  if (!s) return ""
  if (s.startsWith("{")) {
    try {
      const v = JSON.parse(s)
      return String(v.authToken || v.auth_token || v.token || "").trim()
    } catch {
      return ""
    }
  }
  return s.replace(/^"|"$/g, "")
}

async function call(http: Http, path: string, opts: { query?: Record<string, string>; form?: Record<string, string> }): Promise<any> {
  let url = `${API}/${path}`
  if (opts.query) url += `?${formEncode(opts.query)}`
  let res
  try {
    res = await http(opts.form
      ? { method: "POST", url, body: formEncode(opts.form), headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }, timeout: 45 }
      : { method: "GET", url, timeout: 30 })
  } catch (error) {
    throw new XxyhError("network", error instanceof Error ? error.message : String(error))
  }
  if (res.status !== 200) throw new XxyhError("server", `小熊油耗返回 HTTP ${res.status}`)
  let body: any
  try { body = parseJson(res, url) } catch { throw new XxyhError("parse", `小熊油耗返回的不是 JSON`) }
  const status = Number(body && body.status)
  if (status !== 0) {
    const message = String((body && body.message) || "请求失败")
    throw new XxyhError(/令牌|token|登录|授权/i.test(message) ? "auth" : "server", `小熊油耗：${message}`)
  }
  return body
}

export type XxyhAccount = { version: number | null; account_id: string; nickname: string }

export async function accountInfo(http: Http, token: string): Promise<XxyhAccount> {
  const b = await call(http, "account_sync.php", { query: { authToken: token, source: "", os_name: "" } })
  const info = b.accountInfo
  if (!info) throw new XxyhError("auth", "小熊油耗：凭据无效或已过期")
  const setting = info.accountSetting || {}
  const v = Number(info.clientBackupVersion)
  return {
    version: Number.isFinite(v) && v > 0 ? v : null,
    account_id: String(setting.account_id || info.accountId || ""),
    nickname: String(setting.nick_alias || ""),
  }
}

export async function downloadBackup(http: Http, token: string, version: number): Promise<XxyhBackup> {
  const b = await call(http, "backup.php", {
    query: { a: "rjsondatabyversion", id: "", key: BACKUP_KEY, backupVersion: String(version), authToken: token },
  })
  const data = typeof b.data === "string" ? JSON.parse(b.data) : b.data
  if (!data || !Array.isArray(data.cars)) throw new XxyhError("parse", "云备份内容无法识别")
  return data as XxyhBackup
}

export async function uploadBackup(http: Http, token: string, doc: XxyhBackup): Promise<{ version: number; warnings: string[] }> {
  const b = await call(http, "backup.php", {
    form: { a: "bjsondata", authToken: token, data: JSON.stringify(doc), key: BACKUP_KEY, reqcode: randomCode(12) },
  })
  const version = Number(b.backupVersion)
  if (!Number.isFinite(version) || version <= 0) throw new XxyhError("parse", "上传后没有返回版本号")
  const warnings = Array.isArray(b.mileageWarnings) ? b.mileageWarnings.map((w: unknown) => String(w)) : []
  return { version, warnings }
}

/** 小熊的附近加油站；坐标带 coordinate_type，没有时是百度坐标 */
export async function aroundPois(http: Http, token: string, wgs: LngLat): Promise<Poi[]> {
  const b = await call(http, "geo/index.php", {
    form: { a: "aroundpois", auth_token: token, coordinate_type: "wgs84", keyword: "加油站", location: `${wgs[0]},${wgs[1]}`, reqcode: randomCode(12) },
  })
  const out: Poi[] = []
  for (const p of (b.pois || []) as any[]) {
    if (Number(p.sType) !== 1) continue
    const [lng, lat] = String(p.location || "").split(",").map(Number)
    if (!lng || !lat) continue
    const w = p.coordinate_type === "wgs84" ? [lng, lat] : bd09ToWgs84([lng, lat])
    out.push({ name: String(p.name || ""), address: String(p.address || ""), province: String(p.province || ""), city: String(p.city || ""), district: String(p.district || ""), lng: w[0], lat: w[1], src: "xxyh" })
  }
  return out
}
