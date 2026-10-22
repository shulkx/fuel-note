// 费用 › 统计（设计文档 22.6 节，1.6.0-beta.4）：只算费用页的那些费用，不含加油和车险（用户 2026-10-22：「保持单一规则」）。
// 范围；合计和分类；每年（按付款日期，合计为 0 的年份也列）。车险的保单和每年保费在「保险」标签（pages/insurance_tab.tsx）。
// 只读费用和保养（common/expense_stats.ts）；加油的统计在 pages/fuel_stats.tsx。
import { ContentUnavailableView, HStack, List, Section, Text, useMemo, useState } from "scripting"
import {
  AppData, currentVehicle, expenseEntries, expenseSummary, expenseYears, fmtDate, insuranceYears, saveStatsRange, savedStatsRange, StatsRange, vehicleRecords,
  withoutCarInsurance,
} from "../common/model"
import { TabNav } from "./components"
import { categoryPalette, RangePicker, SummarySection } from "./expense_parts"
import { SegmentBar, yuan } from "./insurance_parts"

export function ExpenseStats({ data, nav }: { data: AppData; nav: TabNav }) {
  const vehicle = currentVehicle(data)
  // 记住上次选的范围（与油耗分开，第一次是「全部」）
  const [range, setRange] = useState<StatsRange>(() => savedStatsRange("expense"))
  const entries = useMemo(() => {
    if (!vehicle) return []
    return withoutCarInsurance(expenseEntries(vehicleRecords(data, vehicle)), insuranceYears(data.ledger.insurance, vehicle.id))
  }, [data, vehicle?.id])
  const s = useMemo(() => expenseSummary(entries, range), [entries, range])
  const years = useMemo(() => expenseYears(entries), [entries])
  const palette = useMemo(() => categoryPalette(entries), [entries])
  const yearMax = Math.max(1, ...years.map(y => y.total))

  const empty = !vehicle || !entries.length
  const subtitle = vehicle ? [vehicle.name, s.from_ts != null ? `${fmtDate(s.from_ts)} 至今` : ""].filter(Boolean).join(" · ") : null

  function changeRange(v: StatsRange) {
    setRange(v)
    saveStatsRange("expense", v)
  }

  return <List
    navigationTitle={nav.title}
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    toolbar={nav.toolbar}
    {...(empty ? { overlay: <ContentUnavailableView title="还没有费用" systemImage="chart.bar" description="车险的保费在「保险」页。" /> } : {})}
  >
    {empty ? null : <>
      <Section key="range"><RangePicker range={range} onChanged={changeRange} /></Section>
      <SummarySection key="summary" data={data} caption={s.count ? `合计 · ${s.count} 笔` : "合计"} total={s.total} categories={s.categories} palette={palette}
        footer="只算费用，不含加油和车险；车险的保单和每年保费在「保险」页。小熊的保养记录和它关联的费用只算一次。" />
      <Section key="years" header={<Text>每年</Text>} footer={<Text>按付款日期。</Text>}>
        {years.map(y => <HStack key={String(y.year)} spacing={12}>
          <Text font="headline">{String(y.year)}</Text>
          <SegmentBar parts={palette.parts(y.categories)} max={yearMax} />
          <Text font="footnote" foregroundStyle="secondaryLabel">{`${y.count} 笔`}</Text>
          <Text>{yuan(y.total)}</Text>
        </HStack>)}
      </Section>
    </>}
  </List>
}
