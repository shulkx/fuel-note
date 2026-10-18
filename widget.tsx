// 桌面与锁屏小组件：只读本机文件，不联网。
// 小号点击直接记加油；中号点击打开油记，右下角按钮记加油；锁屏有圆形、矩形、单行三种。
// 着色外观下只把大数字设为强调色（widgetAccentable），其余跟随系统。
import { AccessoryWidgetBackground, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { daysAgoText, widgetSnapshot, WidgetSnapshot } from "./common/model"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
const addFuelURL = () => Script.createRunURLScheme(Script.name, { action: "add_fuel" })
const openURL = () => Script.createRunURLScheme(Script.name)

function lastFuelText(s: WidgetSnapshot): string {
  return s.summary?.last_fuel_ts ? `上次加油 ${daysAgoText(s.summary.last_fuel_ts)}` : "还没有加油记录"
}

function Main({ s }: { s: WidgetSnapshot }) {
  const sum = s.summary
  return <VStack alignment="leading" spacing={4}>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{s.vehicle || "油记"}</Text>
    <Spacer />
    <Text font="caption2" foregroundStyle="secondaryLabel">最近油耗</Text>
    <HStack alignment="lastTextBaseline" spacing={3}>
      <Text font={34} fontWeight="semibold" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(sum?.latest_consumption)}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">L/100km</Text>
    </HStack>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{`平均 ${num(sum?.avg_consumption)}`}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>
  </VStack>
}

function Medium({ s }: { s: WidgetSnapshot }) {
  return <HStack spacing={16} padding widgetURL={openURL()}>
    <Main s={s} />
    <Spacer />
    <VStack alignment="trailing" spacing={6}>
      <Text font="caption2" foregroundStyle="secondaryLabel">本月花费</Text>
      <Text font="title3" fontWeight="semibold" monospacedDigit>{`¥${s.month_cost.toFixed(0)}`}</Text>
      {s.pending ? <Text font="caption2" foregroundStyle="systemOrange">{`${s.pending} 条待上传`}</Text> : null}
      <Spacer />
      <Link url={addFuelURL()}>
        <HStack spacing={5} padding={{ horizontal: 14, vertical: 9 }} background={{ style: "tertiarySystemFill", shape: "capsule" }}>
          <Image systemName="plus" font="footnote" fontWeight="semibold" />
          <Text font="subheadline" fontWeight="semibold">记加油</Text>
        </HStack>
      </Link>
    </VStack>
  </HStack>
}

function Rectangular({ s }: { s: WidgetSnapshot }) {
  return <VStack alignment="leading" spacing={1} frame={{ maxWidth: "infinity", alignment: "leading" }} widgetURL={addFuelURL()}>
    <HStack spacing={4}>
      <Image systemName="fuelpump.fill" font="caption" />
      <Text font="caption" fontWeight="semibold">油记</Text>
    </HStack>
    <Text font="headline" monospacedDigit widgetAccentable lineLimit={1}>{`${num(s.summary?.latest_consumption)} L/100km`}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>
  </VStack>
}

function Circular({ s }: { s: WidgetSnapshot }) {
  return <ZStack widgetURL={addFuelURL()}>
    <AccessoryWidgetBackground />
    <VStack spacing={0}>
      <Text font="headline" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(s.summary?.latest_consumption, 1)}</Text>
      <Text font={9} foregroundStyle="secondaryLabel">L/100km</Text>
    </VStack>
  </ZStack>
}

function WidgetView({ s }: { s: WidgetSnapshot }) {
  switch (Widget.family) {
    case "systemMedium":
      return <Medium s={s} />
    case "accessoryRectangular":
      return <Rectangular s={s} />
    case "accessoryCircular":
      return <Circular s={s} />
    case "accessoryInline":
      return <Text widgetURL={addFuelURL()}>{`油记 ${num(s.summary?.latest_consumption)} L/100km · ${s.summary?.last_fuel_ts ? daysAgoText(s.summary.last_fuel_ts) : "—"}`}</Text>
    default:
      return <VStack padding widgetURL={addFuelURL()}>
        <Main s={s} />
      </VStack>
  }
}

Widget.present(<WidgetView s={widgetSnapshot()} />)
