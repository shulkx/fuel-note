// 沃尔沃（中国）：用 App 的 refresh token 换会话，读取绑定车辆和行程日志。
// 签名 v587sign（HMAC-SHA256），与沃尔沃 App 5.70 相同；行程坐标是 GCJ-02，里程单位米。
import { gcj02ToWgs84 } from "../common/geo"
import { hex, hmacSha256, sha256Bytes, utf8 } from "../common/hash"
import { Http, HttpResponse } from "../platform/http"
import { Credential, Place, ProviderContext, ProviderError, RemoteVehicle, Trip, VehicleDataProvider } from "./types"

const GATEWAY = "apigateway.digitalvolvo.com"
const SIGNING_KEY = "bjGqb3TvEEZ8W8QhoyhEH4IenwCnc4JQ"
const ACCESS = "204114990"
const JOURNAL = "https://cepmobtoken.lbs.prod.c3.volvocars.com.cn/journallog-trip-api/vehicles/"

type Session = { accessToken: string; jwtToken: string; globalAccessToken: string; expiresAt: number }

/** 会话只缓存在内存里，App 每次启动重新换一次 */
const sessions = new Map<string, Session>()

const rfc3986 = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** 生成签名请求的 URL 和请求头（导出给测试） */
export function signRequest(path: string, query: Record<string, string>, session: Session | null, now: Date): { url: string; headers: Record<string, string> } {
  const queryString = Object.keys(query).sort().map(k => `${rfc3986(k)}=${rfc3986(query[k])}`).join("&")
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const headers: Record<string, string> = { host: GATEWAY, "x-sdk-content-sha256": "UNSIGNED-PAYLOAD", "x-sdk-date": timestamp }
  if (session) {
    headers.authorization = `Bearer ${session.accessToken}`
    headers["x-token"] = session.jwtToken
  }
  const names = Object.keys(headers).sort()
  const canonical = `GET\n${path}/\n${queryString}\n${names.map(n => `${n}:${headers[n]}`).join("\n")}\n\n${names.join(";")}\nUNSIGNED-PAYLOAD`
  const signature = hmacSha256(SIGNING_KEY, `SDK-HMAC-SHA256\n${timestamp}\n${hex(sha256Bytes(utf8(canonical)))}`)
  const send: Record<string, string> = { ...headers }
  delete send.host
  return {
    url: `https://${GATEWAY}${path}${queryString ? `?${queryString}` : ""}`,
    headers: {
      ...send, version: "5.70.2", "User-Agent": "ios.volvo.car", "Content-Type": "application/json; charset=UTF-8",
      v587sign: `SDK-HMAC-SHA256 Access=${ACCESS}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
    },
  }
}

async function request(http: Http, url: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  let res: HttpResponse
  try {
    res = await http({ method: "GET", url, headers, timeout: 30 })
  } catch (error) {
    throw new ProviderError("network", error instanceof Error ? error.message : String(error))
  }
  try {
    return { status: res.status, body: JSON.parse(res.text) }
  } catch {
    throw new ProviderError("server", `沃尔沃返回的不是 JSON（HTTP ${res.status}）`)
  }
}

async function session(ctx: ProviderContext, cred: Credential, force = false): Promise<Session> {
  const rt = cred.refreshToken
  const cached = sessions.get(rt)
  if (!force && cached && cached.expiresAt - ctx.now() > 120e3) return cached
  const req = signRequest("/app/iam/api/v1/refreshToken", { refreshToken: rt }, null, new Date(ctx.now()))
  const { body } = await request(ctx.http, req.url, req.headers)
  const d = body && body.data
  if (Number(body && body.code) !== 200 || !d || !d.globalAccessToken) {
    throw new ProviderError("auth", `沃尔沃凭据无效：${(body && body.msg) || "响应无效"}`)
  }
  const s: Session = {
    accessToken: d.accessToken, jwtToken: d.jwtToken, globalAccessToken: d.globalAccessToken,
    expiresAt: ctx.now() + (Number(d.expiresIn) || 1800) * 1000,
  }
  sessions.set(rt, s)
  return s
}

function place(p: any): Place | null {
  if (!p || !p.longitude || !p.latitude) return null
  const [lng, lat] = gcj02ToWgs84([Number(p.longitude), Number(p.latitude)])
  return { lng, lat, address: String(p.streetAddress || p.streetName || ""), city: String(p.city || ""), district: String(p.region || "") }
}

/** 行程日志的一条 → Trip（导出给测试） */
export function mapVolvoTrip(t: any): Trip | null {
  const d = t && Array.isArray(t.tripDetails) ? t.tripDetails[0] : null
  if (!d || !d.endTime || d.endOdometer == null) return null
  return {
    id: String(t.id || `${d.startTime}`),
    start_ts: Number(d.startTime),
    end_ts: Number(d.endTime),
    start_odometer_km: d.startOdometer != null ? Number(d.startOdometer) / 1000 : null,
    end_odometer_km: Number(d.endOdometer) / 1000,
    distance_km: d.distance != null ? Number(d.distance) / 1000 : null,
    fuel_l: d.fuelConsumption != null ? Number(d.fuelConsumption) : null,
    start: place(d.startPosition),
    end: place(d.endPosition),
  }
}

/** 粘贴内容可以是 BoxJS 的 volvo_auth（JSON，含 refreshToken），也可以只是 refresh token */
export function parseRefreshToken(text: string): string {
  const s = String(text || "").trim()
  if (!s) return ""
  if (s.startsWith("{")) {
    try { return String(JSON.parse(s).refreshToken || "").trim() } catch { return "" }
  }
  return s.replace(/^"|"$/g, "")
}

export const volvoCn: VehicleDataProvider = {
  id: "volvo_cn",
  name: "沃尔沃（中国）",
  description: "读取沃尔沃 App 的行程日志：结束时的里程和地点。行程只保留最近 400 天。",
  credentialFields: [{
    key: "refreshToken",
    label: "refresh token",
    placeholder: "粘贴 BoxJS 的 volvo_auth，或单独的 refresh token",
    hint: "在 Surge 中启用「沃尔沃 · 凭据抓取」并打开沃尔沃 App，然后在 BoxJS 中复制 volvo_auth。",
    multiline: true,
  }],
  normalizeCredential(input) {
    const rt = parseRefreshToken(input.refreshToken || "")
    if (!rt) throw new ProviderError("auth", "没有识别出 refresh token")
    return { refreshToken: rt }
  },
  async listVehicles(ctx, cred): Promise<RemoteVehicle[]> {
    const s = await session(ctx, cred, true)
    const req = signRequest("/app/account/vehicles/api/v1/owner/listBindCar", {}, s, new Date(ctx.now()))
    const { body } = await request(ctx.http, req.url, req.headers)
    const cars: any[] = (body && body.data) || []
    const out = cars.filter(c => c && c.vinCode).map(c => ({
      id: String(c.vinCode),
      name: String(c.seriesName || c.modelName || c.carName || "沃尔沃"),
      detail: `VIN …${String(c.vinCode).slice(-6)}`,
    }))
    if (!out.length) throw new ProviderError("server", "沃尔沃账号下没有绑定车辆")
    return out
  },
  async fetchTrips(ctx, cred, vin, range): Promise<Trip[]> {
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
    const url = `${JOURNAL}${vin}/trips?quantity=0&startDate=${encodeURIComponent(iso(range.from))}&stopDate=${encodeURIComponent(iso(range.to))}&tripsWithoutLocations=INCLUDE`
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await session(ctx, cred, attempt > 0)
      const { status, body } = await request(ctx.http, url, {
        authorization: `Bearer ${s.globalAccessToken}`, vin, "user-agent": "vca_ios/5.71.0",
        accept: "application/json; charset=utf-8", "content-type": "application/json; charset=utf-8",
      })
      if (status === 401 && attempt === 0) continue // 会话失效，重新换一次
      if (status !== 200 || !body || !Array.isArray(body.trips)) throw new ProviderError("server", `读取沃尔沃行程失败（HTTP ${status}）`)
      return body.trips.map(mapVolvoTrip).filter((t: Trip | null): t is Trip => !!t).sort((a: Trip, b: Trip) => a.start_ts - b.start_ts)
    }
    throw new ProviderError("auth", "沃尔沃会话已失效")
  },
}
