// 沃尔沃（中国）：用 App 的 refresh token 换会话，读取绑定车辆和行程日志。
// 签名 v587sign（HMAC-SHA256），与沃尔沃 App 5.70 相同；行程坐标是 GCJ-02，里程单位米。
import { gcj02ToWgs84 } from "../common/geo"
import { hex, hmacSha256, sha256, sha256Bytes, utf8 } from "../common/hash"
import { Http, HttpResponse } from "../platform/http"
import { grpcFrame, grpcHasMessage, grpcMessages, PbMessage, pbDump, pbMessage, pbNumber, pbString, pbSubmessage, pbTimestamp } from "./grpc"
import { Credential, Place, ProviderContext, ProviderError, RemoteVehicle, Trip, VehicleDataProvider, VehicleStatus } from "./types"

const GATEWAY = "apigateway.digitalvolvo.com"
const SIGNING_KEY = "bjGqb3TvEEZ8W8QhoyhEH4IenwCnc4JQ"
const ACCESS = "204114990"
const JOURNAL = "https://cepmobtoken.lbs.prod.c3.volvocars.com.cn/journallog-trip-api/vehicles/"
/** 车况接口（gRPC，设计文档 18.1 节）。与行程用同一个 globalAccessToken */
const STATES = "https://cepmobtoken.prod.c3.volvocars.com.cn/services.vehiclestates."

type Session = { accessToken: string; jwtToken: string; globalAccessToken: string; expiresAt: number }

/** 会话先看内存，再看应用层的缓存（ctx.sessionStore）；都没有或快过期时重新换。会话有效 30 分钟 */
const sessions = new Map<string, Session>()

/** 缓存的会话带 refresh token 的指纹，换了凭据就不再使用 */
const fingerprint = (rt: string) => sha256(rt).slice(0, 16)

function storedSession(ctx: ProviderContext, fp: string): Session | null {
  try {
    const raw = ctx.sessionStore ? ctx.sessionStore.get() : null
    const v = raw ? JSON.parse(raw) : null
    if (!v || v.fp !== fp || !v.globalAccessToken || !Number(v.expiresAt)) return null
    return { accessToken: String(v.accessToken), jwtToken: String(v.jwtToken), globalAccessToken: String(v.globalAccessToken), expiresAt: Number(v.expiresAt) }
  } catch {
    return null
  }
}

const rfc3986 = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** 生成签名请求的 URL 和请求头（导出给测试）。POST 的请求体同样不签（UNSIGNED-PAYLOAD），只是签名里的方法换成 POST */
export function signRequest(path: string, query: Record<string, string>, session: Session | null, now: Date, method: "GET" | "POST" = "GET"): { url: string; headers: Record<string, string> } {
  const queryString = Object.keys(query).sort().map(k => `${rfc3986(k)}=${rfc3986(query[k])}`).join("&")
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const headers: Record<string, string> = { host: GATEWAY, "x-sdk-content-sha256": "UNSIGNED-PAYLOAD", "x-sdk-date": timestamp }
  if (session) {
    headers.authorization = `Bearer ${session.accessToken}`
    headers["x-token"] = session.jwtToken
  }
  const names = Object.keys(headers).sort()
  const canonical = `${method}\n${path}/\n${queryString}\n${names.map(n => `${n}:${headers[n]}`).join("\n")}\n\n${names.join(";")}\nUNSIGNED-PAYLOAD`
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

async function request(http: Http, url: string, headers: Record<string, string>, post: string | null = null): Promise<{ status: number; body: any }> {
  let res: HttpResponse
  try {
    res = await http(post == null ? { method: "GET", url, headers, timeout: 30 } : { method: "POST", url, headers, body: post, timeout: 30 })
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
  const fp = fingerprint(rt)
  if (!force) {
    const cached = sessions.get(rt) || storedSession(ctx, fp)
    if (cached && cached.expiresAt - ctx.now() > 120e3) {
      sessions.set(rt, cached)
      return cached
    }
  }
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
  try { if (ctx.sessionStore) ctx.sessionStore.set(JSON.stringify({ ...s, fp })) } catch { /* 下次冷启动重新换 */ }
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

/** 车况请求：gRPC 帧里只有字段 2 = VIN（与 App 的请求相同，导出给测试） */
export const statusRequestBody = (vin: string) => grpcFrame(pbString(2, vin))

/**
 * GetFuel 的响应 → 车况。字段含义取自官方 App 的 proto（开源项目 hass-volvooncall-cn、xiaowo-remote 整理）：
 * 3.1 时间，3.2 续航（km），3.3 平均油耗（L/100km），3.4 剩余油量（升），3.5 续航（英里），3.6 自动行程平均油耗
 */
export function parseFuel(m: PbMessage): Pick<VehicleStatus, "ts" | "fuel_l" | "range_km" | "avg_consumption"> {
  const s = pbSubmessage(m, 3)
  if (!s) return { ts: null, fuel_l: null, range_km: null, avg_consumption: null }
  const round = (n: number | null, d: number) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d)
  return { ts: pbTimestamp(pbSubmessage(s, 1)), fuel_l: round(pbNumber(s, 4), 1), range_km: pbNumber(s, 2), avg_consumption: round(pbNumber(s, 3), 2) }
}

/** GetOdometer 的响应 → 里程表（km）。字段 3.2 是米 */
export function parseOdometer(m: PbMessage): Pick<VehicleStatus, "ts" | "odometer_km"> {
  const s = pbSubmessage(m, 3)
  const meters = s ? pbNumber(s, 2) : null
  return { ts: s ? pbTimestamp(pbSubmessage(s, 1)) : null, odometer_km: meters == null ? null : Math.round(meters) / 1000 }
}

/** 诊断用：车况请求的地址、请求头、请求体（含新换的会话）。只给设置页的「诊断请求方式」用 */
export async function volvoStatusRequest(ctx: ProviderContext, cred: Credential, vin: string): Promise<{ url: string; headers: Record<string, string>; body: Uint8Array }> {
  const s = await session(ctx, cred)
  return {
    url: `${STATES}fuel.FuelService/GetFuel`,
    headers: { authorization: `Bearer ${s.globalAccessToken}`, vin, "content-type": "application/grpc", te: "trailers", "user-agent": "dart-grpc/2.0.0" },
    body: statusRequestBody(vin),
  }
}

/** 调用一个车况接口，返回第一条消息。车况接口是流式的（stream，服务器推完不结束），读到第一条就断开 */
async function grpcCall(ctx: ProviderContext, s: Session, vin: string, service: string): Promise<{ status: number; message: PbMessage | null }> {
  let res
  try {
    res = await ctx.http({
      method: "POST",
      url: `${STATES}${service}`,
      headers: { authorization: `Bearer ${s.globalAccessToken}`, vin, "content-type": "application/grpc", te: "trailers", "user-agent": "dart-grpc/2.0.0" },
      bodyBytes: statusRequestBody(vin),
      binary: true,
      stopWhen: grpcHasMessage,
      timeout: 30,
    })
  } catch (error) {
    throw new ProviderError("network", error instanceof Error ? error.message : String(error))
  }
  if (res.status === 401) return { status: 401, message: null }
  const grpcStatus = res.headers ? res.headers["grpc-status"] : undefined
  if (res.status !== 200 || (grpcStatus && grpcStatus !== "0")) {
    const why = res.headers && res.headers["grpc-message"] ? `：${decodeURIComponent(res.headers["grpc-message"])}` : ""
    throw new ProviderError("server", `读取沃尔沃车况失败（HTTP ${res.status}${grpcStatus ? `，gRPC ${grpcStatus}` : ""}${why}）`)
  }
  const messages = grpcMessages(res.bytes || new Uint8Array(0))
  if (!messages.length) throw new ProviderError("server", "沃尔沃车况为空")
  return { status: 200, message: pbMessage(messages[0]) }
}

/**
 * 网关上的一次签名请求（养修记录等 App 接口，返回 {code, data, msg}）。body 不为 null 时发 POST（JSON）。
 * 会话失效（HTTP 401 或 code 401）时换一次会话再试
 */
export async function volvoGateway(ctx: ProviderContext, cred: Credential, path: string, query: Record<string, string>, body: unknown = null): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await session(ctx, cred, attempt > 0)
    const req = signRequest(path, query, s, new Date(ctx.now()), body == null ? "GET" : "POST")
    const res = await request(ctx.http, req.url, req.headers, body == null ? null : JSON.stringify(body))
    if ((res.status === 401 || Number(res.body && res.body.code) === 401) && attempt === 0) continue
    if (res.status !== 200) throw new ProviderError("server", `沃尔沃接口失败（HTTP ${res.status}）：${path}`)
    return res.body
  }
  throw new ProviderError("auth", "沃尔沃会话已失效")
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
  async vehicleStatus(ctx, cred, vin): Promise<VehicleStatus> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const s = await session(ctx, cred, attempt > 0)
      const [fuel, odo] = await Promise.all([
        grpcCall(ctx, s, vin, "fuel.FuelService/GetFuel"),
        grpcCall(ctx, s, vin, "odometer.OdometerService/GetOdometer"),
      ])
      if ((fuel.status === 401 || odo.status === 401) && attempt === 0) continue // 会话失效，重新换一次
      if (!fuel.message || !odo.message) break
      const f = parseFuel(fuel.message)
      const o = parseOdometer(odo.message)
      const sub = (m: PbMessage) => pbSubmessage(m, 3)
      return {
        ...f,
        ts: f.ts ?? o.ts,
        odometer_km: o.odometer_km,
        raw: [
          `GetFuel ${sub(fuel.message) ? pbDump(sub(fuel.message)!).join(" ") : "（没有字段 3）"}`,
          `GetOdometer ${sub(odo.message) ? pbDump(sub(odo.message)!).join(" ") : "（没有字段 3）"}`,
        ],
      }
    }
    throw new ProviderError("auth", "沃尔沃会话已失效")
  },
}
