// 小熊油耗云备份的原始结构（只列出用到的字段，其余字段原样保留）
import { ExpenseData, FuelData, Station, VehicleProfile } from "../../common/types"

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
 * 待上传的修改。key 是被修改记录修改前的 date，null 表示新增；
 * n 是同一时间有多条记录时的第几条（从 1 开始，缺省 1）。station 是这次要新建的油站。
 */
/**
 * 待上传的修改。add_car 在云端车辆列表末尾新建一辆车（设计文档 17.4 节），要排在这辆车的记录操作前面；
 * 同一个 uuid 的车已经在云端时不再新建（上次上传成功但没收到回应）
 */
export type XxyhOp =
  | { type: "add_car"; car: string; name: string; profile: VehicleProfile; at: number }
  | { type: "put_fuel"; car: string; key: number | null; n?: number; data: FuelData; station: Station | null; at: number }
  | { type: "delete_fuel"; car: string; key: number; n?: number; at: number }
  | { type: "put_expense"; car: string; key: number | null; n?: number; data: ExpenseData; at: number }
  | { type: "delete_expense"; car: string; key: number; n?: number; at: number }

export type XxyhState = {
  schema_version: 1
  account_id: string | null
  nickname: string | null
  base_version: number | null
  base: XxyhBackup | null
  ops: XxyhOp[]
  last_pull_ts: number | null
  last_push_ts: number | null
  last_error: string | null
  /** 上次上传时丢弃的、与云端冲突的修改 */
  last_conflicts: string[]
}

export function emptyXxyhState(): XxyhState {
  return {
    schema_version: 1, account_id: null, nickname: null, base_version: null, base: null, ops: [],
    last_pull_ts: null, last_push_ts: null, last_error: null, last_conflicts: [],
  }
}
