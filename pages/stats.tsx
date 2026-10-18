// 统计（设计画布「统计页改版」）：范围、8 个数字、油耗走势、每月花费、同期对比、单价、每年。
// 油耗、每月花费、单价三张图可以按住左右滑动选点：图上方的大数字换成选中的那一点，并在图上标出。
// 横轴用文字类别（Scripting 的单点选择只支持文字和数字），刻度文字由 common/chart_axis.ts 生成。
import {
  BarStackChart, Chart, ContentUnavailableView, Grid, GridRow, HStack, LineCategoryChart, LineChart, List, NavigationStack, Picker,
  RoundedRectangle, RuleLineForLabelChart, RuleLineForValueChart, Section, Text, VirtualNode, VStack, ZStack, useMemo, useState,
} from "scripting"
import {
  AppData, consumptionSeries, currentVehicle, fmtDate, fmtDay, gradeText, monthCategories, monthlyCosts, monthTitle, niceDomain, priceSeries,
  RANGE_TITLES, RANGES, StatsRange, summarize, timeCategories, vehicleRecords, yearOverYear, yearSummaries,
} from "../common/model"
import { cspt, km, money, StatTile } from "./components"

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`)
/** 点多于这么多时横向滚动 */
const VISIBLE_POINTS = 40
const VISIBLE_MONTHS = 13

const r2 = (n: number) => Math.round(n * 100) / 100
const fixed = (n: number | null | undefined, d = 2) => (n == null ? "—" : n.toFixed(d))
const thousands = (n: number) => Math.round(n).toLocaleString("en-US")

/** 图上方：平时显示汇总，选点时显示选中的那一点 */
function ChartHead({ caption, value, unit }: { caption: string; value: string; unit?: string }) {
  return <VStack alignment="leading" spacing={1}>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{caption}</Text>
    <HStack alignment="lastTextBaseline" spacing={4}>
      <Text font="title2" fontWeight="semibold" monospacedDigit>{value}</Text>
      {unit ? <Text font="footnote" foregroundStyle="secondaryLabel">{unit}</Text> : null}
    </HStack>
  </VStack>
}

/** 选中点上方的说明 */
function Bubble({ lines }: { lines: Array<{ text: string; strong?: boolean; color?: "systemOrange" | "systemGreen" }> }) {
  return <ZStack padding={{ horizontal: 8, vertical: 6 }} background={<RoundedRectangle cornerRadius={10} fill="regularMaterial" />}>
    <VStack alignment="leading" spacing={1}>
      {lines.map((l, i) => <Text
        key={String(i)}
        font={l.strong ? "subheadline" : "caption2"}
        fontWeight={l.strong ? "semibold" : "regular"}
        monospacedDigit
        foregroundStyle={l.color || (l.strong ? "label" : "secondaryLabel")}
      >{l.text}</Text>)}
    </VStack>
  </ZStack>
}

const selectedRule = (label: string, color: "systemGreen" | "systemBlue", bubble: VirtualNode) => <RuleLineForLabelChart marks={[{
  label,
  foregroundStyle: color,
  annotation: { position: "top", overflowResolution: { x: "fit", y: "disabled" }, content: bubble },
}]} />

const averageRule = (value: number) => <RuleLineForValueChart marks={[{
  value, foregroundStyle: "secondaryLabel", lineStyle: { lineWidth: 1, dash: [4, 3] },
}]} />

/** 点多时横向滚动，初始停在最右边（最新） */
function scrollProps(labels: string[], visible: number) {
  return labels.length > visible
    ? { chartScrollableAxes: "horizontal" as const, chartXVisibleDomain: visible, chartScrollPositionX: labels[labels.length - visible] }
    : {}
}

export function StatsPage({ data }: { data: AppData }) {
  const vehicle = currentVehicle(data)
  const [range, setRange] = useState<StatsRange>("1y")
  const [selC, setSelC] = useState<string | null>(null)
  const [selM, setSelM] = useState<string | null>(null)
  const [selP, setSelP] = useState<string | null>(null)
  const records = useMemo(() => (vehicle ? vehicleRecords(data, vehicle) : []), [data, vehicle?.id])
  const s = useMemo(() => summarize(records, range), [records, range])
  const allAvg = useMemo(() => summarize(records, "all").avg_consumption, [records])
  const segs = useMemo(() => consumptionSeries(records, range), [records, range])
  const months = useMemo(() => monthlyCosts(records, range), [records, range])
  const prices = useMemo(() => priceSeries(records, range), [records, range])
  const yoy = useMemo(() => yearOverYear(records), [records])
  const years = useMemo(() => yearSummaries(records), [records])
  const cAxis = useMemo(() => timeCategories(segs.map(x => x.to.ts)), [segs])
  const mAxis = useMemo(() => monthCategories(months.map(m => m.month)), [months])
  const pAxis = useMemo(() => timeCategories(prices.map(p => p.ts)), [prices])
  const empty = !vehicle || !records.length

  function changeRange(v: string) {
    setRange(v as StatsRange)
    setSelC(null)
    setSelM(null)
    setSelP(null)
  }

  // ---------- 油耗 ----------
  const cIndex = selC != null ? cAxis.labels.indexOf(selC) : -1
  const seg = cIndex >= 0 ? segs[cIndex] : null
  const cDomain = niceDomain(segs.map(x => x.consumption), 1, 2)
  const consumptionChart = segs.length > 1 ? <Section key="consumption" header={<Text>油耗</Text>} footer={<Text>按住图表左右滑动，查看每一次的油耗</Text>}>
    {seg
      ? <ChartHead caption={`${fmtDay(seg.to.ts)} · ${gradeText(seg.to.grade)} · ${km(seg.distance)}`} value={fixed(seg.consumption)} unit="L/100km" />
      : <ChartHead caption={`平均 · ${segs.length} 次加满`} value={fixed(s.avg_consumption)} unit="L/100km" />}
    <Chart
      frame={{ height: 200 }}
      chartXSelection={{ valueType: "string", value: selC, onChanged: (v: string | null | undefined) => setSelC(v ?? null) }}
      chartXAxis={{ values: { type: "values", values: cAxis.ticks } }}
      chartYScale={{ domain: cDomain, type: "linear" }}
      {...scrollProps(cAxis.labels, VISIBLE_POINTS)}
    >
      <LineChart marks={segs.map((x, i) => ({
        label: cAxis.labels[i], value: r2(x.consumption), foregroundStyle: "systemGreen", symbol: "circle" as const, symbolSize: 24,
      }))} />
      {s.avg_consumption != null ? averageRule(r2(s.avg_consumption)) : null}
      {seg && selC ? selectedRule(selC, "systemGreen", <Bubble lines={[
        { text: fmtDay(seg.to.ts) },
        { text: `${fixed(seg.consumption)} L/100km`, strong: true },
        ...(s.avg_consumption != null ? [{
          text: `比平均${seg.consumption >= s.avg_consumption ? "高" : "低"} ${fixed(Math.abs(seg.consumption - s.avg_consumption))}`,
          color: seg.consumption > s.avg_consumption * 1.1 ? "systemOrange" as const : undefined,
        }] : []),
      ]} />) : null}
    </Chart>
  </Section> : null

  // ---------- 每月花费 ----------
  const mIndex = selM != null ? mAxis.labels.indexOf(selM) : -1
  const month = mIndex >= 0 ? months[mIndex] : null
  const days = s.from_ts != null ? Math.max(1, (Date.now() - s.from_ts) / 86400e3) : null
  const monthlyMean = days ? s.total_cost * 30.44 / Math.max(days, 30.44) : null
  const hasOther = months.some(m => m.other > 0)
  const monthChart = months.length ? <Section key="months" header={<Text>每月花费</Text>}>
    {month
      ? <ChartHead caption={`${monthTitle(month.month)} · 加油 ${month.fills} 次${month.other ? ` · 其他 ${money(month.other)}` : ""}`} value={money(month.fuel + month.other)} />
      : <ChartHead caption={`月均 · 合计 ${money(s.total_cost)}`} value={monthlyMean != null ? money(monthlyMean) : "—"} />}
    <Chart
      frame={{ height: 190 }}
      chartXSelection={{ valueType: "string", value: selM, onChanged: (v: string | null | undefined) => setSelM(v ?? null) }}
      chartXAxis={{ values: { type: "values", values: mAxis.ticks } }}
      chartForegroundStyleScale={{ "加油": "systemGreen", "其他费用": "systemBlue" }}
      chartLegend={hasOther ? "visible" : "hidden"}
      {...scrollProps(mAxis.labels, VISIBLE_MONTHS)}
    >
      <BarStackChart marks={months.flatMap((m, i) => [
        { category: "加油", label: mAxis.labels[i], value: Math.round(m.fuel), cornerRadius: 3, opacity: selM && selM !== mAxis.labels[i] ? 0.35 : 1 },
        ...(hasOther ? [{ category: "其他费用", label: mAxis.labels[i], value: Math.round(m.other), cornerRadius: 3, opacity: selM && selM !== mAxis.labels[i] ? 0.35 : 1 }] : []),
      ])} />
      {monthlyMean != null ? averageRule(Math.round(monthlyMean)) : null}
    </Chart>
  </Section> : null

  // ---------- 同期对比 ----------
  const yoyMarks = [
    ...yoy.previous.flatMap((v, i) => (v == null ? [] : [{ category: String(yoy.year - 1), label: MONTHS[i], value: r2(v), lineStyle: { lineWidth: 2, dash: [4, 3] }, symbol: "circle" as const, symbolSize: 16 }])),
    ...yoy.current.flatMap((v, i) => (v == null ? [] : [{ category: String(yoy.year), label: MONTHS[i], value: r2(v), lineStyle: { lineWidth: 2 }, symbol: "circle" as const, symbolSize: 16 }])),
  ]
  const yoyChart = yoyMarks.length ? <Section key="yoy" header={<Text>同期对比 · 每月平均油耗</Text>}>
    <ChartHead
      caption={`${yoy.year} 年 1–${yoy.month} 月${yoy.prevYtd != null ? ` · 去年同期 ${fixed(yoy.prevYtd)}` : ""}`}
      value={fixed(yoy.ytd)}
      unit="L/100km"
    />
    <Chart
      frame={{ height: 170 }}
      chartXScale={MONTHS}
      chartXAxis={{ values: { type: "values", values: ["1月", "3月", "5月", "7月", "9月", "11月"] } }}
      chartYScale={{ domain: niceDomain(yoyMarks.map(m => m.value), 1, 2), type: "linear" }}
      chartForegroundStyleScale={{ [String(yoy.year)]: "systemGreen", [String(yoy.year - 1)]: "systemGray" }}
    >
      <LineCategoryChart marks={yoyMarks} />
    </Chart>
  </Section> : null

  // ---------- 单价 ----------
  const pIndex = selP != null ? pAxis.labels.indexOf(selP) : -1
  const price = pIndex >= 0 ? prices[pIndex] : null
  const priceChart = prices.length > 1 ? <Section key="prices" header={<Text>单价</Text>}>
    {price
      ? <ChartHead caption={`${fmtDay(price.ts)} · ${gradeText(price.grade)} · 机显 ¥${fixed(price.pump)}`} value={`¥${fixed(price.paid)}`} unit="/L" />
      : <ChartHead caption={`平均实付 · 机显 ¥${fixed(s.pump_unit_price)}`} value={`¥${fixed(s.paid_unit_price)}`} unit="/L" />}
    <Chart
      frame={{ height: 170 }}
      chartXSelection={{ valueType: "string", value: selP, onChanged: (v: string | null | undefined) => setSelP(v ?? null) }}
      chartXAxis={{ values: { type: "values", values: pAxis.ticks } }}
      chartYScale={{ domain: niceDomain(prices.flatMap(p => [p.paid, p.pump]), 0.3, 0.5), type: "linear" }}
      chartForegroundStyleScale={{ "实付单价": "systemBlue", "机显单价": "systemGray" }}
      {...scrollProps(pAxis.labels, VISIBLE_POINTS)}
    >
      <LineCategoryChart marks={[
        ...prices.map((p, i) => ({ category: "机显单价", label: pAxis.labels[i], value: r2(p.pump), lineStyle: { lineWidth: 1.5, dash: [4, 3] } })),
        ...prices.map((p, i) => ({ category: "实付单价", label: pAxis.labels[i], value: r2(p.paid), lineStyle: { lineWidth: 2 } })),
      ]} />
      {price && selP ? selectedRule(selP, "systemBlue", <Bubble lines={[
        { text: `${fmtDay(price.ts)} · ${gradeText(price.grade)}` },
        { text: `实付 ¥${fixed(price.paid)}`, strong: true },
        ...(price.pump - price.paid > 0.005 ? [{ text: `机显 ¥${fixed(price.pump)}，优惠 ¥${fixed(price.pump - price.paid)}/L` }] : []),
      ]} />) : null}
    </Chart>
  </Section> : null

  // ---------- 每年 ----------
  const cell = (t: string, strong = false) => <Text font={strong ? "subheadline" : "footnote"} fontWeight={strong ? "semibold" : "regular"} monospacedDigit frame={{ maxWidth: "infinity", alignment: "trailing" }}>{t}</Text>
  const yearTable = years.length ? <Section key="years" header={<Text>每年</Text>}>
    <Grid horizontalSpacing={8} verticalSpacing={10}>
      <GridRow>
        {["年份", "加油", "里程", "花费", "油耗"].map(t => <Text key={t} font="caption" foregroundStyle="secondaryLabel" frame={{ maxWidth: "infinity", alignment: t === "年份" ? "leading" : "trailing" }}>{t}</Text>)}
      </GridRow>
      {years.map(y => <GridRow key={String(y.year)}>
        <Text font="subheadline" fontWeight="semibold" monospacedDigit frame={{ maxWidth: "infinity", alignment: "leading" }}>{String(y.year)}</Text>
        {cell(`${y.fills} 次`)}
        {cell(thousands(y.distance_km))}
        {cell(`¥${thousands(y.cost)}`)}
        {cell(fixed(y.avg_consumption))}
      </GridRow>)}
    </Grid>
  </Section> : null

  const subtitle = vehicle && s.from_ts != null ? `${vehicle.name} · ${fmtDate(s.from_ts)} 至今` : null

  return <NavigationStack>
    <List
      navigationTitle="统计"
      {...(subtitle ? { navigationSubtitle: subtitle } : {})}
      {...(empty ? { overlay: <ContentUnavailableView title="还没有数据" systemImage="chart.bar" /> } : {})}
    >
      {empty ? null : <>
        <Section key="range">
          <Picker title="范围" value={range} onChanged={changeRange} pickerStyle="segmented">
            {RANGES.map(r => <Text key={r} tag={r}>{RANGE_TITLES[r]}</Text>)}
          </Picker>
        </Section>
        <Section key="summary">
          <Grid horizontalSpacing={16} verticalSpacing={14}>
            <GridRow>
              <StatTile title="平均油耗" value={cspt(s.avg_consumption)} detail={`全部 ${fixed(allAvg)}`} />
              <StatTile title="每公里花费" value={s.cost_per_km != null ? `¥${s.cost_per_km.toFixed(2)}` : "—"} detail="加油和其他费用" />
            </GridRow>
            <GridRow>
              <StatTile title="行驶里程" value={km(s.distance_km)} detail={s.km_per_day != null ? `日均 ${s.km_per_day.toFixed(1)} km` : undefined} />
              <StatTile title="加油" value={`${s.fuel_count} 次`} detail={s.days_per_fill != null && s.km_per_fill != null ? `平均 ${s.days_per_fill.toFixed(1)} 天、${Math.round(s.km_per_fill)} km 一次` : undefined} />
            </GridRow>
            <GridRow>
              <StatTile title="加油花费" value={money(s.fuel_cost)} detail={`其他费用 ${money(s.other_cost)}`} />
              <StatTile title="优惠" value={money(s.discount)} detail={`机显 ${money(s.pump_amount)}`} />
            </GridRow>
            <GridRow>
              <StatTile title="实付单价" value={s.paid_unit_price != null ? `¥${s.paid_unit_price.toFixed(2)}/L` : "—"} detail={s.pump_unit_price != null ? `机显 ¥${s.pump_unit_price.toFixed(2)}/L` : undefined} />
              <StatTile title="加油量" value={`${thousands(s.fuel_liters)} L`} detail={s.liters_per_fill != null ? `平均 ${s.liters_per_fill.toFixed(1)} L 一次` : undefined} />
            </GridRow>
          </Grid>
        </Section>
        {consumptionChart}
        {monthChart}
        {yoyChart}
        {priceChart}
        {yearTable}
      </>}
    </List>
  </NavigationStack>
}
