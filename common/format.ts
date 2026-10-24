// 金额的写法和北京时间的换算，几处共用。common/widget_data.ts 不引用其他源文件（小组件只加载它），它自己的副本保留。

/** 保单、权益卡上的日期都是北京时间 */
export const BJ_OFFSET = 8 * 3600e3

/** 北京时间某天 0 点（毫秒）；m 从 1 开始 */
export function bjDayStart(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) - BJ_OFFSET
}

/** 千分位、两位小数：「5,510.00」 */
export function grouped(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/** 「¥5,510.00」 */
export function yuan(n: number): string {
  return `¥${grouped(n)}`
}

/** 整数不写小数：「¥800」「¥5,000」 */
export function yuanShort(n: number): string {
  return Number.isInteger(n) ? `¥${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}` : yuan(n)
}
