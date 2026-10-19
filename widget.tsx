// 桌面与锁屏小组件：只读 App 写的 widget.json，不联网（参数为「诊断」时除外，见文件末尾）。
// 小号、锁屏点击直接记加油；中号左侧打开油记，右下角按钮记加油（有 Link 时 widgetURL 会被忽略，所以中号两块都用 Link）。
// 当前车辆能读车况（设计文档第 18 节）时，小号、中号、锁屏圆形显示剩余油量；其他尺寸和没有车况来源的车辆照旧显示油耗。
// 着色外观下只把大数字设为强调色（widgetAccentable）。每天零点后刷新一次，「N 天前」和本月花费按天更新。
import { AccessoryWidgetBackground, fetch, Gauge, HStack, Image, Link, ProgressView, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  daysAgoText, fuelLow, fuelRatio, monthCostNow, nextRefreshDate, readWidgetSnapshot, statusStale, statusWhen, WidgetSnapshot, WidgetStatus,
} from "./common/widget_data"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
// run_single：油记已经打开时不再起第二个实例（文档对需要避免并发执行的脚本的建议）
const addFuelURL = () => Script.createRunSingleURLScheme(Script.name, { action: "add_fuel" })
const openURL = () => Script.createRunSingleURLScheme(Script.name)

function lastFuelText(s: WidgetSnapshot): string {
  return s.last_fuel_ts ? `上次加油 ${daysAgoText(s.last_fuel_ts)}` : "还没有加油记录"
}

function Main({ s }: { s: WidgetSnapshot }) {
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{s.vehicle || "油记"}</Text>
    <Spacer />
    <Text font="caption2" foregroundStyle="secondaryLabel">最近油耗</Text>
    <HStack alignment="lastTextBaseline" spacing={3}>
      <Text font={34} fontWeight="semibold" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(s.latest_consumption)}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">L/100km</Text>
    </HStack>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{`平均 ${num(s.avg_consumption)}`}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>
  </VStack>
}

function Medium({ s }: { s: WidgetSnapshot }) {
  return <HStack spacing={16} padding>
    <Link url={openURL()}>
      <Main s={s} />
    </Link>
    <VStack alignment="trailing" spacing={6}>
      <Text font="caption2" foregroundStyle="secondaryLabel">本月花费</Text>
      <Text font="title3" fontWeight="semibold" monospacedDigit>{`¥${monthCostNow(s).toFixed(0)}`}</Text>
      {s.pending ? <Text font="caption2" foregroundStyle="systemOrange">{`${s.pending} 条待上传`}</Text> : null}
      <Spacer />
      <AddFuelButton />
    </VStack>
  </HStack>
}

function AddFuelButton() {
  return <Link url={addFuelURL()}>
    <HStack spacing={5} padding={{ horizontal: 14, vertical: 9 }} background={{ style: "tertiarySystemFill", shape: "capsule" }}>
      <Image systemName="plus" font="footnote" fontWeight="semibold" />
      <Text font="subheadline" fontWeight="semibold">记加油</Text>
    </HStack>
  </Link>
}

// ---------- 车况（设计文档 18.2 节） ----------

/** 车况的显示状态：油量低为橙色；车况超过 1 天时数字和油量条变灰，时间写成「N 天前」并为橙色 */
function fuelLook(st: WidgetStatus) {
  const stale = statusStale(st.ts)
  const low = fuelLow(st.fuel_l, st.tank_l, st.range_km)
  return {
    fuel: st.fuel_l == null ? "—" : String(Math.round(st.fuel_l)),
    ratio: fuelRatio(st.fuel_l, st.tank_l),
    low,
    stale,
    tint: stale ? "systemGray" as const : low ? "systemOrange" as const : "systemGreen" as const,
    when: st.ts == null ? "" : stale ? daysAgoText(st.ts) : statusWhen(st.ts),
  }
}

/** 大字剩余升数、油量条、续航和车况时间（小号和中号左侧共用） */
function FuelBlock({ s, st, tankInUnit }: { s: WidgetSnapshot; st: WidgetStatus | null; tankInUnit: boolean }) {
  const look = st ? fuelLook(st) : null
  const numberStyle = look ? (look.stale ? { foregroundStyle: "secondaryLabel" as const } : look.low ? { foregroundStyle: "systemOrange" as const } : {}) : {}
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
    <HStack spacing={4}>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{s.vehicle || "油记"}</Text>
      <Spacer />
      <Image systemName="fuelpump.fill" font="caption" foregroundStyle={look ? look.tint : "secondaryLabel"} />
    </HStack>
    <Spacer />
    {st && look
      ? <VStack alignment="leading" spacing={4}>
        <HStack alignment="lastTextBaseline" spacing={3}>
          <Text font={34} fontWeight="semibold" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable {...numberStyle}>{look.fuel}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{tankInUnit && st.tank_l ? `L / ${st.tank_l}` : "L"}</Text>
        </HStack>
        {look.ratio != null ? <ProgressView value={look.ratio} tint={look.tint} /> : null}
        <Text font="footnote" monospacedDigit lineLimit={1}>
          {[st.range_km != null ? `约 ${st.range_km} km` : "", look.low && !look.stale ? "油量低" : ""].filter(Boolean).join(" · ") || "续航未知"}
        </Text>
        <Text font="caption2" foregroundStyle={look.stale ? "systemOrange" : "secondaryLabel"} monospacedDigit lineLimit={1}>{look.when}</Text>
      </VStack>
      : <VStack alignment="leading" spacing={2}>
        <Text font="headline" foregroundStyle="secondaryLabel">还没有车况</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">打开油记后读取</Text>
      </VStack>}
  </VStack>
}

function FuelSmall({ s }: { s: WidgetSnapshot }) {
  return <VStack padding widgetURL={addFuelURL()}>
    <FuelBlock s={s} st={s.status} tankInUnit={false} />
  </VStack>
}

/** 中号：左边油量（打开油记），右边保留最近油耗、平均油耗、本月花费和「记加油」 */
function FuelMedium({ s }: { s: WidgetSnapshot }) {
  return <HStack spacing={14} padding>
    <Link url={openURL()}>
      <FuelBlock s={s} st={s.status} tankInUnit />
    </Link>
    <VStack alignment="trailing" spacing={3}>
      <Text font="caption2" foregroundStyle="secondaryLabel">最近油耗</Text>
      <Text font="title3" fontWeight="semibold" monospacedDigit>{num(s.latest_consumption)}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" monospacedDigit>{`平均 ${num(s.avg_consumption)}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" monospacedDigit>{`本月 ¥${monthCostNow(s).toFixed(0)}`}</Text>
      {s.pending ? <Text font="caption2" foregroundStyle="systemOrange">{`${s.pending} 条待上传`}</Text> : null}
      <Spacer />
      <AddFuelButton />
    </VStack>
  </HStack>
}

/** 锁屏圆形：油量圆环，中间剩余升数；不知道油箱容量时只显示升数；还没有车况时圆环为空，中间是油量图标 */
function FuelCircular({ s }: { s: WidgetSnapshot }) {
  const st = s.status
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const center = st && st.fuel_l != null
    ? <VStack spacing={0}>
      <Image systemName="fuelpump.fill" font={10} />
      <Text font="headline" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{String(Math.round(st.fuel_l))}</Text>
    </VStack>
    : <Image systemName="fuelpump.fill" font="title3" />
  if (st && ratio == null) {
    return <ZStack widgetURL={addFuelURL()}>
      <AccessoryWidgetBackground />
      {center}
    </ZStack>
  }
  return <ZStack widgetURL={addFuelURL()}>
    <Gauge value={ratio ?? 0} min={0} max={1} label={<Text>油量</Text>} currentValueLabel={center} gaugeStyle="accessoryCircularCapacity" />
  </ZStack>
}

// ---------- 其他尺寸 ----------

function Rectangular({ s }: { s: WidgetSnapshot }) {
  return <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity", alignment: "leading" }} widgetURL={addFuelURL()}>
    <HStack spacing={4}>
      <Image systemName="fuelpump.fill" font="caption" />
      <Text font="caption" fontWeight="semibold">油记</Text>
    </HStack>
    <Text font="headline" monospacedDigit widgetAccentable lineLimit={1}>{`${num(s.latest_consumption)} L/100km`}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>
  </VStack>
}

function Circular({ s }: { s: WidgetSnapshot }) {
  return <ZStack widgetURL={addFuelURL()}>
    <AccessoryWidgetBackground />
    <VStack spacing={0}>
      <Text font="headline" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(s.latest_consumption, 1)}</Text>
      <Text font={9} foregroundStyle="secondaryLabel">L/100km</Text>
    </VStack>
  </ZStack>
}

function Inline({ s }: { s: WidgetSnapshot }) {
  const when = s.last_fuel_ts ? ` · ${daysAgoText(s.last_fuel_ts)}` : ""
  return <HStack widgetURL={addFuelURL()}>
    <Image systemName="fuelpump.fill" />
    <Text>{`${num(s.latest_consumption, 1)} L/100km${when}`}</Text>
  </HStack>
}

function WidgetView({ s }: { s: WidgetSnapshot }) {
  const fuel = s.status_source
  switch (Widget.family) {
    case "systemMedium": return fuel ? <FuelMedium s={s} /> : <Medium s={s} />
    case "accessoryRectangular": return <Rectangular s={s} />
    case "accessoryCircular": return fuel ? <FuelCircular s={s} /> : <Circular s={s} />
    case "accessoryInline": return <Inline s={s} />
    default: return fuel ? <FuelSmall s={s} /> : <VStack padding widgetURL={addFuelURL()}><Main s={s} /></VStack>
  }
}

/**
 * 诊断（设计文档 18.3 节）：编辑小组件、把参数填成「诊断」时，显示小组件里能不能读钥匙串、能不能联网，
 * 用来决定小组件能不能自己读车况。平时不影响小组件
 */
async function diagnose(): Promise<string[]> {
  const lines: string[] = []
  try {
    lines.push(`钥匙串：${Keychain.get("fuelnote.provider.volvo_cn") ? "能读到沃尔沃凭据" : "没有读到沃尔沃凭据"}`)
  } catch (e) {
    lines.push(`钥匙串：读取出错（${e instanceof Error ? e.message : String(e)}）`)
  }
  try {
    const res = await fetch("https://www.apple.com/library/test/success.html", { timeout: 10 })
    lines.push(`网络：HTTP ${res.status}`)
  } catch (e) {
    lines.push(`网络：失败（${e instanceof Error ? e.message : String(e)}）`)
  }
  const d = new Date()
  lines.push(`时间：${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`)
  return lines
}

if (Widget.parameter === "诊断") {
  diagnose().then(lines => Widget.present(
    <VStack alignment="leading" spacing={4} padding>
      <Text font="caption" fontWeight="semibold">油记 · 小组件诊断</Text>
      {lines.map(l => <Text key={l} font="caption2">{l}</Text>)}
    </VStack>,
    { policy: "after", date: new Date(Date.now() + 15 * 60e3) },
  ))
} else {
  Widget.present(<WidgetView s={readWidgetSnapshot()} />, { policy: "after", date: nextRefreshDate() })
}
