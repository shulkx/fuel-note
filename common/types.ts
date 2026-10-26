// 油记的领域类型。坐标一律 WGS-84，时间一律毫秒时间戳，里程单位公里。

export type ProviderId = "volvo_cn"

export type ProviderLink = {
  id: ProviderId
  /** 提供方那边的车辆标识，例如沃尔沃的 VIN */
  vehicle_id: string
  name: string
}

/** 车辆资料（设计文档 17.10 节）：添加车辆时填写，从小熊导入时取那辆车的；车型来自小熊的车型库（品牌 → 车系 → 车型） */
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
  /** 导出到小熊油耗的哪辆车（uuid）；null 不导出。2.0 起数据都存在本机，和它无关 */
  xxyh_car: string | null
  provider: ProviderLink | null
  /** 隐藏：不出现在车辆菜单、统计和小组件里，数据照常保留（1.1.7） */
  hidden?: boolean
  /** 车型、购车日期等（1.1.7；从小熊导入的车在导入时复制过来） */
  profile?: VehicleProfile | null
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

/** 小熊这条记录导入时的原样（fuelRecords / expenseRecords / maintainRecords 里的一项）；导出时以它为底，只覆盖改过的字段 */
export type XxyhRaw = Record<string, unknown>

export type FuelRecord = FuelData & { kind: "fuel"; id: string; vehicle_id: string; xxyh_raw?: XxyhRaw }
export type ExpenseRecord = ExpenseData & {
  kind: "expense"
  id: string
  vehicle_id: string
  /** 在哪家店（stores 里的 id）；没有门店时不写。备注只存用户写的内容 */
  store_id?: string
  xxyh_raw?: XxyhRaw
}
export type MaintenanceRecord = {
  kind: "maintenance"
  id: string
  vehicle_id: string
  ts: number
  odometer: number
  items: string[]
  amount: number
  remark: string
  /** 同时记的那笔维修保养费用；没有时不写 */
  expense_id?: string
  xxyh_raw?: XxyhRaw
}

/** 账本里的一条记录（2.0 起所有车辆的记录都存在本机） */
export type LocalRecord = FuelRecord | ExpenseRecord | MaintenanceRecord
export type LedgerRecord = LocalRecord

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
  /** 交强险标志的原件（PDF 或图片，相对路径同 file）：只在交强险上，没有时不写（1.5.0-beta.6） */
  mark?: string
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
  /** 对应的「保险和交通规费」费用的 id；只记保险、没有费用时为 null */
  expense_id: string | null
  remark: string
  /** 附件：选了但没认出是保单的 PDF（交强险标志、读不出内容的文件），只存原件，相对路径同 Policy.file；没有时不写 */
  attachments?: string[]
}

// ---------- 权益（1.7，权益设计 docs/specs/2026-10-23-benefits-wallet.md）：只存在本机，进备份 ----------

/** 我的门店：费用和权益卡都存它的 id，改名后到处跟着变（2.1 起来自高德） */
/**
 * 我的门店（2.1 设计第 10 节）：每一家都是高德上的一个地点。
 * name 是费用页和导出到小熊的费用备注里写的名称，从高德选中时默认取高德的名称（去掉括号里的分店名），可以改；其余是高德的资料
 */
export type Store = {
  id: string
  name: string
  full_name: string
  address: string
  phone: string
  /** 高德的营业时间 */
  hours: string
  /** 高德地点 id；选中高德里同一个地点时用已有的那一家 */
  poi_id: string
  /** WGS-84（高德的 GCJ-02 读进来时换算） */
  lng: number | null
  lat: number | null
  /** 车辆数据提供方的经销商代码（2.1.0-beta.5 起从养修记录对上） */
  dealer: { provider: string; code: string } | null
}

/** 高德上的一个汽车服务地点（选择门店的附近和搜索结果） */
export type StorePoi = {
  poi_id: string
  name: string
  address: string
  district: string
  city: string
  /** 「汽车销售 · 汽车维修」 */
  kind: string
  lng: number
  lat: number
  phone: string
  hours: string
  /** 周边搜索时离中心点的米数 */
  distance: number | null
}

/** 一张权益卡的类型：储值（一笔钱，分几次用，按金额抵扣）、次数（一项服务或一张券，用掉几次，不抵钱；抵用券也按次数记，单位「张」） */
export type PerkKind = "balance" | "count"

/** 添加时选的是哪一类：车险赠送、保养套餐、其他（只决定图标的颜色和添加表单的字段） */
export type PerkOrigin = "insurance" | "package" | "other"

/** 一张权益卡：一项赠送、一张抵用券、套餐里的一项服务。来自只是标签，有效期、门店都存在卡上，不跟随别处；不记价值（用户 2026-10-23：免得被宣传的价值误导） */
export type Perk = {
  id: string
  vehicle_id: string
  name: string
  kind: PerkKind
  /** 储值是元，次数是次（或张、面、瓶） */
  total: number
  unit: string
  /** 有效期至（北京时间那一天结束）；null = 不限 */
  end_ts: number | null
  /** 门店（我的门店的 id）；没填时没有这个字段 */
  store_id?: string
  /** 来自：「2026 车险」「回馈季保养套餐」；同一来自的卡放在一起显示 */
  source: string
  /** 来自某一年的车险时填，只用来在保单详情和续保提醒里找到它 */
  insurance_id: string | null
  origin: PerkOrigin
  /** 添加时粘贴的原文（同一批的卡各存一份） */
  raw: string
  note: string
  created_ts: number
}

/** 一次使用 */
export type PerkUse = {
  id: string
  perk_id: string
  ts: number
  /** 储值是元，次数是次（或张、面、瓶） */
  used: number
  /** 用在哪一笔费用上（费用的 id）；null = 记一次使用。用来跳转，删除费用时一起删除 */
  expense_id: string | null
  note: string
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

/** 搜不搜附近的油站：auto = 有高德 key 用高德，否则用小熊；off = 只用我的油站（2.0 起只有这两种，旧的 amap、xxyh 读成 auto） */
export type StationSearchMode = "auto" | "off"

/** 截图识别用哪一种来源（只用这一种）：本机 iOS 文字识别，或大模型（Azure OpenAI、Scripting 助手）。以后可能加小熊识别 */
export type OcrEngine = "local" | "azure" | "assistant"

/** Scripting 助手用哪个账号的哪个模型（账号在 Scripting 里配置，油记只记编号） */
export type AssistantModel = { providerID: string; modelId: string; name: string }

export type Settings = {
  current_vehicle_id: string | null
  default_full: boolean
  station_search: StationSearchMode
  /** 记录页顶部提示里点了「×」的加油停车（熄火时间），只留最近 20 个 */
  dismissed_stops: number[]
  ocr_engine: OcrEngine
  /** null：用 Scripting 的默认账号和模型 */
  ocr_assistant: AssistantModel | null
  /** 点了「×」的续保提醒（保险年度 id，只留最近 20 个） */
  dismissed_renewals: string[]
  /** 每天自动备份到 iCloud 云盘（2.0 设计第 6 节） */
  auto_backup: boolean
}

/** 账本（2.0 的格式，ledger2.json）：所有车辆的记录、保险、权益、门店都在这里 */
export type LedgerFile = {
  schema_version: 2
  vehicles: Vehicle[]
  records: LocalRecord[]
  stations: Station[]
  expense_categories: ExpenseCategory[]
  /** 每年的保险（1.5） */
  insurance: InsuranceYear[]
  /** 权益（1.7）：我的门店、权益卡、使用记录 */
  stores: Store[]
  perks: Perk[]
  perk_uses: PerkUse[]
  settings: Settings
}

/** 与小熊油耗相同的编号，导出到小熊时不用换 */
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
  return { current_vehicle_id: null, default_full: true, station_search: "auto", dismissed_stops: [], ocr_engine: "local", ocr_assistant: null, dismissed_renewals: [], auto_backup: true }
}

export function emptyLedger(): LedgerFile {
  return {
    schema_version: 2,
    vehicles: [],
    records: [],
    stations: [],
    expense_categories: DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c })),
    insurance: [],
    stores: [],
    perks: [],
    perk_uses: [],
    settings: defaultSettings(),
  }
}

