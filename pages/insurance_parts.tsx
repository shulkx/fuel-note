// 保险几页共用的部件（设计文档 20.6 节）：分段横条、配色、金额写法、交强险标志徽章
import { Circle, DynamicShapeStyle, GeometryReader, HStack, RoundedRectangle, Spacer, Text, VStack, ZStack } from "scripting"
import { Composition, markLook } from "../common/model"

/** 三段的颜色：亮度不同，色弱也分得清（商业险深蓝、交强险和车船税浅蓝、驾乘意外险橙） */
export const SEG: Record<keyof Composition, DynamicShapeStyle> = {
  commercial: { light: "#2563EB", dark: "#60A5FA" },
  compulsory: { light: "#93C5FD", dark: "#2F5FB3" },
  other: { light: "#F59E0B", dark: "#FBBF24" },
}
export const SEG_TITLES: Record<keyof Composition, string> = { commercial: "商业险", compulsory: "交强险和车船税", other: "驾乘意外险" }
/** 只记了金额的费用 */
export const AMOUNT_ONLY: DynamicShapeStyle = { light: "#C7C7CC", dark: "#48484A" }
export const GREEN: DynamicShapeStyle = { light: "#10B981", dark: "#34D399" }
export const ORANGE: DynamicShapeStyle = { light: "#C2410C", dark: "#FB923C" }

/** 金额「¥5,031.20」（保险的金额大，加千分位） */
export const yuan = (n: number) => `¥${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`

export type Part = { value: number; color: DynamicShapeStyle }

/**
 * 按比例分段的横条：总宽对应 max（历年列表里是历年最大的合计，详情里是这一年的合计）。
 * 宽度用 GeometryReader 量出；frame 只用伸缩写法（固定和伸缩混写时 Scripting 只认固定尺寸）
 */
export function SegmentBar({ parts, max, height = 8 }: { parts: Part[]; max: number; height?: number }) {
  const shown = parts.filter(p => p.value > 0)
  return <GeometryReader frame={{ maxWidth: "infinity", minHeight: height, maxHeight: height }}>
    {proxy => <HStack spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }}>
      {shown.map((p, i) => <RoundedRectangle
        key={String(i)}
        cornerRadius={height / 2}
        fill={p.color}
        frame={{ width: Math.max(height, (p.value / (max || 1)) * proxy.size.width - 2), height }}
      />)}
      <Spacer minLength={0} />
    </HStack>}
  </GeometryReader>
}

export function compositionParts(c: Composition): Part[] {
  return (["commercial", "compulsory", "other"] as const).map(k => ({ value: c[k], color: SEG[k] }))
}

/** 交强险标志徽章的颜色：有效绿、45 天内到期橙、已到期灰（白字对比度都过 4.5:1，深浅色一样） */
const MARK_COLORS = { ok: "#248A3D", soon: "#C2410C", past: "#636366" } as const

/**
 * 交强险标志徽章（画布「交强险标志」）：中间是到期年份和月份，一圈 12 个点按钟面位置排，到期月是一个孔（行的底色）。
 * 借用标志「正面印到期年份、打孔标月份」的意思，不照搬官方标志。label 为 false 时只画圈和点（列表里的小图标）
 */
export function MarkBadge({ end, now, size, label = true }: { end: number; now: number; size: number; label?: boolean }) {
  const look = markLook(end, now)
  const ring = size * 0.4
  const dot = Math.max(2.2, size * 0.048)
  const hole = Math.max(4.8, size * 0.11)
  return <ZStack frame={{ width: size, height: size }}>
    <Circle fill={MARK_COLORS[look.state]} />
    {Array.from({ length: 12 }, (_, i) => {
      const a = ((i + 1) * Math.PI) / 6
      const at = { x: ring * Math.sin(a), y: -ring * Math.cos(a) }
      return i + 1 === look.month
        ? <Circle key={String(i)} fill="secondarySystemGroupedBackground" frame={{ width: hole, height: hole }} offset={at} />
        : <Circle key={String(i)} fill="white" opacity={0.6} frame={{ width: dot, height: dot }} offset={at} />
    })}
    {label ? <VStack spacing={0}>
      <Text font={Math.round(size * 0.27)} fontWeight="bold" foregroundStyle="white">{String(look.year)}</Text>
      <Text font={11} fontWeight="semibold" foregroundStyle="white">{`${look.month}月`}</Text>
    </VStack> : null}
  </ZStack>
}

/** 横条下面的图例和金额 */
export function CompositionLegend({ c }: { c: Composition }) {
  const keys = (["commercial", "compulsory", "other"] as const).filter(k => c[k] > 0)
  return <HStack alignment="top" spacing={12}>
    {keys.map(k => <VStack key={k} alignment="leading" spacing={2}>
      <HStack spacing={5}>
        <RoundedRectangle cornerRadius={3} fill={SEG[k]} frame={{ width: 10, height: 10 }} />
        <Text font="caption" foregroundStyle="secondaryLabel">{SEG_TITLES[k]}</Text>
      </HStack>
      <Text font="subheadline">{yuan(c[k])}</Text>
    </VStack>)}
    <Spacer minLength={0} />
  </HStack>
}
