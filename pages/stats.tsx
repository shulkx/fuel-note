// 统计（设计画布「统计页改版」）：范围、8 个数字、油耗走势、每月花费、同期对比、单价、每年。
// 油耗、每月花费、单价三张图可以按住左右滑动选点：图上方的大数字换成选中的那一点，并在图上标出。
// 横轴用文字类别（Scripting 的单点选择只支持文字和数字），由 common/chart_axis.ts 生成：只有刻度的类别看得见。
import {
  BarStackChart, Chart, ContentUnavailableView, Grid, GridRow, HStack, LineCategoryChart, LineChart, List, NavigationStack, Picker,
  Rectangle, RoundedRectangle, RuleLineForLabelChart, RuleLineForValueChart, Section, Text, VirtualNode, VStack, useMemo, useState,
} from "scripting"
import {
  AppData, consumptionSeries, currentVehicle, fmtDate, fmtDay, gradeText, monthCategories, monthlyCosts, monthTitle, niceDomain, priceSeries,
  RANGE_TITLES, RANGES, saveStatsRange, savedStatsRange, StatsRange, summarize, timeCategories, vehicleRecords, YEAR_MONTHS, yearOverYear, yearSummaries,
} from "../common/model"
import { cspt, km, money, StatTile } from "./components"
import { leadingItems, VehicleMenuActions } from "./vehicle_menu"

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

/** 选中点上方的说明：一行，日期等在图上方的大数字那里 */
function Bubble({ value, note, warn }: { value: string; note?: string; warn?: boolean }) {
  return <HStack spacing={6} padding={{ horizontal: 8, vertical: 5 }} background={<RoundedRectangle cornerRadius={8} fill="regularMaterial" />}>
    <Text font="subheadline" fontWeight="semibold" monospacedDigit>{value}</Text>
    {note ? <Text font="caption" monospacedDigit foregroundStyle={warn ? "systemOrange" : "secondaryLabel"}>{note}</Text> : null}
  </HStack>
}

/** 说明画在图的上边之外（不挤占图），所以图上方要留出这么高 */
const BUBBLE_SPACE = 34

const selectedRule = (label: string, color: "systemGreen" | "systemBlue", bubble: VirtualNode) => <RuleLineForLabelChart marks={[{
  label,
  foregroundStyle: color,
  annotation: { position: "top", spacing: 2, overflowResolution: { x: "fit", y: "disabled" }, content: bubble },
}]} />

/**
 * 大数字和图放在同一行：放在两行时，画在图上方的说明会被上一行盖住。
 * 有说明的图在两者之间留出 BUBBLE_SPACE。
 */
function chartRow(head: VirtualNode, chart: VirtualNode, bubble: boolean) {
  return <VStack alignment="leading" spacing={bubble ? BUBBLE_SPACE : 12}>
    {head}
    {chart}
  </VStack>
}

/** 横轴：只显示刻度文字，不画竖线（点多时竖线太密） */
const xAxis = (ticks: string[]) => ({ values: { type: "values" as const, values: ticks }, gridLine: false })

const averageRule = (value: number) => <RuleLineForValueChart marks={[{
  value, foregroundStyle: "secondaryLabel", lineStyle: { lineWidth: 1, dash: [4, 3] },
}]} />

/** 点多时横向滚动，初始停在最右边（最新） */
function scrollProps(labels: string[], visible: number) {
  return labels.length > visible
    ? { chartScrollableAxes: "horizontal" as const, chartXVisibleDomain: visible, chartScrollPositionX: labels[labels.length - visible] }
    : {}
}

export function StatsPage({ data, vehicleActions, statusItem }: { data: AppData; vehicleActions: VehicleMenuActions; statusItem: VirtualNode | null }) {
  const vehicle = currentVehicle(data)
  // 记住上次选的范围（第一次是「今年」）
  const [range, setRange] = useState<StatsRange>(() => savedStatsRange())
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
    saveStatsRange(v as StatsRange)
    setSelC(null)
    setSelM(null)
    setSelP(null)
  }

  // ---------- 油耗 ----------
  const cIndex = selC != null ? cAxis.labels.indexOf(selC) : -1
  const seg = cIndex >= 0 ? segs[cIndex] : null
  const cDomain = niceDomain(segs.map(x => x.consumption), 1, 2)
  const avgC = s.avg_consumption
  const consumptionChart = segs.length > 1 ? <Section key="consumption" header={<Text>油耗</Text>} footer={<Text>按住图表左右滑动，查看每一次的油耗</Text>}>
    {chartRow(
      seg
        ? <ChartHead caption={`${fmtDay(seg.to.ts)} · ${gradeText(seg.to.grade)} · ${km(seg.distance)}`} value={fixed(seg.consumption)} unit="L/100km" />
        : <ChartHead caption={`平均 · ${segs.length} 次加满`} value={fixed(avgC)} unit="L/100km" />,
      <Chart
        frame={{ height: 200 }}
        chartXSelection={{ valueType: "string", value: selC, onChanged: (v: string | null | undefined) => setSelC(v ?? null) }}
        chartXAxis={xAxis(cAxis.ticks)}
        chartYScale={{ domain: cDomain, type: "linear" }}
        {...scrollProps(cAxis.labels, VISIBLE_POINTS)}
      >
        <LineChart marks={segs.map((x, i) => ({
          label: cAxis.labels[i], value: r2(x.consumption), foregroundStyle: "systemGreen", symbol: "circle" as const, symbolSize: 24,
        }))} />
        {avgC != null ? averageRule(r2(avgC)) : null}
        {seg && selC ? selectedRule(selC, "systemGreen", avgC != null
          ? <Bubble
            value={fixed(seg.consumption)}
            note={`比平均${seg.consumption >= avgC ? "高" : "低"} ${fixed(Math.abs(seg.consumption - avgC))}`}
            warn={seg.consumption > avgC * 1.1}
          />
          : <Bubble value={fixed(seg.consumption)} />) : null}
      </Chart>,
      true,
    )}
  </Section> : null

  // ---------- 每月花费 ----------
  const mIndex = selM != null ? mAxis.labels.indexOf(selM) : -1
  const month = mIndex >= 0 ? months[mIndex] : null
  const days = s.from_ts != null ? Math.max(1, (Date.now() - s.from_ts) / 86400e3) : null
  const monthlyMean = days ? s.total_cost * 30.44 / Math.max(days, 30.44) : null
  const hasOther = months.some(m => m.other > 0)
  const monthChart = months.length ? <Section key="months" header={<Text>每月花费</Text>}>
    {chartRow(
      month
        ? <ChartHead caption={`${monthTitle(month.month)} · 加油 ${month.fills} 次${month.other ? ` · 其他 ${money(month.other)}` : ""}`} value={money(month.fuel + month.other)} />
        : <ChartHead caption={`月均 · 合计 ${money(s.total_cost)}`} value={monthlyMean != null ? money(monthlyMean) : "—"} />,
      <Chart
        frame={{ height: 190 }}
        chartXSelection={{ valueType: "string", value: selM, onChanged: (v: string | null | undefined) => setSelM(v ?? null) }}
        chartXAxis={xAxis(mAxis.ticks)}
        chartForegroundStyleScale={{ "加油": "systemGreen", "其他费用": "systemBlue" }}
        chartLegend={hasOther ? "visible" : "hidden"}
        {...scrollProps(mAxis.labels, VISIBLE_MONTHS)}
      >
        <BarStackChart marks={months.flatMap((m, i) => [
          { category: "加油", label: mAxis.labels[i], value: Math.round(m.fuel), cornerRadius: 3, opacity: selM && selM !== mAxis.labels[i] ? 0.35 : 1 },
          ...(hasOther ? [{ category: "其他费用", label: mAxis.labels[i], value: Math.round(m.other), cornerRadius: 3, opacity: selM && selM !== mAxis.labels[i] ? 0.35 : 1 }] : []),
        ])} />
        {monthlyMean != null ? averageRule(Math.round(monthlyMean)) : null}
      </Chart>,
      false,
    )}
  </Section> : null

  // ---------- 同期对比 ----------
  const yoyMarks = [
    ...yoy.previous.flatMap((v, i) => (v == null ? [] : [{ category: String(yoy.year - 1), label: YEAR_MONTHS[i], value: r2(v), lineStyle: { lineWidth: 2, dash: [4, 3] }, symbol: "circle" as const, symbolSize: 16 }])),
    ...yoy.current.flatMap((v, i) => (v == null ? [] : [{ category: String(yoy.year), label: YEAR_MONTHS[i], value: r2(v), lineStyle: { lineWidth: 2 }, symbol: "circle" as const, symbolSize: 16 }])),
  ]
  const yoyChart = yoyMarks.length ? <Section key="yoy" header={<Text>同期对比 · 每月平均油耗</Text>}>
    {chartRow(
      <ChartHead
        caption={`${yoy.year} 年 1–${yoy.month} 月${yoy.prevYtd != null ? ` · 去年同期 ${fixed(yoy.prevYtd)}` : ""}`}
        value={fixed(yoy.ytd)}
        unit="L/100km"
      />,
      <Chart
        frame={{ height: 170 }}
        chartXScale={YEAR_MONTHS}
        chartXAxis={xAxis(YEAR_MONTHS.filter((_, i) => i % 2 === 0))}
        chartYScale={{ domain: niceDomain(yoyMarks.map(m => m.value), 1, 2), type: "linear" }}
        chartForegroundStyleScale={{ [String(yoy.year)]: "systemGreen", [String(yoy.year - 1)]: "systemGray" }}
      >
        <LineCategoryChart marks={yoyMarks} />
      </Chart>,
      false,
    )}
  </Section> : null

  // ---------- 单价 ----------
  const pIndex = selP != null ? pAxis.labels.indexOf(selP) : -1
  const price = pIndex >= 0 ? prices[pIndex] : null
  const priceChart = prices.length > 1 ? <Section key="prices" header={<Text>单价</Text>}>
    {chartRow(
      price
        ? <ChartHead caption={`${fmtDay(price.ts)} · ${gradeText(price.grade)} · 机显 ¥${fixed(price.pump)}`} value={`¥${fixed(price.paid)}`} unit="/L" />
        : <ChartHead caption={`平均实付 · 机显 ¥${fixed(s.pump_unit_price)}`} value={`¥${fixed(s.paid_unit_price)}`} unit="/L" />,
      <Chart
        frame={{ height: 170 }}
        chartXSelection={{ valueType: "string", value: selP, onChanged: (v: string | null | undefined) => setSelP(v ?? null) }}
        chartXAxis={xAxis(pAxis.ticks)}
        chartYScale={{ domain: niceDomain(prices.flatMap(p => [p.paid, p.pump]), 0.3, 0.5), type: "linear" }}
        chartForegroundStyleScale={{ "实付单价": "systemBlue", "机显单价": "systemGray" }}
        {...scrollProps(pAxis.labels, VISIBLE_POINTS)}
      >
        <LineCategoryChart marks={[
          ...prices.map((p, i) => ({ category: "机显单价", label: pAxis.labels[i], value: r2(p.pump), lineStyle: { lineWidth: 1.5, dash: [4, 3] } })),
          ...prices.map((p, i) => ({ category: "实付单价", label: pAxis.labels[i], value: r2(p.paid), lineStyle: { lineWidth: 2 } })),
        ]} />
        {price && selP ? selectedRule(selP, "systemBlue", price.pump - price.paid > 0.005
          ? <Bubble value={`¥${fixed(price.paid)}`} note={`优惠 ¥${fixed(price.pump - price.paid)}/L`} />
          : <Bubble value={`¥${fixed(price.paid)}`} />) : null}
      </Chart>,
      true,
    )}
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
      toolbar={{ topBarLeading: leadingItems(data, vehicleActions, statusItem) }}
      {...(empty ? { overlay: <ContentUnavailableView title="还没有数据" systemImage="chart.bar" /> } : {})}
    >
      {empty ? null : <>
        {/* 范围切换直接放在背景上（与「健康」的 天/周/月 相同），不套分区的卡片；宽度与下面的卡片对齐 */}
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
