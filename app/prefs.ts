// 只是这台手机上的界面偏好：存在 Storage，不进账本和备份
import { DEFAULT_RANGE, isStatsRange, StatsRange } from "../common/ranges"

/** 油耗、费用的统计各自记住上次选的范围（设计文档 21.3、21.4 节）；油耗沿用 1.6 之前统计页的键 */
const STATS_RANGE_KEYS = { fuel: "fuelnote.stats_range", expense: "fuelnote.expense_stats_range" } as const
export type StatsDomain = keyof typeof STATS_RANGE_KEYS
/** 费用一年只有几笔，第一次打开看全部 */
const STATS_RANGE_DEFAULTS: Record<StatsDomain, StatsRange> = { fuel: DEFAULT_RANGE, expense: "all" }

export function savedStatsRange(domain: StatsDomain): StatsRange {
  try {
    const v = Storage.get(STATS_RANGE_KEYS[domain])
    return isStatsRange(v) ? v : STATS_RANGE_DEFAULTS[domain]
  } catch {
    return STATS_RANGE_DEFAULTS[domain]
  }
}

export function saveStatsRange(domain: StatsDomain, range: StatsRange): void {
  try { Storage.set(STATS_RANGE_KEYS[domain], range) } catch { /* 下次用默认范围 */ }
}
