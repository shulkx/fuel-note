// 费用 › 统计（设计文档 21.4 节，画布「第四轮」）：范围；合计和分类；每年（按付款日期）；历年保险（1.5 保障页的那一组）。
// 只读费用、保养和保险（common/expense_stats.ts、common/insurance.ts）；加油的统计在 pages/fuel_stats.tsx。
import { Button, ContentUnavailableView, DynamicShapeStyle, HStack, List, Picker, Rectangle, RoundedRectangle, Section, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, amountOnlyExpenses, categoryName, currentVehicle, expenseEntries, expenseSummary, expenseYears, ExpenseRecord, fmtDate, insuranceYears, InsuranceYear,
  LedgerRecord, RANGE_TITLES, RANGES, saveStatsRange, savedStatsRange, StatsRange, vehicleRecords, yearGaps, yearOf, yearTotal,
} from "../common/model"
import { TabNav } from "./components"
import { AMOUNT_ONLY, Part, SegmentBar, YearRow, yuan } from "./insurance_parts"

export type ExpenseStatsActions = {
  /** 记保险；link 是「只有金额」的那笔费用（补充保单） */
  addInsurance: (link: (ExpenseRecord & LedgerRecord) | null) => void
  openInsurance: (y: InsuranceYear) => void
}

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

function colorOf(id: number, custom: number[]): DynamicShapeStyle {
  return CATEGORY_COLORS[id] ?? MORE_COLORS[Math.max(0, custom.indexOf(id)) % MORE_COLORS.length]
}

const percent = (part: number, total: number) => (total > 0 ? `${(part / total * 100).toFixed(1)}%` : "")

export function ExpenseStats({ data, nav, actions }: { data: AppData; nav: TabNav; actions: ExpenseStatsActions }) {
  const vehicle = currentVehicle(data)
  // 记住上次选的范围（与油耗分开，第一次是「全部」）
  const [range, setRange] = useState<StatsRange>(() => savedStatsRange("expense"))
  const records = useMemo(() => (vehicle ? vehicleRecords(data, vehicle) : []), [data, vehicle?.id])
  const entries = useMemo(() => expenseEntries(records), [records])
  const s = useMemo(() => expenseSummary(entries, range), [entries, range])
  const years = useMemo(() => expenseYears(entries), [entries])
  const custom = useMemo(() => Array.from(new Set(entries.map(e => e.category_id))).filter(id => !CATEGORY_COLORS[id]).sort((a, b) => a - b), [entries])
  // 横条的分段按全部时间里各类别的大小排，每年、每个范围的颜色顺序都一样
  const order = useMemo(() => expenseSummary(entries, "all").categories.map(c => c.category_id), [entries])
  const parts = (cats: Array<{ category_id: number; amount: number }>): Part[] => cats.slice()
    .sort((a, b) => order.indexOf(a.category_id) - order.indexOf(b.category_id))
    .map(c => ({ value: c.amount, color: colorOf(c.category_id, custom) }))

  // 历年保险（1.5 保障页）：年份和缺的年份按年份从新到旧排在一起；小熊里只记了金额的保险费用单独一组
  const insurance = vehicle ? insuranceYears(data.ledger.insurance, vehicle.id) : []
  const amountOnly = amountOnlyExpenses(records, insurance)
  const gaps = yearGaps(insurance, amountOnly)
  const insMax = Math.max(1, ...insurance.map(yearTotal), ...amountOnly.map(r => r.amount))
  const rows: Array<{ year: number; item: InsuranceYear | null }> = [
    ...insurance.map(y => ({ year: yearOf(y), item: y })),
    ...gaps.map(g => ({ year: g, item: null })),
  ].sort((a, b) => b.year - a.year)
  const yearMax = Math.max(1, ...years.map(y => y.total))

  const empty = !vehicle || (!entries.length && !insurance.length)
  const subtitle = vehicle ? [vehicle.name, s.from_ts != null ? `${fmtDate(s.from_ts)} 至今` : ""].filter(Boolean).join(" · ") : null

  function changeRange(v: string) {
    setRange(v as StatsRange)
    saveStatsRange("expense", v as StatsRange)
  }

  return <List
    navigationTitle={nav.title}
    navigationBarTitleDisplayMode="inline"
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    toolbar={nav.toolbar}
    {...(empty ? { overlay: <ContentUnavailableView title="还没有费用" systemImage="chart.bar" /> } : {})}
  >
    {empty ? null : <>
      {/* 范围切换直接放在背景上，与油耗的统计相同 */}
      <Section key="range">
        <Picker
          title="范围"
          value={range}
          onChanged={changeRange}
          pickerStyle="segmented"
          listRowInsets={0}
          listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}
        >
          {RANGES.map(r => <Text key={r} tag={r}>{RANGE_TITLES[r]}</Text>)}
        </Picker>
      </Section>

      <Section key="summary" footer={<Text>只算费用，不含加油。小熊的保养记录和它关联的费用只算一次。</Text>}>
        <VStack alignment="leading" spacing={8}>
          <Text font="caption" foregroundStyle="secondaryLabel">{s.count ? `合计 · ${s.count} 笔` : "合计"}</Text>
          <Text font="largeTitle" fontWeight="bold">{yuan(s.total)}</Text>
          {s.total > 0 ? <SegmentBar parts={parts(s.categories)} max={s.total} height={10} /> : null}
        </VStack>
        {s.categories.map(c => <HStack key={String(c.category_id)} spacing={8}>
          <RoundedRectangle cornerRadius={3} fill={colorOf(c.category_id, custom)} frame={{ width: 10, height: 10 }} />
          <Text>{categoryName(data, c.category_id)}</Text>
          <Spacer />
          <Text font="footnote" foregroundStyle="secondaryLabel">{percent(c.amount, s.total)}</Text>
          <Text>{yuan(c.amount)}</Text>
        </HStack>)}
      </Section>

      {years.length ? <Section key="years" header={<Text>每年</Text>} footer={<Text>按付款日期：车险多在 12 月付下一年的保费，算在付款那一年。</Text>}>
        {years.map(y => <HStack key={String(y.year)} spacing={12}>
          <Text font="headline">{String(y.year)}</Text>
          <SegmentBar parts={parts(y.categories)} max={yearMax} />
          <Text>{yuan(y.total)}</Text>
        </HStack>)}
      </Section> : null}

      {rows.length ? <Section key="insurance" header={<Text>历年保险</Text>} footer={<Text>按保险期间开始的年份排列，金额是保单合计，点一年查看保单。</Text>}>
        {rows.map(r => r.item
          ? <YearRow key={r.item.id} year={r.item} prev={insurance.find(y => yearOf(y) === r.year - 1) ?? null} max={insMax} open={() => actions.openInsurance(r.item!)} />
          : <HStack key={`gap${r.year}`}>
            <Text font="headline" foregroundStyle="secondaryLabel">{String(r.year)}</Text>
            <Text foregroundStyle="secondaryLabel">没有记录</Text>
            <Spacer />
            <Button title="补记" buttonStyle="borderless" action={() => actions.addInsurance(null)} />
          </HStack>)}
      </Section> : null}

      {amountOnly.length ? <Section key="amount-only" header={<Text>只有金额（费用记录，没有保单）</Text>}>
        {amountOnly.map(r => <VStack key={r.id} alignment="leading" spacing={7}>
          <HStack>
            <Text>{fmtDate(r.ts)}</Text>
            <Text foregroundStyle="secondaryLabel" lineLimit={1}>{r.remark.split("\n")[0]}</Text>
            <Spacer />
            <Text>{yuan(r.amount)}</Text>
          </HStack>
          <HStack spacing={10}>
            <SegmentBar parts={[{ value: r.amount, color: AMOUNT_ONLY }]} max={insMax} />
            <Button title="补充保单" buttonStyle="borderless" font="caption" action={() => actions.addInsurance(r)} />
          </HStack>
        </VStack>)}
      </Section> : null}
    </>}
  </List>
}
