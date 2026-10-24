// 小熊油耗云备份的原始结构（只列出用到的字段，其余字段原样保留）

export type XxyhFuel = {
  date: number
  odometer: number
  fueledLiter?: number
  price?: number
  yuan?: number
  payYuan?: number
  type?: number
  gassup?: boolean
  lightOn?: boolean
  forget?: boolean
  stationId?: string
  remark?: string
  replenishType?: number
  wc_id?: number
  carId?: number | string
  [key: string]: unknown
}

export type XxyhExpense = {
  date: number
  type?: number
  expense?: number
  description?: string
  wc_id?: number
  carId?: number | string
  [key: string]: unknown
}

export type XxyhMaintain = {
  dateTime: number
  currentMileage?: number
  maintains?: string
  customMaintains?: string
  spend?: number
  message?: string
  [key: string]: unknown
}

export type XxyhCar = {
  uuid: string | number
  name?: string
  selected?: number
  fuelRecords?: XxyhFuel[]
  expenseRecords?: XxyhExpense[]
  maintainRecords?: XxyhMaintain[]
  [key: string]: unknown
}

export type XxyhStation = {
  id: string | number
  name?: string
  address?: string
  province?: string
  city?: string
  area?: string
  longitudeE6?: number
  latitudeE6?: number
  coordinate_type?: string
  timeStamp?: number
  [key: string]: unknown
}

export type XxyhExpenseType = { _id: number; name?: string; description?: string; [key: string]: unknown }

export type XxyhBackup = {
  cars: XxyhCar[]
  myStations?: { stations?: XxyhStation[]; [key: string]: unknown }
  expenseTypes?: XxyhExpenseType[]
  [key: string]: unknown
}

/**
 * 小熊油耗的状态（2.0 的格式，xxyh2.json）：只留账号和上次导入、导出的信息；数据都在账本里。
 * 上次导入或导出的整份备份存在 xxyh_snapshots/，用来算还没导出的修改、预览差异
 */
export type XxyhState = {
  schema_version: 2
  account_id: string | null
  nickname: string | null
  /** 上次导入或导出时的云端版本 */
  last_version: number | null
  last_export_ts: number | null
  last_error: string | null
}

export function emptyXxyhState(): XxyhState {
  return { schema_version: 2, account_id: null, nickname: null, last_version: null, last_export_ts: null, last_error: null }
}
