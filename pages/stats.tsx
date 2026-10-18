// 统计：范围切换、汇总、每月花费、每次油耗
import { BarChart, Chart, ContentUnavailableView, Grid, GridRow, LineChart, List, NavigationStack, Picker, Section, Text, useMemo, useState } from "scripting"
import {
  AppData, consumptionSeries, currentVehicle, daysAgoText, MonthCost, monthlyCosts, RANGE_TITLES, StatsRange, summarize, vehicleRecords,
} from "../common/model"
import { cspt, km, money, StatTile } from "./components"

const RANGES: StatsRange[] = ["12m", "year", "all"]

export function StatsPage({ data }: { data: AppData }) {
  const vehicle = currentVehicle(data)
  const [range, setRange] = useState<StatsRange>("12m")
  const records = useMemo(() => (vehicle ? vehicleRecords(data, vehicle) : []), [data, vehicle?.id])
  const s = useMemo(() => summarize(records, range), [records, range])
  const months = useMemo(() => monthlyCosts(records, range), [records, range])
  const series = useMemo(() => consumptionSeries(records, range), [records, range])

  // 没有花费的月份补 0，柱子不会因为空月份而错位；超过 12 个月时横向滚动，一屏显示 12 个月
  const bars = useMemo(() => fillMonths(months).map(m => ({ label: m.month.slice(2), value: Math.round(m.fuel + m.other) })), [months])
  const empty = !vehicle || !records.length

  return <NavigationStack>
    <List navigationTitle="统计" {...(empty ? { overlay: <ContentUnavailableView title="还没有数据" systemImage="chart.bar" /> } : {})}>
      {empty ? null : <>
        <Section key="range">
          <Picker title="范围" value={range} onChanged={(v: string) => setRange(v as StatsRange)} pickerStyle="segmented">
            {RANGES.map(r => <Text key={r} tag={r}>{RANGE_TITLES[r]}</Text>)}
          </Picker>
        </Section>
        <Section key="consumption" title="油耗">
          <Grid horizontalSpacing={16} verticalSpacing={14}>
            <GridRow>
              <StatTile title="平均油耗" value={cspt(s.avg_consumption)} />
              <StatTile title="最近一次" value={cspt(s.latest_consumption)} />
            </GridRow>
            <GridRow>
              <StatTile title="行驶里程" value={km(s.distance_km)} />
              <StatTile title="加油" value={`${s.fuel_count} 次`} detail={`${s.fuel_liters.toFixed(0)} 升`} />
            </GridRow>
          </Grid>
        </Section>
        <Section key="cost" title="花费">
          <Grid horizontalSpacing={16} verticalSpacing={14}>
            <GridRow>
              <StatTile title="加油花费" value={money(s.fuel_cost)} />
              <StatTile title="其他费用" value={money(s.other_cost)} />
            </GridRow>
            <GridRow>
              <StatTile title="合计" value={money(s.total_cost)} />
              <StatTile title="每公里" value={s.cost_per_km != null ? `¥${s.cost_per_km.toFixed(2)}` : "—"} />
            </GridRow>
          </Grid>
          {s.last_fuel_ts ? <Text font="footnote" foregroundStyle="secondaryLabel">{`上次加油：${daysAgoText(s.last_fuel_ts)} · 当前约 ${km(s.last_odometer)}`}</Text> : null}
        </Section>
        {bars.length ? <Section key="months" title="每月花费">
          <Chart frame={{ height: 200 }} {...(bars.length > 12 ? { chartScrollableAxes: "horizontal" as const, chartXVisibleDomain: 12 } : {})}>
            <BarChart marks={bars} />
          </Chart>
        </Section> : null}
        {series.length > 1 ? <Section key="series" title="每次油耗（L/100km）">
          <Chart frame={{ height: 200 }}>
            <LineChart marks={series.map(seg => ({ label: new Date(seg.to.ts), value: Math.round(seg.consumption * 100) / 100, unit: "day" as const }))} />
          </Chart>
        </Section> : null}
      </>}
    </List>
  </NavigationStack>
}

/** 第一个有花费的月份到最后一个之间，补上没有花费的月份 */
function fillMonths(months: MonthCost[]): MonthCost[] {
  if (!months.length) return []
  const out: MonthCost[] = []
  const byKey = new Map(months.map(m => [m.month, m]))
  let [y, m] = months[0].month.split("-").map(Number)
  const last = months[months.length - 1].month
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${String(m).padStart(2, "0")}`
    out.push(byKey.get(key) || { month: key, fuel: 0, other: 0 })
    if (key === last) break
    m += 1
    if (m > 12) { m = 1; y += 1 }
  }
  return out
}
