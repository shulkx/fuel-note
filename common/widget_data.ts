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
  /** 里程表（km），算「加满后已行驶」；1.4 前的 widget.json 没有 */
  odometer_km?: number | null
  /** 油记读取的时间 */
  read_at: number
}

/** 大号「最近加油」的一行（1.4 起） */
export type WidgetFill = { ts: number; liters: number; grade: number | null; station: string | null; paid: number; consumption: number | null }

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
  /** 最近一次加油的里程和是否加满（「加满后已行驶」，1.4 起） */
  last_fuel_odometer: number | null
  last_fuel_full: boolean
  month: string
  month_cost: number
  /** 今年（「2026」）的花费：加油和其他费用（1.4 起） */
  year: string
  year_cost: number
  /** 最近 3 次加油，新的在前（1.4 起） */
  recent: WidgetFill[]
  pending: number
}

export const EMPTY_WIDGET: WidgetSnapshot = {
  schema_version: 1, updated_at: 0, vehicle: null, status_source: false, status: null, status_link: null, latest_consumption: null, avg_consumption: null,
  last_fuel_ts: null, last_odometer: null, last_fuel_odometer: null, last_fuel_full: false, month: "", month_cost: 0, year: "", year_cost: 0, recent: [],
  pending: 0,
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

/** 今年花费只算今年的；跨年后摘要里的年份不是今年就显示 0 */
export function yearCostNow(s: WidgetSnapshot, now = Date.now()): number {
  return s.year === String(new Date(now).getFullYear()) ? s.year_cost : 0
}

/** 油耗和平均比较的档位（大号「最近加油」的小圆点）：不高于平均、高出 10% 以内、高出更多 */
export type ConsumptionLevel = "ok" | "above" | "high"
export function consumptionLevel(value: number | null, avg: number | null): ConsumptionLevel | null {
  if (value == null || avg == null || avg <= 0) return null
  if (value <= avg) return "ok"
  return value <= avg * 1.1 ? "above" : "high"
}

/** 上次加油后已行驶（km）：车况的里程表减上次加油的里程；缺数据或车况早于上次加油时为 null */
export function drivenSinceFill(s: WidgetSnapshot): number | null {
  const odo = s.status ? s.status.odometer_km : null
  if (odo == null || s.last_fuel_odometer == null || odo < s.last_fuel_odometer) return null
  return Math.round(odo - s.last_fuel_odometer)
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]

/** 「10/12 周一」（大号「最近加油」） */
export function fillDay(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 周${WEEKDAYS[d.getDay()]}`
}

/** 金额：本月「389.24」，今年「8,552」（四格里不写 ¥，与标题「花费」配合） */
export function moneyText(n: number, digits: 0 | 2): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 小组件显示车况：当前车辆能读车况时，各尺寸都显示剩余油量（1.2.2 起锁屏横条和单行也显示） */
export function showsFuel(_family: string, s: WidgetSnapshot): boolean {
  return s.status_source
}

/** 最近油耗与平均的对比（小组件大数字下面一行）。按显示的两位小数相减，差不到 0.05 算持平 */
export type Trend = { dir: "down" | "up" | "flat"; text: string }
export function consumptionTrend(latest: number | null, avg: number | null): Trend | null {
  if (latest == null || avg == null) return null
  const d = Math.round(latest * 100) / 100 - Math.round(avg * 100) / 100
  if (Math.abs(d) < 0.05) return { dir: "flat", text: "与平均持平" }
  return d < 0 ? { dir: "down", text: `比平均低 ${(-d).toFixed(2)}` } : { dir: "up", text: `比平均高 ${d.toFixed(2)}` }
}

/**
 * 剩余油量的颜色：油量低为橙色，其余正常。
 * 不按车况时间判断「过期」：车况在停车熄火时上报，车几天没开时那次上报就是现在的状态（用户 2026-10-19；1.2.0–1.3.1-beta.3 超过 1 天显示为灰色）
 */
export type FuelTone = "normal" | "low"
export function fuelTone(st: WidgetStatus): FuelTone {
  return fuelLow(st.fuel_l, st.tank_l, st.range_km) ? "low" : "normal"
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

/** 「今天 15:16」「昨天 15:16」「10/12 15:16」 */
export function statusWhen(ts: number, now = Date.now()): string {
  const d = new Date(ts)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86400e3)
  if (days <= 0) return `今天 ${time}`
  if (days === 1) return `昨天 ${time}`
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${time}`
}


/**
 * 记录页最上面「当前」卡片的内容（设计文档 18.2 节）：上次加油后正在进行的这一箱。
 * 颜色与小组件相同：油量低橙色，其余绿色；还没有读到车况时灰色（none）
 */
export type CurrentTank = {
  tone: FuelTone | "none"
  /** 圆环的比例；不知道油箱容量时为 null（圆环为空） */
  ratio: number | null
  /** 圆环中间：百分比；不知道油箱容量时为剩余升数 */
  center: string
  /** 「剩余 50 L · 约 430 km」 */
  main: string
  /** 「10/12 加满后已行驶 47 km」；读取失败时改为提示 */
  detail: string | null
  /** 分组标题右边：「今天 15:20 上报」 */
  when: string | null
}

export function currentTank(
  st: { ts: number | null; fuel_l: number | null; range_km: number | null; odometer_km: number | null } | null,
  tank: number | null,
  last: { ts: number; odometer: number; full: boolean } | null,
  state: { busy: boolean; error: string | null },
  now = Date.now(),
): CurrentTank {
  const failed = state.error ? "读取失败，轻点查看原因" : null
  if (!st) {
    return {
      tone: "none", ratio: null, center: "—",
      main: state.busy ? "正在读取车况" : "尚未读取车况",
      detail: failed ?? (state.busy ? null : "下拉刷新"),
      when: null,
    }
  }
  const ratio = fuelRatio(st.fuel_l, tank)
  const main = [
    st.fuel_l != null ? `剩余 ${Math.round(st.fuel_l)} L` : "",
    st.range_km != null ? `约 ${Math.round(st.range_km)} km` : "",
  ].filter(Boolean).join(" · ")
  let detail = failed
  // 车况的里程表不小于上次加油的里程时才写已行驶；记录了车况之后的加油时不写
  if (!detail && last && st.odometer_km != null && st.odometer_km >= last.odometer) {
    const d = new Date(last.ts)
    const driven = Math.round(st.odometer_km - last.odometer).toLocaleString("en-US")
    detail = `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${last.full ? "加满" : "加油"}后已行驶 ${driven} km`
  }
  return {
    tone: fuelTone({ ts: st.ts, fuel_l: st.fuel_l, range_km: st.range_km, tank_l: tank, read_at: 0 }),
    ratio,
    center: ratio != null ? `${Math.round(ratio * 100)}%` : st.fuel_l != null ? String(Math.round(st.fuel_l)) : "—",
    main: main || "没有油量数据",
    detail,
    when: st.ts != null ? `${statusWhen(st.ts, now)} 上报` : null,
  }
}
