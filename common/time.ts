// 显示用的日期格式（设备时区）

const pad = (n: number) => String(n).padStart(2, "0")
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`
}

/** 「10/12 周日」 */
export function fmtDay(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 周${WEEKDAYS[d.getDay()]}`
}

/** 「10-12 14:39」 */
export function fmtShort(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtTime(ts)}`
}

/** 分组用的月份键「2026-10」 */
export function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthTitle(key: string): string {
  const [y, m] = key.split("-")
  return `${y}年${Number(m)}月`
}

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 「今天」「昨天」「N 天前」 */
export function daysAgoText(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86400e3)
  if (days <= 0) return "今天"
  if (days === 1) return "昨天"
  return `${days} 天前`
}

/** 停留时长「12 分钟」「1 小时 5 分钟」「2 天 3 小时」 */
export function durationText(ms: number): string {
  const m = Math.round(ms / 60e3)
  if (m < 60) return `${m} 分钟`
  if (m < 1440) return `${Math.floor(m / 60)} 小时${m % 60 ? ` ${m % 60} 分钟` : ""}`
  const h = Math.floor((m % 1440) / 60)
  return `${Math.floor(m / 1440)} 天${h ? ` ${h} 小时` : ""}`
}
