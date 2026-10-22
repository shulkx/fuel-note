// 费用统计几页共用的部件（设计文档 21.4 节）：类别的颜色和横条分段、合计和分类、范围
import { DynamicShapeStyle, HStack, Picker, Rectangle, RoundedRectangle, Section, Spacer, Text, VStack } from "scripting"
import { AppData, CategoryAmount, categoryName, ExpenseEntry, expenseSummary, RANGE_TITLES, RANGES, StatsRange } from "../common/model"
import { Part, SegmentBar, yuan } from "./insurance_parts"

/** 小熊的四个类别有固定的颜色（保险和交通规费与保险横条的商业险同色）；自定义的类别按 id 依次取后面几种 */
const CATEGORY_COLORS: Record<number, DynamicShapeStyle> = {
  100002: { light: "#2563EB", dark: "#60A5FA" },
  100001: { light: "#AF52DE", dark: "#BF5AF2" },
  100000: { light: "#F59E0B", dark: "#FBBF24" },
  100003: { light: "#8E8E93", dark: "#98989F" },
}
const MORE_COLORS: DynamicShapeStyle[] = [
  { light: "#0A84A0", dark: "#40C8E0" },
  { light: "#E0245E", dark: "#FF6482" },
  { light: "#248A3D", dark: "#30D158" },
]

export type Palette = { color: (id: number) => DynamicShapeStyle; parts: (cats: CategoryAmount[]) => Part[] }

/** 类别的颜色和横条的分段：分段按全部时间里各类别的大小排，每年、每个范围的颜色顺序都一样 */
export function categoryPalette(entries: ExpenseEntry[]): Palette {
  const order = expenseSummary(entries, "all").categories.map(c => c.category_id)
  const custom = Array.from(new Set(entries.map(e => e.category_id))).filter(id => !CATEGORY_COLORS[id]).sort((a, b) => a - b)
  const color = (id: number): DynamicShapeStyle => CATEGORY_COLORS[id] ?? MORE_COLORS[Math.max(0, custom.indexOf(id)) % MORE_COLORS.length]
  const parts = (cats: CategoryAmount[]): Part[] => cats.slice()
    .sort((a, b) => order.indexOf(a.category_id) - order.indexOf(b.category_id))
    .map(c => ({ value: c.amount, color: color(c.category_id) }))
  return { color, parts }
}

export const percent = (part: number, total: number) => (total > 0 ? `${(part / total * 100).toFixed(1)}%` : "")

/** 范围切换：直接放在背景上，与油耗的统计相同 */
export function RangePicker({ range, onChanged }: { range: StatsRange; onChanged: (r: StatsRange) => void }) {
  return <Picker
    title="范围"
    value={range}
    onChanged={(v: string) => onChanged(v as StatsRange)}
    pickerStyle="segmented"
    listRowInsets={0}
    listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}
  >
    {RANGES.map(r => <Text key={r} tag={r}>{RANGE_TITLES[r]}</Text>)}
  </Picker>
}

/** 合计和分类：小字说明、大数字、按类别分段的横条，每类一行（金额、占比） */
export function SummarySection({ data, caption, total, categories, palette, header, footer }: {
  data: AppData
  caption: string
  total: number
  categories: CategoryAmount[]
  palette: Palette
  header?: string
  footer?: string
}) {
  return <Section {...(header ? { header: <Text>{header}</Text> } : {})} {...(footer ? { footer: <Text>{footer}</Text> } : {})}>
    <VStack alignment="leading" spacing={8}>
      <Text font="caption" foregroundStyle="secondaryLabel">{caption}</Text>
      <Text font="largeTitle" fontWeight="bold">{yuan(total)}</Text>
      {total > 0 ? <SegmentBar parts={palette.parts(categories)} max={total} height={10} /> : null}
    </VStack>
    {categories.map(c => <HStack key={String(c.category_id)} spacing={8}>
      <RoundedRectangle cornerRadius={3} fill={palette.color(c.category_id)} frame={{ width: 10, height: 10 }} />
      <Text>{categoryName(data, c.category_id)}</Text>
      <Spacer />
      <Text font="footnote" foregroundStyle="secondaryLabel">{percent(c.amount, total)}</Text>
      <Text>{yuan(c.amount)}</Text>
    </HStack>)}
  </Section>
}
