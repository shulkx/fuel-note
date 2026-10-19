// 桌面与锁屏小组件：显示 App 写的 widget.json（界面见画布「小组件改版：油耗为主，车况为辅」，B 配色）。
// - 油耗是主体：大数字为最近油耗，下面是与平均的对比；剩余油量是辅助信息（右上角胶囊、中号右侧、锁屏圆环）。
// - 小号、中号：上面信息区打开油记，下面「记加油」按钮记加油（有 Link 时 widgetURL 会被忽略，所以两块都用 Link；Apple 文档：小号也可以有多个点击区域）。
// - 锁屏点击直接记加油。着色外观下背景和胶囊隐藏（widgetBackground），只把大数字设为强调色（widgetAccentable）。
// 车况超过 1 小时时，小组件用油记的凭据自己读一次再显示（设计文档 18.3 节第 2 步）；数据要在 Widget.present 之前准备好（Scripting 文档）。
// 显示车况的 1 小时后刷新，其他的每天零点后刷新。只从 common/widget_runtime 导入（打包器的限制，设计文档 9.4 节）。
import { AccessoryWidgetBackground, Divider, fetch, Gauge, HStack, Image, Link, ProgressView, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  consumptionTrend, daysAgoText, fuelRatio, fuelTone, lastWidgetRefresh, monthCostNow, readWidgetSnapshot, refreshWidgetStatus,
  widgetRefreshDate, WidgetSnapshot, WidgetStatus,
} from "./common/widget_runtime"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
// run_single：油记已经打开时不再起第二个实例（文档对需要避免并发执行的脚本的建议）
const addFuelURL = () => Script.createRunSingleURLScheme(Script.name, { action: "add_fuel" })
const openURL = () => Script.createRunSingleURLScheme(Script.name)

/** B 配色：浅色、深色模式各一套（系统默认的白、深灰背景） */
const C = {
  accent: { light: "#0F766E", dark: "#5EEAD4" },
  sub: { light: "#4B5563", dark: "#A1A1AA" },
  good: { light: "#15803D", dark: "#86EFAC" },
  goodBg: { light: "#DCFCE7", dark: "rgba(74,222,128,0.18)" },
  bad: { light: "#C2410C", dark: "#FDBA74" },
  badBg: { light: "#FFEDD5", dark: "rgba(251,146,60,0.2)" },
  mutedBg: { light: "#F3F4F6", dark: "rgba(255,255,255,0.1)" },
  cost: { light: "#C2410C", dark: "#FDBA74" },
  button: { light: "#0F766E", dark: "#14B8A6" },
  buttonText: { light: "#FFFFFF", dark: "#042F2E" },
  fuel: { light: "#10B981", dark: "#34D399" },
  fuelLow: { light: "#F97316", dark: "#FB923C" },
} as const

const TONE = {
  normal: { fg: C.good, bg: C.goodBg, bar: C.fuel },
  low: { fg: C.bad, bg: C.badBg, bar: C.fuelLow },
  stale: { fg: C.sub, bg: C.mutedBg, bar: C.fuel },
} as const

function lastFuelText(s: WidgetSnapshot): string {
  return s.last_fuel_ts ? `${daysAgoText(s.last_fuel_ts)}加油` : "还没有加油记录"
}

const litres = (st: WidgetStatus) => (st.fuel_l == null ? "—" : String(Math.round(st.fuel_l)))

/** 大数字：最近油耗 */
function Consumption({ s, size }: { s: WidgetSnapshot; size: number }) {
  return <HStack alignment="lastTextBaseline" spacing={4}>
    <Text font={size} fontWeight="bold" fontDesign="rounded" monospacedDigit minScaleFactor={0.6} lineLimit={1} foregroundStyle={C.accent} widgetAccentable>
      {num(s.latest_consumption)}
    </Text>
    <Text font="caption2" foregroundStyle={C.sub}>L/100km</Text>
  </HStack>
}

/** 与平均的对比：低于平均为绿，高于平均为橙 */
function TrendChip({ s }: { s: WidgetSnapshot }) {
  const t = consumptionTrend(s.latest_consumption, s.avg_consumption)
  if (!t) return <Text font="caption" foregroundStyle={C.sub} lineLimit={1}>{lastFuelText(s)}</Text>
  const tone = t.dir === "down" ? TONE.normal : t.dir === "up" ? TONE.low : TONE.stale
  const icon = t.dir === "down" ? "arrow.down.right" : t.dir === "up" ? "arrow.up.right" : "equal"
  return <HStack spacing={3} padding={{ horizontal: 7, vertical: 2 }} widgetBackground={{ style: tone.bg, shape: "capsule" }}>
    <Image systemName={icon} font={10} fontWeight="bold" foregroundStyle={tone.fg} />
    <Text font="caption" fontWeight="semibold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.fg} lineLimit={1}>{t.text}</Text>
  </HStack>
}

/** 右上角的剩余油量胶囊：油量低为橙，车况超过 1 天为灰 */
function FuelChip({ st }: { st: WidgetStatus }) {
  const tone = TONE[fuelTone(st)]
  return <HStack spacing={3} padding={{ horizontal: 7, vertical: 3 }} widgetBackground={{ style: tone.bg, shape: "capsule" }}>
    <Image systemName="fuelpump.fill" font={10} foregroundStyle={tone.fg} />
    <Text font="caption" fontWeight="semibold" fontDesign="rounded" monospacedDigit foregroundStyle={tone.fg}>{`${litres(st)} L`}</Text>
  </HStack>
}

function AddFuelButton() {
  return <Link url={addFuelURL()}>
    <HStack spacing={5} frame={{ maxWidth: "infinity" }} padding={{ vertical: 8 }} widgetBackground={{ style: C.button, shape: "capsule" }}>
      <Image systemName="plus" font="footnote" fontWeight="bold" foregroundStyle={C.buttonText} />
      <Text font="subheadline" fontWeight="semibold" foregroundStyle={C.buttonText}>记加油</Text>
    </HStack>
  </Link>
}

/** 小号：车名和油量胶囊、最近油耗、与平均的对比；下面整行「记加油」 */
function Small({ s }: { s: WidgetSnapshot }) {
  return <VStack spacing={9} padding>
    <Link url={openURL()}>
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
        <HStack spacing={4}>
          <Text font="footnote" fontWeight="semibold" foregroundStyle={C.accent} lineLimit={1}>{s.vehicle || "油记"}</Text>
          <Spacer />
          {s.status_source && s.status ? <FuelChip st={s.status} /> : null}
        </HStack>
        <Spacer />
        <Consumption s={s} size={36} />
        <TrendChip s={s} />
      </VStack>
    </Link>
    <AddFuelButton />
  </VStack>
}

/** 中号：左边最近油耗、对比、平均；右边本月花费、剩余油量和「记加油」 */
function Medium({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const tone = st ? TONE[fuelTone(st)] : TONE.normal
  return <HStack spacing={14} padding>
    <Link url={openURL()}>
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}>
        <Text font="footnote" fontWeight="semibold" foregroundStyle={C.accent} lineLimit={1}>{s.vehicle || "油记"}</Text>
        <Spacer />
        <Consumption s={s} size={38} />
        <TrendChip s={s} />
        <Text font="caption2" foregroundStyle={C.sub} monospacedDigit lineLimit={1}>
          {s.avg_consumption != null ? `平均 ${num(s.avg_consumption)} · ${lastFuelText(s)}` : lastFuelText(s)}
        </Text>
      </VStack>
    </Link>
    <Divider />
    <VStack alignment="leading" spacing={10} frame={{ width: 128, maxHeight: "infinity" }}>
      <Link url={openURL()}>
        <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
          <Text font="caption2" foregroundStyle={C.sub}>本月花费</Text>
          <Text font="title3" fontWeight="bold" fontDesign="rounded" monospacedDigit foregroundStyle={C.cost}>{`¥${monthCostNow(s).toFixed(0)}`}</Text>
          {s.pending ? <Text font="caption2" foregroundStyle={C.bad}>{`${s.pending} 条待上传`}</Text> : null}
          <Spacer />
          {st
            ? <VStack alignment="leading" spacing={5}>
              <HStack spacing={4}>
                <Image systemName="fuelpump.fill" font={10} foregroundStyle={tone.fg} />
                <Text font="caption" fontWeight="semibold" fontDesign="rounded" monospacedDigit lineLimit={1}>{st.tank_l ? `${litres(st)} / ${st.tank_l} L` : `${litres(st)} L`}</Text>
                {st.range_km != null ? <Text font="caption2" foregroundStyle={C.sub} monospacedDigit lineLimit={1}>{`· ${st.range_km} km`}</Text> : null}
              </HStack>
              {ratio != null ? <ProgressView value={ratio} tint={tone.bar} /> : null}
            </VStack>
            : null}
        </VStack>
      </Link>
      <AddFuelButton />
    </VStack>
  </HStack>
}

/** 锁屏圆形：中间是最近油耗，圆环是剩余油量；没有车况或不知道油箱容量时只有油耗 */
function Circular({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const center = <VStack spacing={0}>
    <Text font="headline" fontDesign="rounded" monospacedDigit minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(s.latest_consumption, 1)}</Text>
    <Text font={8} foregroundStyle="secondaryLabel">L/100km</Text>
  </VStack>
  if (ratio == null) {
    return <ZStack widgetURL={addFuelURL()}>
      <AccessoryWidgetBackground />
      {center}
    </ZStack>
  }
  return <ZStack widgetURL={addFuelURL()}>
    <Gauge value={ratio} min={0} max={1} label={<Text>油量</Text>} currentValueLabel={center} gaugeStyle="accessoryCircularCapacity" />
  </ZStack>
}

/** 锁屏横条：车名、最近油耗；有车况时下面是油量条，否则是上次加油 */
function Rectangular({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  return <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", alignment: "leading" }} widgetURL={addFuelURL()}>
    <HStack spacing={4}>
      <Image systemName="fuelpump.fill" font="caption" />
      <Text font="caption" fontWeight="semibold" lineLimit={1}>{s.vehicle || "油记"}</Text>
    </HStack>
    <HStack alignment="lastTextBaseline" spacing={3}>
      <Text font="title3" fontWeight="bold" fontDesign="rounded" monospacedDigit widgetAccentable lineLimit={1}>{num(s.latest_consumption)}</Text>
      <Text font="caption">L/100km</Text>
    </HStack>
    {st
      ? <HStack spacing={6}>
        {ratio != null ? <ProgressView value={ratio} /> : null}
        <Text font="caption" fontDesign="rounded" monospacedDigit>{`${litres(st)} L`}</Text>
      </HStack>
      : <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{lastFuelText(s)}</Text>}
  </VStack>
}

function Inline({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const tail = st ? ` · 余 ${litres(st)} L` : s.last_fuel_ts ? ` · ${daysAgoText(s.last_fuel_ts)}` : ""
  return <HStack widgetURL={addFuelURL()}>
    <Image systemName="fuelpump.fill" />
    <Text>{`${num(s.latest_consumption, 1)} L/100km${tail}`}</Text>
  </HStack>
}

function WidgetView({ s }: { s: WidgetSnapshot }) {
  switch (Widget.family) {
    case "systemMedium": return <Medium s={s} />
    case "accessoryRectangular": return <Rectangular s={s} />
    case "accessoryCircular": return <Circular s={s} />
    case "accessoryInline": return <Inline s={s} />
    default: return <Small s={s} />
  }
}

/**
 * 诊断（设计文档 18.3 节）：编辑小组件、把参数填成「诊断」时，显示小组件里能不能读钥匙串、能不能联网，
 * 以及小组件上次自己读车况的结果。平时不影响小组件
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
  const hm = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` }
  const log = lastWidgetRefresh()
  const results = { cache: "用了油记读过的车况", read: "读到了", locked: "另一个小组件正在读", no_credential: "没有凭据", failed: "失败" }
  lines.push(log ? `小组件上次自己读车况：${hm(log.at)} ${results[log.result] || log.result}${log.error ? `（${log.error}）` : ""}` : "小组件还没有自己读过车况")
  const s = readWidgetSnapshot()
  lines.push(s.status ? `车况：${s.status.fuel_l ?? "—"} L，${hm(s.status.read_at)} 读取` : "车况：没有")
  lines.push(`时间：${hm(Date.now())}`)
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
  const family = Widget.family
  const cached = readWidgetSnapshot()
  refreshWidgetStatus(cached, family)
    .catch(() => cached)
    .then(s => Widget.present(<WidgetView s={s} />, { policy: "after", date: widgetRefreshDate(s, family) }))
}
