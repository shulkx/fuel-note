// 车辆数据提供方接口。界面和停车识别只通过这个接口使用各品牌，不认识具体品牌。
import { ProviderId } from "../common/types"
import { Http } from "../platform/http"

export type Place = {
  /** WGS-84 */
  lng: number
  lat: number
  address: string
  city: string
  district: string
}

export type Trip = {
  id: string
  start_ts: number
  end_ts: number
  start_odometer_km: number | null
  end_odometer_km: number
  distance_km: number | null
  fuel_l: number | null
  start: Place | null
  end: Place | null
}

export type CredentialField = {
  key: string
  label: string
  placeholder?: string
  hint?: string
  multiline?: boolean
}

export type RemoteVehicle = { id: string; name: string; detail: string }

export type ProviderContext = { http: Http; now: () => number }

export type Credential = Record<string, string>

export class ProviderError extends Error {
  kind: "auth" | "network" | "server"
  constructor(kind: ProviderError["kind"], message: string) {
    super(message)
    this.name = "ProviderError"
    this.kind = kind
  }
}

export type VehicleDataProvider = {
  id: ProviderId
  name: string
  description: string
  credentialFields: CredentialField[]
  /** 整理用户粘贴的内容，例如从 BoxJS 的 JSON 里取出需要的字段；缺少必填项时抛错 */
  normalizeCredential(input: Credential): Credential
  /** 读取账号下的车辆，同时用来校验凭据 */
  listVehicles(ctx: ProviderContext, cred: Credential): Promise<RemoteVehicle[]>
  /** 时间范围内的行程，按开始时间升序 */
  fetchTrips(ctx: ProviderContext, cred: Credential, vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
}
