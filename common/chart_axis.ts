// 图表横轴（纯函数）。可以选点的图只能用文字类别做横轴（Scripting 的单点选择只支持文字和数字），
// 所以每个点的类别就是它显示在刻度上的文字：
// - 每月第一个点写「11月」，1 月写年份「2026」；其他点写「11/8」；
// - 文字相同的点（同一天两次加油、跨年的同名月份）末尾加零宽空格区分，看起来一样；
// - 刻度只显示几个：一般隔几个月一个，跨两年以上只显示年份。
const ZW = "​"

function unique(label: string, used: Set<string>): string {
  let s = label
  while (used.has(s)) s += ZW
  used.add(s)
  return s
}

/** 刻度：从候选（每月第一个点）里挑，最多 maxTicks 个；跨两年以上时只用年份 */
function pickTicks(candidates: Array<{ label: string; month: number }>, maxTicks: number, spanMonths: number): string[] {
  let list = candidates
  if (spanMonths >= 24) list = candidates.filter(c => c.month === 1)
  if (list.length <= maxTicks) return list.map(c => c.label)
  const step = Math.ceil(list.length / maxTicks)
  return list.filter((_, i) => i % step === 0).map(c => c.label)
}

export type Categories = { labels: string[]; ticks: string[] }

/** 一组按时间排好的点（毫秒） */
export function timeCategories(tss: number[], maxTicks = 6): Categories {
  const used = new Set<string>()
  const labels: string[] = []
  const candidates: Array<{ label: string; month: number }> = []
  let lastMonth = ""
  for (const ts of tss) {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const key = `${y}-${m}`
    if (key !== lastMonth) {
      const label = unique(m === 1 ? String(y) : `${m}月`, used)
      labels.push(label)
      candidates.push({ label, month: m })
      lastMonth = key
    } else {
      labels.push(unique(`${m}/${d.getDate()}`, used))
    }
  }
  const span = tss.length ? (tss[tss.length - 1] - tss[0]) / (30.44 * 86400e3) : 0
  return { labels, ticks: pickTicks(candidates, maxTicks, span) }
}

/** 月份（YYYY-MM） */
export function monthCategories(months: string[], maxTicks = 7): Categories {
  const used = new Set<string>()
  const labels: string[] = []
  const candidates: Array<{ label: string; month: number }> = []
  for (const key of months) {
    const [y, m] = key.split("-").map(Number)
    const label = unique(m === 1 ? String(y) : `${m}月`, used)
    labels.push(label)
    candidates.push({ label, month: m })
  }
  return { labels, ticks: pickTicks(candidates, maxTicks, months.length) }
}

/** 纵轴范围：留一点上下边距，取整 */
export function niceDomain(values: number[], pad = 1, floorTo = 1): { from: number; to: number } {
  if (!values.length) return { from: 0, to: 1 }
  const lo = Math.floor((Math.min(...values) - pad) / floorTo) * floorTo
  const hi = Math.ceil((Math.max(...values) + pad) / floorTo) * floorTo
  return { from: Math.max(0, lo), to: hi }
}
