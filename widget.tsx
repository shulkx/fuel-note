// 桌面与锁屏小组件：显示 App 写的 widget.json（设计文档 18.2 节「小组件改版（1.4）」，画布「小组件第六轮」）。
// - 油耗是主体：大数字为最近油耗，下面一行与平均的对比；剩余油量、续航、油费在旁边的数字格里（1.6 起只算加油）。
// - 不用柱状图（用户要求，2026-10-20）；剩余油量是一条横向油量条，油量低时为橙色。
// - 每个尺寸都有横向的「记加油」按钮：小号在底部，中号、大号在左栏底部（不占数字格）。
//   按钮和信息区都用 Link（有 Link 时 widgetURL 会被忽略；Apple 文档：小号也可以有多个点击区域）。
// - 着色外观下底板和按钮底色隐藏（widgetBackground），只把大数字设为强调色（widgetAccentable）。
// - 油量条的宽度按 Widget.displaySize 算：主屏幕小组件里形状的宽度以 frame 为准（参考本地脚本 SGCC_Mod 的做法）。
// 车况超过 1 小时时，小组件用油记的凭据自己读一次再显示（设计文档 18.3 节第 2 步）；数据要在 Widget.present 之前准备好（Scripting 文档）。
// 显示车况的 1 小时后刷新，其他的每天零点后刷新。只从 common/widget_runtime 导入（打包器的限制，设计文档 9.4 节）。
import { AccessoryWidgetBackground, Capsule, Circle, DynamicShapeStyle, Gauge, HStack, Image, Link, ProgressView, Rectangle, Script, Spacer, Text, VStack, Widget, ZStack } from "scripting"
import {
  consumptionLevel, consumptionTrend, daysAgoText, drivenSinceFill, fillDay, fuelRatio, fuelTone, monthCostNow, moneyText,
  readWidgetSnapshot, refreshWidgetStatus, widgetRefreshDate, WidgetFill, WidgetSnapshot, WidgetStatus, yearCostNow,
} from "./common/widget_runtime"

const num = (n: number | null | undefined, digits = 2) => (n == null ? "—" : n.toFixed(digits))
// run_single：油记已经打开时不再起第二个实例（文档对需要避免并发执行的脚本的建议）
const addFuelURL = () => Script.createRunSingleURLScheme(Script.name, { action: "add_fuel" })
const openURL = () => Script.createRunSingleURLScheme(Script.name)

/** 配色：浅色、深色模式各一套；青绿为主，橙色表示偏高或油量低 */
const C = {
  sub: { light: "#5F6B66", dark: "#9CA3A1" },
  panel: { light: "#E8F3F0", dark: "#16302C" },
  cell: { light: "#F1F6F5", dark: "#13231F" },
  good: { light: "#15803D", dark: "#86EFAC" },
  bad: { light: "#C2410C", dark: "#FDBA74" },
  fuelIcon: { light: "#0B6B62", dark: "#93E3D8" },
  track: { light: "#DCE7E4", dark: "#24302E" },
  divider: { light: "rgba(0,0,0,0.08)", dark: "rgba(255,255,255,0.08)" },
} as const

const BUTTON: DynamicShapeStyle = {
  light: { colors: ["#14937F", "#0B6B62"], startPoint: "top", endPoint: "bottom" },
  dark: { colors: ["#2FA092", "#1B7A70"], startPoint: "top", endPoint: "bottom" },
}
const FILL: Record<"normal" | "low", DynamicShapeStyle> = {
  normal: {
    light: { colors: ["#3FA597", "#0B6B62"], startPoint: "leading", endPoint: "trailing" },
    dark: { colors: ["#93E3D8", "#2A8C82"], startPoint: "leading", endPoint: "trailing" },
  },
  low: {
    light: { colors: ["#F4A35C", "#D2601C"], startPoint: "leading", endPoint: "trailing" },
    dark: { colors: ["#F5A15E", "#C7581A"], startPoint: "leading", endPoint: "trailing" },
  },
}
/** 油耗档位的小圆点：不高于平均青绿，高出 10% 以内黄，再高橙 */
const LEVEL = {
  ok: { light: "#0B6B62", dark: "#2FA092" },
  above: { light: "#E1B60A", dark: "#F5DA4A" },
  high: { light: "#D2601C", dark: "#F5A15E" },
} as const

const PAD = 12
const rounded = (radius: number) => ({ type: "rect" as const, cornerRadius: radius, style: "continuous" as const })

function lastFuelText(s: WidgetSnapshot): string {
  return s.last_fuel_ts ? `${daysAgoText(s.last_fuel_ts)}加油` : "还没有加油记录"
}

const litres = (st: WidgetStatus) => (st.fuel_l == null ? "—" : String(Math.round(st.fuel_l)))
const statusOf = (s: WidgetSnapshot) => (s.status_source ? s.status : null)

/** 大数字和单位，按文字基线对齐 */
function BigNumber({ value, size, unit }: { value: string; size: number; unit?: string }) {
  return <HStack alignment="lastTextBaseline" spacing={3}>
    <Text font={size} fontWeight="semibold" minScaleFactor={0.6} lineLimit={1} widgetAccentable>{value}</Text>
    {unit ? <Text font={12} foregroundStyle={C.sub} lineLimit={1}>{unit}</Text> : null}
  </HStack>
}

/** 与平均的对比：低于平均为绿，高于平均为橙；还没有对比时写上次加油 */
function TrendLine({ s, size }: { s: WidgetSnapshot; size: number }) {
  const t = consumptionTrend(s.latest_consumption, s.avg_consumption)
  if (!t) return <Text font={size} foregroundStyle={C.sub} lineLimit={1}>{lastFuelText(s)}</Text>
  const color = t.dir === "down" ? C.good : t.dir === "up" ? C.bad : C.sub
  const icon = t.dir === "down" ? "arrow.down.right" : t.dir === "up" ? "arrow.up.right" : "equal"
  return <HStack spacing={3}>
    <Image systemName={icon} font={size - 1} fontWeight="bold" foregroundStyle={color} />
    <Text font={size} fontWeight="semibold" foregroundStyle={color} lineLimit={1}>{t.text}</Text>
  </HStack>
}

/** 小号右上角的剩余油量：油量低时图标为橙色 */
function FuelChip({ st }: { st: WidgetStatus }) {
  const low = fuelTone(st) === "low"
  return <HStack spacing={3} padding={{ horizontal: 8, vertical: 3 }} widgetBackground={{ style: C.cell, shape: "capsule" }}>
    <Image systemName="fuelpump.fill" font={10} foregroundStyle={low ? C.bad : C.fuelIcon} />
    <Text font={12} fontWeight="semibold" lineLimit={1}>{`${litres(st)} L`}</Text>
  </HStack>
}

/**
 * 横向的「记加油」按钮，占满整行。
 * frame 只能用一种写法：固定的 width/height，或伸缩的 min/max。混写时 Scripting 只按固定尺寸，maxWidth 被忽略，按钮缩成文字宽（1.4.0-beta.1 在手机上如此）
 */
function AddFuelButton({ height }: { height: number }) {
  return <Link url={addFuelURL()}>
    <HStack spacing={5} frame={{ maxWidth: "infinity", minHeight: height, maxHeight: height }} widgetBackground={{ style: BUTTON, shape: "capsule" }}>
      <Image systemName="plus" font={14} fontWeight="bold" foregroundStyle="white" />
      <Text font={15} fontWeight="semibold" foregroundStyle="white">记加油</Text>
    </HStack>
  </Link>
}

/** 数字格：标签一行，数值和单位一行 */
function Cell({ label, value, unit, compact }: { label: string; value: string; unit?: string; compact: boolean }) {
  return <VStack
    alignment="leading"
    spacing={1}
    padding={{ horizontal: compact ? 10 : 12, vertical: compact ? 5 : 8 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "leading" }}
    widgetBackground={{ style: C.cell, shape: rounded(12) }}
  >
    <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1}>{label}</Text>
    <HStack alignment="lastTextBaseline" spacing={2}>
      <Text font={compact ? 17 : 20} fontWeight="semibold" minScaleFactor={0.7} lineLimit={1}>{value}</Text>
      {unit ? <Text font={11} foregroundStyle={C.sub}>{unit}</Text> : null}
    </HStack>
  </VStack>
}

/** 四格：有车况时为剩余油量、续航；没有车况时为平均油耗、上次加油。下面一行是本月、今年的油费（只算加油，设计文档 21.3 节） */
function CellGrid({ s, compact }: { s: WidgetSnapshot; compact: boolean }) {
  const st = statusOf(s)
  const gap = compact ? 6 : 8
  return <VStack spacing={gap} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
    <HStack spacing={gap}>
      {st
        ? <Cell label="剩余油量" value={litres(st)} unit="L" compact={compact} />
        : <Cell label="平均油耗" value={num(s.avg_consumption)} compact={compact} />}
      {st
        ? <Cell label="续航" value={st.range_km == null ? "—" : String(st.range_km)} unit="km" compact={compact} />
        : <Cell label="上次加油" value={s.last_fuel_ts ? daysAgoText(s.last_fuel_ts) : "—"} compact={compact} />}
    </HStack>
    <HStack spacing={gap}>
      <Cell label="本月油费" value={moneyText(monthCostNow(s), 2)} compact={compact} />
      <Cell label="今年油费" value={moneyText(yearCostNow(s), 0)} compact={compact} />
    </HStack>
  </VStack>
}

/** 横向油量条：两个胶囊叠在一起，宽度按小组件尺寸算 */
function TankBar({ ratio, low, width, height }: { ratio: number; low: boolean; width: number; height: number }) {
  return <ZStack alignment="leading" frame={{ width, height }}>
    <Capsule fill={C.track} frame={{ width, height }} />
    <Capsule fill={low ? FILL.low : FILL.normal} frame={{ width: Math.max(height, width * ratio), height }} />
  </ZStack>
}

/** 「这一箱：剩余 91%」和油量条；不知道油箱容量时只写升数 */
function TankCell({ s, st, barWidth, compact }: { s: WidgetSnapshot; st: WidgetStatus; barWidth: number; compact: boolean }) {
  const ratio = fuelRatio(st.fuel_l, st.tank_l)
  const driven = drivenSinceFill(s)
  const after = s.last_fuel_full ? "加满后" : "加油后"
  const right = driven == null ? "" : compact ? `${after} ${driven} km` : `${after}已行驶 ${driven} km`
  return <VStack
    alignment="leading"
    spacing={compact ? 6 : 8}
    padding={{ horizontal: compact ? 10 : 12, vertical: compact ? 7 : 9 }}
    frame={{ maxWidth: "infinity", alignment: "leading" }}
    widgetBackground={{ style: C.cell, shape: rounded(12) }}
  >
    <HStack>
      <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1}>{ratio == null ? `这一箱：剩余 ${litres(st)} L` : `这一箱：剩余 ${Math.round(ratio * 100)}%`}</Text>
      <Spacer />
      {right ? <Text font={compact ? 11 : 12} foregroundStyle={C.sub} lineLimit={1}>{right}</Text> : null}
    </HStack>
    {ratio == null ? null : <TankBar ratio={ratio} low={fuelTone(st) === "low"} width={barWidth} height={compact ? 6 : 8} />}
  </VStack>
}

/** 中号、大号的左栏：最近油耗和对比（右上角是那次加油的日期），底部「记加油」 */
function LeftPanel({ s, width, size }: { s: WidgetSnapshot; width: number; size: number }) {
  const last = s.recent.length ? fillDay(s.recent[0].ts).slice(0, 5) : ""
  return <VStack
    alignment="leading"
    spacing={8}
    padding={{ top: 11, leading: 12, trailing: 12, bottom: 10 }}
    frame={{ minWidth: width, maxWidth: width, maxHeight: "infinity", alignment: "topLeading" }}
    widgetBackground={{ style: C.panel, shape: rounded(14) }}
  >
    <Link url={openURL()}>
      <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
        <HStack>
          <Text font={13} foregroundStyle={C.sub}>最近油耗</Text>
          <Spacer />
          {last ? <Text font={12} foregroundStyle={C.sub}>{last}</Text> : null}
        </HStack>
        <BigNumber value={num(s.latest_consumption)} size={size} />
        <TrendLine s={s} size={11} />
      </VStack>
    </Link>
    <AddFuelButton height={32} />
  </VStack>
}

/** 小号：最近油耗、对比，右上角剩余油量；底部「记加油」 */
function Small({ s }: { s: WidgetSnapshot }) {
  const st = statusOf(s)
  return <VStack spacing={10} padding={14}>
    <Link url={openURL()}>
      <VStack alignment="leading" spacing={2} frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}>
        <HStack>
          <Text font={13} foregroundStyle={C.sub}>最近油耗</Text>
          <Spacer />
          {st ? <FuelChip st={st} /> : null}
        </HStack>
        <Spacer />
        <BigNumber value={num(s.latest_consumption)} size={34} unit="L/100km" />
        <TrendLine s={s} size={12} />
      </VStack>
    </Link>
    <AddFuelButton height={34} />
  </VStack>
}

/** 中号：左栏最近油耗和「记加油」；右边四格，有车况时最下面是这一箱的油量条 */
function Medium({ s }: { s: WidgetSnapshot }) {
  const st = statusOf(s)
  const inner = Widget.displaySize.width - PAD * 2
  const leftW = Math.round(inner * 0.4)
  const rightW = inner - leftW - 10
  return <HStack spacing={10} padding={PAD}>
    <LeftPanel s={s} width={leftW} size={30} />
    <Link url={openURL()}>
      <VStack spacing={6} frame={{ minWidth: rightW, maxWidth: rightW, maxHeight: "infinity" }}>
        <CellGrid s={s} compact />
        {st ? <TankCell s={s} st={st} barWidth={rightW - 20} compact /> : null}
      </VStack>
    </Link>
  </HStack>
}

/** 大号「最近加油」的一行：日期、升数·油号·油站；金额、油耗和档位圆点 */
function FillRow({ f, avg }: { f: WidgetFill; avg: number | null }) {
  const level = consumptionLevel(f.consumption, avg)
  const detail = [`${f.liters.toFixed(2)} L`, f.grade ? `${f.grade}#` : "", f.station || ""].filter(Boolean).join(" · ")
  return <HStack spacing={10}>
    <VStack alignment="leading" spacing={1}>
      <Text font={14}>{fillDay(f.ts)}</Text>
      <Text font={11} foregroundStyle={C.sub} lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer minLength={6} />
    <VStack alignment="trailing" spacing={1}>
      <Text font={14}>{`¥${f.paid.toFixed(2)}`}</Text>
      <HStack spacing={4}>
        {level ? <Circle fill={LEVEL[level]} frame={{ width: 6, height: 6 }} /> : null}
        <Text font={11} foregroundStyle={C.sub}>{f.consumption == null ? "—" : `${f.consumption.toFixed(2)} L/100km`}</Text>
      </HStack>
    </VStack>
  </HStack>
}

/** 大号「最近加油」：最近 3 次，行间细线 */
function RecentFills({ s, width }: { s: WidgetSnapshot; width: number }) {
  return <VStack
    alignment="leading"
    spacing={5}
    padding={{ top: 9, leading: 14, trailing: 14, bottom: 8 }}
    frame={{ maxWidth: "infinity", maxHeight: "infinity", alignment: "topLeading" }}
    widgetBackground={{ style: C.cell, shape: rounded(14) }}
  >
    <HStack>
      <Text font={12} foregroundStyle={C.sub}>最近加油</Text>
      <Spacer />
      {s.last_fuel_ts ? <Text font={12} foregroundStyle={C.sub}>{daysAgoText(s.last_fuel_ts)}</Text> : null}
    </HStack>
    {s.recent.length
      ? s.recent.map((f, i) => <VStack key={String(f.ts)} spacing={5}>
        {i ? <Rectangle fill={C.divider} frame={{ width: width - 28, height: 0.5 }} /> : null}
        <FillRow f={f} avg={s.avg_consumption} />
      </VStack>)
      : <Text font={13} foregroundStyle={C.sub}>还没有加油记录</Text>}
    <Spacer minLength={0} />
  </VStack>
}

/** 大号：上面同中号（左栏和四格），中间这一箱的油量条，下面最近 3 次加油 */
function Large({ s }: { s: WidgetSnapshot }) {
  const st = statusOf(s)
  const inner = Widget.displaySize.width - PAD * 2
  const leftW = Math.round(inner * 0.43)
  return <VStack spacing={8} padding={PAD}>
    <HStack spacing={10} frame={{ height: 140 }}>
      <LeftPanel s={s} width={leftW} size={32} />
      <Link url={openURL()}>
        <CellGrid s={s} compact={false} />
      </Link>
    </HStack>
    <Link url={openURL()}>
      <VStack spacing={8}>
        {st ? <TankCell s={s} st={st} barWidth={inner - 24} compact={false} /> : null}
        <RecentFills s={s} width={inner} />
      </VStack>
    </Link>
  </VStack>
}

/** 锁屏圆形：中间是最近油耗，圆环是剩余油量；没有车况或不知道油箱容量时只有油耗 */
function Circular({ s }: { s: WidgetSnapshot }) {
  const st = s.status_source ? s.status : null
  const ratio = st ? fuelRatio(st.fuel_l, st.tank_l) : null
  const center = <VStack spacing={0}>
    <Text font="headline" fontDesign="rounded" minScaleFactor={0.6} lineLimit={1} widgetAccentable>{num(s.latest_consumption, 1)}</Text>
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
      <Text font="title3" fontWeight="bold" fontDesign="rounded" widgetAccentable lineLimit={1}>{num(s.latest_consumption)}</Text>
      <Text font="caption">L/100km</Text>
    </HStack>
    {st
      ? <HStack spacing={6}>
        {ratio != null ? <ProgressView value={ratio} /> : null}
        <Text font="caption" fontDesign="rounded">{`${litres(st)} L`}</Text>
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
    case "systemLarge":
    case "systemExtraLarge": return <Large s={s} />
    case "accessoryRectangular": return <Rectangular s={s} />
    case "accessoryCircular": return <Circular s={s} />
    case "accessoryInline": return <Inline s={s} />
    default: return <Small s={s} />
  }
}

const family = Widget.family
const cached = readWidgetSnapshot()
refreshWidgetStatus(cached, family)
  .catch(() => cached)
  .then(s => Widget.present(<WidgetView s={s} />, { policy: "after", date: widgetRefreshDate(s, family) }))
