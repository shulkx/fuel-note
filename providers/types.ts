// 车辆数据提供方接口。界面和停车识别只通过这个接口使用各品牌，不认识具体品牌。
import { ProviderId, ServiceTicket, ServiceVisit } from "../common/types"
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

/** 车况（设计文档 18.1 节）：车上报的最后状态，通常是停车熄火时 */
export type VehicleStatus = {
  /** 车况时间（毫秒） */
  ts: number | null
  /** 剩余油量（升） */
  fuel_l: number | null
  /** 续航（km） */
  range_km: number | null
  /** 车机平均油耗（L/100km） */
  avg_consumption: number | null
  /** 里程表（km） */
  odometer_km: number | null
}

export type CredentialField = {
  key: string
  label: string
  placeholder?: string
  hint?: string
  multiline?: boolean
}

export type RemoteVehicle = { id: string; name: string; detail: string }

/** 提供方的会话缓存（一段文本），应用层存进钥匙串，冷启动时少换一次会话 */
export type SessionStore = { get(): string | null; set(value: string | null): void }

export type ProviderContext = { http: Http; now: () => number; sessionStore?: SessionStore }

export type Credential = Record<string, string>

export class ProviderError extends Error {
  kind: "auth" | "network" | "server"
  constructor(kind: ProviderError["kind"], message: string) {
    super(message)
    this.name = "ProviderError"
    this.kind = kind
  }
}

/** 养修：进店列表的一项（2.1.0-beta.5） */
export type ServiceVisitHead = { order_id: string; dealer_code: string; arrive_ts: number; state: string; cancelled: boolean }

/**
 * 一张工单整理出的保养项目（第二行写来自哪个工时）和写进备注的检查、问题。
 * basic_only：这张工单只做了基础保养（不算不记的检查、照片），用来先勾好基础保养的卡（2.1 设计第 12 节）
 */
export type TicketItems = { items: Array<{ name: string; labour: string }>; notes: string[]; basic_only: boolean }

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
  /** 车况（剩余油量等）；不支持的提供方不实现 */
  vehicleStatus?(ctx: ProviderContext, cred: Credential, vehicleId: string): Promise<VehicleStatus>
  /** 养修（2.1.0-beta.5）：费用页那一组的标题（「沃尔沃养修」）；不支持养修的提供方不写，下面三个也不实现 */
  serviceTitle?: string
  /** 进店列表（新的在前，含已取消的） */
  serviceVisits?(ctx: ProviderContext, cred: Credential, vehicleId: string): Promise<ServiceVisitHead[]>
  /** 一次进店的明细；提供方已不保留时 null */
  serviceVisit?(ctx: ProviderContext, cred: Credential, vehicleId: string, head: ServiceVisitHead): Promise<ServiceVisit | null>
  /** 保养项目的整理规则：给出全部养修记录的工时（收集别名），返回整理一张工单的函数 */
  serviceNaming?(labours: string[]): (t: ServiceTicket) => TicketItems
}
