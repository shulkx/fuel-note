// 统计的时间范围（纯函数）：油耗和费用两边共用（设计文档 21.3、21.4 节）

/** 今年按自然年（与「同期对比」「每年」相同）；近半年、近一年从今天往前推 */
export type StatsRange = "ytd" | "6m" | "1y" | "all"

export const RANGE_TITLES: Record<StatsRange, string> = { ytd: "今年", "6m": "近半年", "1y": "近一年", all: "全部" }
export const RANGES: StatsRange[] = ["ytd", "6m", "1y", "all"]
export const DEFAULT_RANGE: StatsRange = "ytd"
export const isStatsRange = (v: unknown): v is StatsRange => RANGES.some(r => r === v)

const RANGE_MONTHS: Record<"6m" | "1y", number> = { "6m": 6, "1y": 12 }

/** 范围的开始时刻：今年为 1 月 1 日 0 点；近 N 个月从今天往前推（次日 0 点，即正好 N 个月）；全部为 -Infinity */
export function rangeStart(range: StatsRange, now = Date.now()): number {
  if (range === "all") return -Infinity
  const d = new Date(now)
  if (range === "ytd") return new Date(d.getFullYear(), 0, 1).getTime()
  return new Date(d.getFullYear(), d.getMonth() - RANGE_MONTHS[range], d.getDate() + 1).getTime()
}

/** 年月的键（YYYY-MM）的下一个月 */
export function nextMonth(key: string): string {
  let [y, m] = key.split("-").map(Number)
  m += 1
  if (m > 12) { m = 1; y += 1 }
  return `${y}-${String(m).padStart(2, "0")}`
}
