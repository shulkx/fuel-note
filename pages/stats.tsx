// 统计：范围切换、汇总、每月花费、每次油耗
import { BarChart, Chart, ContentUnavailableView, Grid, GridRow, LineChart, List, NavigationStack, Picker, Section, Text, useMemo, useState } from "scripting"
import {
  AppData, consumptionSeries, currentVehicle, daysAgoText, monthlyCosts, RANGE_TITLES, StatsRange, summarize, vehicleRecords,
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

  return <NavigationStack>
    <List navigationTitle="统计">
      {!vehicle || !records.length ? <ContentUnavailableView title="还没有数据" systemImage="chart.bar" /> : null}
      {vehicle && records.length ? [
        <Section>
          <Picker title="范围" value={range} onChanged={(v: string) => setRange(v as StatsRange)} pickerStyle="segmented">
            {RANGES.map(r => <Text tag={r}>{RANGE_TITLES[r]}</Text>)}
          </Picker>
        </Section>,
        <Section title="油耗">
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
        </Section>,
        <Section title="花费">
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
        </Section>,
        months.length ? <Section title="每月花费">
          <Chart frame={{ height: 200 }}>
            <BarChart marks={months.map(m => ({ label: m.month.slice(2), value: Math.round(m.fuel + m.other) }))} />
          </Chart>
        </Section> : null,
        series.length > 1 ? <Section title="每次油耗（L/100km）">
          <Chart frame={{ height: 200 }}>
            <LineChart marks={series.map(seg => ({ label: new Date(seg.to.ts), value: Math.round(seg.consumption * 100) / 100, unit: "day" as const }))} />
          </Chart>
        </Section> : null,
      ] : null}
    </List>
  </NavigationStack>
}
