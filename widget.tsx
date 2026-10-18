// 桌面与锁屏小组件：只读 App 写的 widget.json，不联网。
// 小号、锁屏点击直接记加油；中号左侧打开油记，右下角按钮记加油（有 Link 时 widgetURL 会被忽略，所以中号两块都用 Link）。
// 着色外观下只把大数字设为强调色（widgetAccentable）。每天零点后刷新一次，「N 天前」和本月花费按天更新。
import { AccessoryWidgetBackground, HStack, Image, Link, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import { daysAgoText, monthCostNow, nextRefreshDate, readWidgetSnapshot, WidgetSnapshot } from "./common/widget_data"

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
  switch (Widget.family) {
    case "systemMedium": return <Medium s={s} />
    case "accessoryRectangular": return <Rectangular s={s} />
    case "accessoryCircular": return <Circular s={s} />
    case "accessoryInline": return <Inline s={s} />
    default: return <VStack padding widgetURL={addFuelURL()}><Main s={s} /></VStack>
  }
}

Widget.present(<WidgetView s={readWidgetSnapshot()} />, { policy: "after", date: nextRefreshDate() })
