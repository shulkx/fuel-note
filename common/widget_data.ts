// 小组件的数据：App 每次保存时写 FuelNote/widget.json，小组件只读这个小文件。
// widget.tsx 只从这里导入；这个文件不依赖其他模块，小组件打包的代码最少。

/** 车况（设计文档第 18 节）：油记读到后写进来，小组件只显示 */
export type WidgetStatus = {
  /** 车况时间（车辆在停车熄火时上报） */
  ts: number | null
  fuel_l: number | null
  range_km: number | null
  /** 油箱容量（车型参数）；不知道时为 null，不画油量条 */
  tank_l: number | null
  /** 油记读取的时间 */
  read_at: number
}

/** 小组件自己读车况要用的（设计文档 18.3 节）：缓存键、提供方、车辆 id、油箱容量 */
export type StatusLink = { key: string; provider: string; vehicle_id: string; tank_l: number | null }

export type WidgetSnapshot = {
  schema_version: 1
  updated_at: number
  vehicle: string | null
  /** 当前车辆关联的车辆数据能读车况：小号、中号、锁屏圆形改为显示油量 */
  status_source: boolean
  status: WidgetStatus | null
  status_link: StatusLink | null
  latest_consumption: number | null
  avg_consumption: number | null
  last_fuel_ts: number | null
  last_odometer: number | null
  month: string
  month_cost: number
  pending: number
}

export const EMPTY_WIDGET: WidgetSnapshot = {
  schema_version: 1, updated_at: 0, vehicle: null, status_source: false, status: null, status_link: null, latest_consumption: null, avg_consumption: null,
  last_fuel_ts: null, last_odometer: null, month: "", month_cost: 0, pending: 0,
}

export function widgetFilePath(): string {
  return `${FileManager.appGroupDocumentsDirectory.replace(/\/+$/, "")}/FuelNote/widget.json`
}

/** 读不到或格式不对时返回空摘要，小组件显示占位内容 */
export function readWidgetSnapshot(): WidgetSnapshot {
  try {
    const path = widgetFilePath()
    if (!FileManager.existsSync(path)) return EMPTY_WIDGET
    const v = JSON.parse(FileManager.readAsStringSync(path))
    return v && v.schema_version === 1 ? { ...EMPTY_WIDGET, ...v } : EMPTY_WIDGET
  } catch {
    return EMPTY_WIDGET
  }
}

const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

export function daysAgoText(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86400e3)
  if (days <= 0) return "今天"
  if (days === 1) return "昨天"
  return `${days} 天前`
}

/** 本月花费只算本月的；跨月后摘要里的月份不是当月就显示 0 */
export function monthCostNow(s: WidgetSnapshot, now = Date.now()): number {
  const d = new Date(now)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
  return s.month === key ? s.month_cost : 0
}

/** 小组件显示车况的尺寸：小号、中号、锁屏圆形（大号同小号）；锁屏横条和单行照旧显示油耗 */
export function showsFuel(family: string, s: WidgetSnapshot): boolean {
  return s.status_source && family !== "accessoryRectangular" && family !== "accessoryInline"
}

/** 小组件自己读车况的间隔：车况超过 1 小时才读（WidgetKit 给常看的小组件每天约 40–70 次刷新） */
export const WIDGET_STATUS_MAX_AGE_MS = 60 * 60e3

/** 下次刷新：显示车况的小组件 1 小时后，其他的到零点后（「N 天前」和本月花费按天更新） */
export function widgetRefreshDate(s: WidgetSnapshot, family: string, now = Date.now()): Date {
  const midnight = nextRefreshDate(now)
  if (!s.status_link || !showsFuel(family, s)) return midnight
  return new Date(Math.min(midnight.getTime(), now + WIDGET_STATUS_MAX_AGE_MS))
}

/** 下一个本地零点后 1 分钟：小组件按天刷新「N 天前」和本月花费 */
export function nextRefreshDate(now = Date.now()): Date {
  const d = new Date(now)
  d.setHours(24, 1, 0, 0)
  return d
}

const pad = (n: number) => String(n).padStart(2, "0")

/** 油量低于油箱的这个比例时用橙色 */
export const LOW_FUEL_RATIO = 0.15
/** 不知道油箱容量时，续航低于这个公里数算油量低 */
export const LOW_RANGE_KM = 80

/** 油量条的比例（0–1）；不知道油箱容量或油量时为 null */
export function fuelRatio(fuel: number | null, tank: number | null): number | null {
  if (fuel == null || !tank || tank <= 0) return null
  return Math.max(0, Math.min(1, fuel / tank))
}

export function fuelLow(fuel: number | null, tank: number | null, range: number | null): boolean {
  const ratio = fuelRatio(fuel, tank)
  if (ratio != null) return ratio < LOW_FUEL_RATIO
  return range != null && range < LOW_RANGE_KM
}

/** 车况超过 1 天（车况只在停车熄火时更新，超过 1 天时提醒数据可能旧了） */
export function statusStale(ts: number | null, now = Date.now()): boolean {
  return ts == null || now - ts > 86400e3
}

/** 「今天 15:16」「昨天 15:16」「10/12 15:16」 */
export function statusWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86400e3)
  if (days <= 0) return `今天 ${time}`
  if (days === 1) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}

