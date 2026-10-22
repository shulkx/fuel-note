// 保险几页共用的部件（设计文档 20.6、22.7 节）：分段横条、配色、金额写法、交强险标志徽章；
// 保险页的续保提醒、正在保障那一年的卡片和历年保单的一行（1.6.0-beta.4 起都在保险页，pages/insurance_tab.tsx）
import { Button, Circle, DynamicShapeStyle, GeometryReader, HStack, Image, RoundedRectangle, Spacer, Text, VStack, ZStack } from "scripting"
import {
  changeText, composition, Composition, daysLeft, InsuranceYear, markLook, monthDayText, periodText, policyFilePath, yearInsurer, yearMark, yearOf, yearPeriod,
  yearPhone, yearTotal,
} from "../common/model"

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
      <Text font={Math.round(size * 0.24)} fontWeight="bold" foregroundStyle="white">{String(look.year)}</Text>
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

/**
 * 卡片下面的按钮：各占一半宽，图标和文字挨在一起、居中。
 * 直接用 title + systemImage 时，frame 把标签撑宽，图标留在左边、文字居中，中间空出一截；frame 放在按钮上时底色只包住内容，所以放在里面这组上
 */
function CardButton({ icon, title, action }: { icon: string; title: string; action: () => void }) {
  return <Button action={action} buttonStyle="bordered">
    <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <Image systemName={icon} />
      <Text>{title}</Text>
    </HStack>
  </Button>
}

/** 横条右边「比上一年」一列的宽度：没有上一年时也留着，各行的横条按同一比例（设计文档 22.7 节） */
const CHANGE_WIDTH = 58

/** 按构成分段的横条（宽度按历年最大的实付）和比上一年的变化（高出 10% 以上橙色）：卡片和每一行共用 */
function YearBar({ year, prev, max }: { year: InsuranceYear; prev: InsuranceYear | null; max: number }) {
  const total = yearTotal(year)
  const up = prev ? total > yearTotal(prev) * 1.1 : false
  return <HStack spacing={10}>
    <SegmentBar parts={compositionParts(composition(year))} max={max} />
    <Text font="caption" foregroundStyle={up ? ORANGE : "secondaryLabel"} frame={{ width: CHANGE_WIDTH, alignment: "trailing" }}>
      {prev ? changeText(total, yearTotal(prev)) : ""}
    </Text>
  </HStack>
}

/**
 * 正在保障的那一年（保险页历年保单里展开成卡片，画布「第七轮」）：左边交强险标志徽章（轻点全屏显示标志原件），
 * 年份、保险公司、实付、期间和剩余天数；构成横条和比上一年的变化，与下面各年同一比例；报案、保单原件两个按钮。
 * 不放保险期间的进度条（只在保单详情里）。一行里有几个按钮，每个都要指定 buttonStyle
 */
export function CurrentPolicy({ year, prev, max, now, open }: { year: InsuranceYear; prev: InsuranceYear | null; max: number; now: number; open: () => void }) {
  const p = yearPeriod(year)
  const left = p ? daysLeft(p.end, now) : null
  const phone = yearPhone(year)
  const files = year.policies.map(x => x.file).filter((f): f is string => !!f)
  const mark = yearMark(year)
  const markFile = mark?.file ?? null
  return <VStack alignment="leading" spacing={12}>
    <HStack spacing={14}>
      {mark && markFile
        ? <Button action={() => QuickLook.previewURLs([policyFilePath(markFile)])} buttonStyle="plain"><MarkBadge end={mark.end} now={now} size={72} /></Button>
        : mark ? <MarkBadge end={mark.end} now={now} size={72} /> : null}
      <Button action={open} buttonStyle="plain">
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={8}>
              <Text font="headline">{String(yearOf(year))}</Text>
              <Text foregroundStyle="secondaryLabel" lineLimit={1}>{yearInsurer(year)}</Text>
            </HStack>
            <Text font="title2" fontWeight="bold">{yuan(yearTotal(year))}</Text>
            <Text font="caption" foregroundStyle={left != null && left < 0 ? ORANGE : "secondaryLabel"}>
              {`${periodText(p)}${left == null ? "" : left >= 0 ? ` · 还有 ${left} 天` : ` · 已到期 ${-left} 天`}`}
            </Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </HStack>
    <YearBar year={year} prev={prev} max={max} />
    {phone || files.length ? <HStack spacing={10}>
      {phone ? <CardButton icon="phone" title={`报案 ${phone}`} action={() => Safari.openURL(`tel:${phone}`)} /> : null}
      {files.length ? <CardButton icon="doc.text" title={`保单 ${files.length} 份`} action={() => QuickLook.previewURLs(files.map(policyFilePath))} /> : null}
    </HStack> : null}
  </VStack>
}

/** 历年保单的一行：年份、保险公司（有优惠时写出来）、实付；构成横条和比上一年的变化。轻点推入保单详情 */
export function YearRow({ year, prev, max, open }: { year: InsuranceYear; prev: InsuranceYear | null; max: number; open: () => void }) {
  const insurer = [yearInsurer(year), year.discount ? `优惠 ${yuan(year.discount)}` : ""].filter(Boolean).join(" · ")
  return <Button action={open}>
    <VStack alignment="leading" spacing={7} foregroundStyle="label">
      <HStack>
        <Text font="headline">{String(yearOf(year))}</Text>
        <Text foregroundStyle="secondaryLabel" lineLimit={1}>{insurer}</Text>
        <Spacer />
        <Text>{yuan(yearTotal(year))}</Text>
        <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
      </HStack>
      <YearBar year={year} prev={prev} max={max} />
    </VStack>
  </Button>
}

/** 续保提醒：到期前 45 天起，还没有记下一年时（设计文档 20.6、22.7 节）。「×」本期不再提醒。行内有多个按钮，每个都要指定 buttonStyle */
export function RenewalRow({ year, left, onRecord, onDismiss }: { year: InsuranceYear; left: number; onRecord: () => void; onDismiss: () => void }) {
  const p = yearPeriod(year)
  const day = p ? monthDayText(p.end) : ""
  const insurer = yearInsurer(year)
  return <HStack spacing={10}>
    <Button action={onRecord} buttonStyle="plain">
      <HStack spacing={10}>
        <Image systemName="exclamationmark.shield.fill" foregroundStyle="systemOrange" />
        <VStack alignment="leading" spacing={1}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{left >= 0 ? `车险 ${day}到期` : `车险已于 ${day}到期`}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{[left >= 0 ? `还有 ${left} 天` : `已过 ${-left} 天`, insurer].filter(Boolean).join(" · ")}</Text>
        </VStack>
      </HStack>
    </Button>
    <Spacer />
    <Button title="记保险" action={onRecord} buttonStyle="borderedProminent" tint="systemOrange" />
    <Button action={onDismiss} buttonStyle="plain">
      <Image systemName="xmark" font="footnote" foregroundStyle="secondaryLabel" />
    </Button>
  </HStack>
}
