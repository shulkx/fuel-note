// 图表横轴（纯函数）。可以选点的图只能用文字类别做横轴（Scripting 的单点选择只支持文字和数字），
// 而手机上 chartXAxis 指定的刻度对文字类别不起作用，每个类别都会写在横轴上。所以：
// - 要显示的刻度用看得见的文字：每月第一个点写「11月」，1 月写年份「2026」；
// - 其他点的类别只由零宽空格组成（个数不同以便区分），横轴上看不见；
// - 刻度只挑几个：一般隔几个月一个，跨两年以上只显示年份；
// - 看得见的文字重复时（跨年的同名月份）末尾加零宽空格区分，看起来一样。
const ZW = "​"

function unique(label: string, used: Set<string>): string {
  let s = label
  while (used.has(s)) s += ZW
  used.add(s)
  return s
}

/** 刻度：从候选（每月第一个点）里挑，最多 maxTicks 个；跨两年以上时只用年份。返回点的下标 */
function pickTicks(candidates: Array<{ index: number; month: number }>, maxTicks: number, spanMonths: number): Set<number> {
  let list = candidates
  if (spanMonths >= 24) list = candidates.filter(c => c.month === 1)
  if (list.length > maxTicks) {
    const step = Math.ceil(list.length / maxTicks)
    list = list.filter((_, i) => i % step === 0)
  }
  return new Set(list.map(c => c.index))
}

export type Categories = { labels: string[]; ticks: string[] }

/** names[i] 是第 i 个点的刻度文字；只有 shown 里的点显示，其他点的类别看不见 */
function categories(names: string[], shown: Set<number>): Categories {
  const used = new Set<string>()
  let hidden = 0
  const labels = names.map((name, i) => (shown.has(i) ? unique(name, used) : ZW.repeat(++hidden)))
  return { labels, ticks: labels.filter((_, i) => shown.has(i)) }
}

const monthName = (y: number, m: number) => (m === 1 ? String(y) : `${m}月`)

/** 一组按时间排好的点（毫秒） */
export function timeCategories(tss: number[], maxTicks = 6): Categories {
  const names: string[] = []
  const candidates: Array<{ index: number; month: number }> = []
  let lastMonth = ""
  tss.forEach((ts, index) => {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const key = `${y}-${m}`
    names.push(monthName(y, m))
    if (key !== lastMonth) candidates.push({ index, month: m })
    lastMonth = key
  })
  const span = tss.length ? (tss[tss.length - 1] - tss[0]) / (30.44 * 86400e3) : 0
  return categories(names, pickTicks(candidates, maxTicks, span))
}

/** 月份（YYYY-MM） */
export function monthCategories(months: string[], maxTicks = 7): Categories {
  const names: string[] = []
  const candidates: Array<{ index: number; month: number }> = []
  months.forEach((key, index) => {
    const [y, m] = key.split("-").map(Number)
    names.push(monthName(y, m))
    candidates.push({ index, month: m })
  })
  return categories(names, pickTicks(candidates, maxTicks, months.length))
}

/** 同期对比的 12 个月：单数月显示「1月」「3月」……，双数月看不见 */
export const YEAR_MONTHS: string[] = categories(
  Array.from({ length: 12 }, (_, i) => `${i + 1}月`),
  new Set([0, 2, 4, 6, 8, 10]),
).labels

/** 纵轴范围：留一点上下边距，取整 */
export function niceDomain(values: number[], pad = 1, floorTo = 1): { from: number; to: number } {
  if (!values.length) return { from: 0, to: 1 }
  const lo = Math.floor((Math.min(...values) - pad) / floorTo) * floorTo
  const hi = Math.ceil((Math.max(...values) + pad) / floorTo) * floorTo
  return { from: Math.max(0, lo), to: hi }
}
