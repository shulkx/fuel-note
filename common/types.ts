// 油记的领域类型。坐标一律 WGS-84，时间一律毫秒时间戳，里程单位公里。

export type ProviderId = "volvo_cn"

export type ProviderLink = {
  id: ProviderId
  /** 提供方那边的车辆标识，例如沃尔沃的 VIN */
  vehicle_id: string
  name: string
}

/**
 * 与小熊车辆对应的资料（设计文档 17.10 节）。本机车辆在添加时填写；小熊车辆从云端的车读取。
 * 车型来自小熊的车型库（品牌 → 车系 → 车型）
 */
export type VehicleProfile = {
  /** 小熊车型 id；没选车型时 null */
  model: number | null
  /** 「沃尔沃S60 2026款 B4 智远运动版」 */
  model_name: string | null
  pinpai: number | null
  chexi: number | null
  /** 小熊的车辆类型：1 汽车 */
  vehicle_type: number | null
  /** 补能方式：1 燃油，2 纯电动，3 插电式混合动力或增程式 */
  replenish_mode: number | null
  /** 车型的标号原文，如「95号」 */
  gas_type: string | null
  /** YYYY-MM-DD */
  buy_date: string | null
}

export type Vehicle = {
  id: string
  name: string
  default_grade: number | null
  created_ts: number
  /** 关联的小熊油耗车辆 uuid；null 表示只在本机 */
  xxyh_car: string | null
  provider: ProviderLink | null
  /** 隐藏：不出现在车辆菜单、统计和小组件里，数据照常保留和同步（1.1.7） */
  hidden?: boolean
  /** 车型、购车日期等；小熊车辆以云端为准，这里只存本机车辆的（1.1.7） */
  profile?: VehicleProfile | null
  /** 云端删除后自动转为本机时，原来的小熊车辆 uuid；重新上传时云端没有这个 uuid 就用回它（设计文档 17.12 节） */
  former_xxyh_car?: string
}

export type FuelData = {
  ts: number
  odometer: number
  liters: number
  price: number
  amount: number
  paid: number
  grade: number | null
  full: boolean
  light_on: boolean
  missed_before: boolean
  station_id: string | null
  remark: string
}

export type ExpenseData = {
  ts: number
  category_id: number
  amount: number
  remark: string
}

export type FuelRecord = FuelData & { kind: "fuel"; id: string; vehicle_id: string }
export type ExpenseRecord = ExpenseData & { kind: "expense"; id: string; vehicle_id: string }
export type MaintenanceRecord = {
  kind: "maintenance"
  id: string
  vehicle_id: string
  ts: number
  odometer: number
  items: string
  amount: number
  remark: string
}

/** 本机车辆保存的记录（保养只来自小熊，不在本机保存） */
export type LocalRecord = FuelRecord | ExpenseRecord

export type RecordOrigin = "local" | "xxyh"
export type LedgerRecord = (FuelRecord | ExpenseRecord | MaintenanceRecord) & {
  origin: RecordOrigin
  /** 有还没上传到小熊的修改 */
  pending: boolean
}

export type Station = {
  id: string
  name: string
  address: string
  province: string
  city: string
  district: string
  lng: number
  lat: number
  /** 最近一次在这里加油的时间，用于排序 */
  last_used_ts: number
}

export type ExpenseCategory = { id: number; name: string; description: string }

/** 保单种类（设计文档 20.4 节）：交强险、商业险、驾乘意外险、其他 */
export type PolicyKind = "compulsory" | "commercial" | "accident" | "other"

/** 保单里的一项：险种、增值服务或保障责任 */
export type PolicyItem = {
  /** 统一名称（common/insurance_catalog.ts）；认不出时为 null */
  key: string | null
  /** 保单上印的名称 */
  name: string
  /** 保险金额或责任限额（元） */
  amount: number | null
  /** 金额以外的写法：「共享保额」「12次」「/」「每人」 */
  amount_text: string
  /** 这一项的保费（元）；没有单独保费时为 null */
  premium: number | null
  /** 服务的次数（道路救援 12 次）；不是服务时为 null */
  times: number | null
}

export type Policy = {
  kind: PolicyKind
  /** 保单标题去掉「（电子保单）」「电子保险单」，例如「机动车商业保险保险单」「平安车主尊享保障」 */
  title: string
  /** 保险公司全称（不含分支机构） */
  insurer: string
  policy_no: string
  /** 北京时间；到期按当天结束 */
  start_ts: number
  end_ts: number
  /** 含税保费 */
  premium: number
  premium_ex_tax: number | null
  tax: number | null
  /** 交强险的浮动比率（%），例如 -40、10 */
  float_rate: number | null
  /** 交强险代收的车船税合计 */
  vehicle_tax: number | null
  /** 保单上的客服、报案电话 */
  phone: string | null
  items: PolicyItem[]
  /** 保单原件：App Group 里 FuelNote/insurance/ 下的相对路径 */
  file: string | null
  /** 识别时没对上的地方，详情里显示 */
  issues: string[]
}

/** 一年的保险：几份保单 + 一笔「保险和交通规费」费用（设计文档 20.4 节） */
export type InsuranceYear = {
  id: string
  vehicle_id: string
  policies: Policy[]
  /** 优惠、返现（元） */
  discount: number
  /** 付款日期 = 费用记录的时间 */
  paid_ts: number
  /** 对应的费用记录；小熊车辆是 x:<car>:e:<date>，保存后才知道，所以可能暂时为 null */
  expense_id: string | null
  remark: string
}

/** 附近搜索的结果（WGS-84） */
export type Poi = {
  name: string
  address: string
  province: string
  city: string
  district: string
  lng: number
  lat: number
  src: "amap" | "xxyh"
}

/** 选油站时的候选：已有油站，或保存时新建的油站 */
export type StationCandidate =
  | { kind: "mine"; station: Station; dist: number | null }
  | { kind: "new"; station: Station; dist: number | null; src: Poi["src"] }

export type StationSearchMode = "auto" | "amap" | "xxyh" | "off"

/** 截图识别用哪一种来源（只用这一种）：本机 iOS 文字识别，或大模型（Azure OpenAI、Scripting 助手）。以后可能加小熊识别 */
export type OcrEngine = "local" | "azure" | "assistant"

/** Scripting 助手用哪个账号的哪个模型（账号在 Scripting 里配置，油记只记编号） */
export type AssistantModel = { providerID: string; modelId: string; name: string }

export type Settings = {
  current_vehicle_id: string | null
  default_full: boolean
  xxyh_auto_upload: boolean
  station_search: StationSearchMode
  /** 记录页顶部提示里点了「×」的加油停车（熄火时间），只留最近 20 个 */
  dismissed_stops: number[]
  ocr_engine: OcrEngine
  /** null：用 Scripting 的默认账号和模型 */
  ocr_assistant: AssistantModel | null
  /** 点了「×」的续保提醒（保险年度 id，1.5） */
  dismissed_renewals?: string[]
}

export type LedgerFile = {
  schema_version: 1
  vehicles: Vehicle[]
  records: LocalRecord[]
  stations: Station[]
  expense_categories: ExpenseCategory[]
  settings: Settings
  /** 小熊里不加到油记的车（用户选了忽略，或转为本机车辆的）uuid（1.1.8） */
  xxyh_ignored_cars?: string[]
  /** 每年的保险（1.5）；只存在本机，小熊车辆也存在这里 */
  insurance?: InsuranceYear[]
}

/** 与小熊油耗相同的编号，本机车辆以后关联小熊时不用换编号 */
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 100000, name: "行车费", description: "高速费、过桥费、停车费等" },
  { id: 100001, name: "维修保养", description: "维修、保养、洗车、美容等" },
  { id: 100002, name: "保险和交通规费", description: "保险、车船税、年检等" },
  { id: 100003, name: "其他", description: "违章罚款、改装等" },
]

export const GRADES = [92, 95, 98, 0]

export function gradeText(grade: number | null): string {
  if (grade == null) return "未填"
  if (grade === 0) return "0#柴油"
  return `${grade}#`
}

export function defaultSettings(): Settings {
  return { current_vehicle_id: null, default_full: true, xxyh_auto_upload: true, station_search: "auto", dismissed_stops: [], ocr_engine: "local", ocr_assistant: null }
}

export function emptyLedger(): LedgerFile {
  return {
    schema_version: 1,
    vehicles: [],
    records: [],
    stations: [],
    expense_categories: DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c })),
    settings: defaultSettings(),
  }
}

export function isFuel(r: { kind: string }): r is FuelRecord {
  return r.kind === "fuel"
}
