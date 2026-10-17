// 桌面小组件：只读本机文件，不联网；点击打开记加油
import { HStack, Script, Spacer, Text, VStack, Widget } from "scripting"
import { daysAgoText, widgetSnapshot, WidgetSnapshot } from "./common/model"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))

function Main({ s }: { s: WidgetSnapshot }) {
  const sum = s.summary
  return <VStack alignment="leading" spacing={4}>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{s.vehicle || "车账本"}</Text>
    <Spacer />
    <Text font="caption2" foregroundStyle="secondaryLabel">最近油耗</Text>
    <HStack alignment="lastTextBaseline" spacing={3}>
      <Text font={34} fontWeight="semibold" monospacedDigit minScaleFactor={0.6} lineLimit={1}>{num(sum?.latest_consumption)}</Text>
      <Text font="caption2" foregroundStyle="secondaryLabel">L/100km</Text>
    </HStack>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{`平均 ${num(sum?.avg_consumption)}`}</Text>
    <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{sum?.last_fuel_ts ? `上次加油 ${daysAgoText(sum.last_fuel_ts)}` : "还没有加油记录"}</Text>
  </VStack>
}

function WidgetView({ s }: { s: WidgetSnapshot }) {
  const url = Script.createRunURLScheme(Script.name, { action: "add_fuel" })
  if (Widget.family === "systemMedium") {
    return <HStack spacing={16} padding widgetURL={url}>
      <Main s={s} />
      <Spacer />
      <VStack alignment="trailing" spacing={6}>
        <Spacer />
        <Text font="caption2" foregroundStyle="secondaryLabel">本月花费</Text>
        <Text font="title3" fontWeight="semibold" monospacedDigit>{`¥${s.month_cost.toFixed(0)}`}</Text>
        <Text font="caption2" foregroundStyle="secondaryLabel">当前里程</Text>
        <Text font="callout" monospacedDigit>{s.summary?.last_odometer != null ? `${Math.round(s.summary.last_odometer).toLocaleString("en-US")} km` : "—"}</Text>
        {s.pending ? <Text font="caption2" foregroundStyle="systemOrange">{`${s.pending} 条待上传`}</Text> : null}
      </VStack>
    </HStack>
  }
  return <VStack padding widgetURL={url}>
    <Main s={s} />
  </VStack>
}

Widget.present(<WidgetView s={widgetSnapshot()} />)
