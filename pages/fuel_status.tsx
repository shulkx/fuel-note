// 车况（设计文档 18.2 节）：标签栏上方的底部配件，和点开后的详情。
// 剩余油量是车现在的状态，不是一条记录，所以不放进记录列表；底部配件与「音乐」的迷你播放器相同，常驻在标签栏上方，
// 下滑时标签栏收起，配件缩到旁边一行（tabBarMinimizeBehavior，Apple HIG · Tab bars）。界面见画布「记录页：剩余油量放在哪里」。
import {
  Button, EnvironmentValuesReader, Gauge, HStack, Image, List, Navigation, NavigationStack, ProgressView, Rectangle, Section, Spacer, Text, useState, VStack,
  ZStack,
} from "scripting"
import { fmtDateTime, fuelLow, fuelRatio, StatusSnapshot, statusStale, statusWhen } from "../common/model"

/** 车况的显示状态：snapshot 为 null 表示还没读到过 */
export type StatusView = { snapshot: StatusSnapshot | null; tank: number | null; busy: boolean; error: string | null; source: string }

const GREEN = { light: "#10B981", dark: "#34D399" } as const
const ORANGE = { light: "#F97316", dark: "#FB923C" } as const

function look(v: StatusView) {
  const st = v.snapshot ? v.snapshot.status : null
  const low = !!st && fuelLow(st.fuel_l, v.tank, st.range_km)
  return {
    st,
    fuel: st && st.fuel_l != null ? String(Math.round(st.fuel_l)) : null,
    ratio: st ? fuelRatio(st.fuel_l, v.tank) : null,
    low,
    stale: !!st && statusStale(st.ts),
    tint: low ? ORANGE : GREEN,
  }
}

/** accessoryCircularCapacity 样式的默认直径（pt）：这个样式尺寸固定，按它缩放到需要的大小 */
const GAUGE_SIZE = 58

/**
 * 油量圆环：系统的容量式仪表（Gauge，accessoryCircularCapacity）。Apple HIG · Gauges：accessory 样式也可以用在 App 里；
 * 仪表中间留空，图标、数字叠在上面，不跟着缩放。不知道油箱容量时圆环为空
 */
function FuelRing({ ratio, size, tint, children }: {
  ratio: number | null
  size: number
  tint: typeof GREEN | typeof ORANGE
  children: JSX.Element
}) {
  return <ZStack frame={{ width: size, height: size }}>
    <Gauge
      value={ratio ?? 0}
      min={0}
      max={1}
      label={<Text>剩余油量</Text>}
      currentValueLabel={<Text>{""}</Text>}
      gaugeStyle="accessoryCircularCapacity"
      tint={tint}
      scaleEffect={size / GAUGE_SIZE}
    />
    {children}
  </ZStack>
}

/** 「油箱 50 / 55 L · 约 430 km」；不知道油箱容量时「剩余 50 L · 约 430 km」 */
function amountText(v: StatusView): { strong: string; rest: string } {
  const { st, fuel } = look(v)
  if (!st || fuel == null) return { strong: "油量未知", rest: "" }
  const range = st.range_km != null ? ` · 约 ${st.range_km} km` : ""
  return v.tank ? { strong: `油箱 ${fuel}`, rest: ` / ${v.tank} L${range}` } : { strong: `剩余 ${fuel} L`, rest: range }
}

/** 底部配件。展开时：圆环、油量和续航、上报时间、刷新；下滑后缩到标签栏旁边：圆环和一行油量 */
export function FuelAccessory({ view, onOpen, onRefresh }: { view: StatusView; onOpen: () => void; onRefresh: () => void }) {
  const l = look(view)
  const ring = (size: number) => <FuelRing ratio={l.ratio} size={size} tint={l.tint}>
    <Image systemName="fuelpump.fill" font={size * 0.36} foregroundStyle={l.st ? l.tint : "secondaryLabel"} />
  </FuelRing>
  // 还没读到过车况：轻点就读取
  const open = l.st ? onOpen : onRefresh
  return <EnvironmentValuesReader keys={["tabViewBottomAccessoryPlacement"]}>{env => {
    const a = amountText(view)
    if (env.tabViewBottomAccessoryPlacement === "inline") {
      return <Button action={open} buttonStyle="plain">
        <HStack spacing={8} padding={{ horizontal: 12 }}>
          {ring(24)}
          {l.st
            ? <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{`${l.fuel ?? "—"} L${l.st.range_km != null ? ` · 约 ${l.st.range_km} km` : ""}`}</Text>
            : <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>{view.busy ? "正在读取车况…" : "读取车况"}</Text>}
          <Spacer />
        </HStack>
      </Button>
    }
    const sub = view.error
      ? { text: `读取失败：${view.error}`, color: "systemRed" as const }
      : l.st && l.st.ts
        ? { text: `${statusWhen(l.st.ts)} 上报`, color: l.stale ? "systemOrange" as const : "secondaryLabel" as const }
        : null
    return <HStack spacing={10} padding={{ leading: 10, trailing: 6 }}>
      <Button action={open} buttonStyle="plain">
        <HStack spacing={11}>
          {ring(34)}
          <VStack alignment="leading" spacing={1}>
            {l.st
              ? <HStack spacing={0}>
                <Text font="subheadline" fontWeight="semibold" lineLimit={1} {...(l.low ? { foregroundStyle: ORANGE } : {})}>{a.strong}</Text>
                <Text font="subheadline" foregroundStyle="secondaryLabel" lineLimit={1}>{a.rest}</Text>
              </HStack>
              : <Text font="subheadline" foregroundStyle="secondaryLabel">{view.busy ? "正在读取车况…" : "还没有车况，轻点读取"}</Text>}
            {sub ? <Text font="caption" foregroundStyle={sub.color} lineLimit={1}>{sub.text}</Text> : null}
          </VStack>
          <Spacer />
        </HStack>
      </Button>
      <Button action={onRefresh} buttonStyle="plain" disabled={view.busy}>
        {view.busy
          ? <ProgressView frame={{ width: 36, height: 36 }} />
          : <Image systemName="arrow.clockwise" font="body" fontWeight="medium" frame={{ width: 36, height: 36 }} />}
      </Button>
    </HStack>
  }}</EnvironmentValuesReader>
}

/** 车况详情：大圆环、续航、车机平均油耗、里程表、车况时间；右上角重新读取 */
export function StatusSheet({ get, refresh }: { get: () => StatusView; refresh: () => Promise<string | null> }) {
  const dismiss = Navigation.useDismiss()
  const [view, setView] = useState(get)
  const l = look(view)
  async function reload() {
    setView({ ...view, busy: true, error: null })
    const error = await refresh()
    setView({ ...get(), busy: false, error })
  }
  const fmt = (n: number | null | undefined, unit: string, d = 1) => (n == null ? "—" : `${n.toFixed(d)} ${unit}`)
  return <NavigationStack presentationDetents={["medium", "large"]} presentationDragIndicator="visible">
    <List
      navigationTitle="车况"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="关闭" systemImage="xmark" action={() => dismiss()} />,
        primaryAction: view.busy ? <ProgressView /> : <Button title="重新读取" systemImage="arrow.clockwise" action={reload} />,
      }}
    >
      <Section>
        {/* 大圆环不要卡片背景（与统计页的范围选择相同的做法） */}
        <VStack spacing={8} frame={{ maxWidth: "infinity" }} listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
          <FuelRing ratio={l.ratio} size={150} tint={l.tint}>
            <VStack spacing={0}>
              <Text font={44} fontWeight="bold" fontDesign="rounded" {...(l.low ? { foregroundStyle: ORANGE } : {})}>{l.fuel ?? "—"}</Text>
              <Text font="footnote" foregroundStyle="secondaryLabel">{view.tank ? `/ ${view.tank} L` : "L"}</Text>
            </VStack>
          </FuelRing>
          {l.st && l.st.range_km != null ? <Text font="subheadline" foregroundStyle="secondaryLabel">{`约可行驶 ${l.st.range_km} km`}</Text> : null}
        </VStack>
      </Section>
      <Section
        footer={<Text>{`车况在停车熄火时上报，来自${view.source}。`}</Text>}
      >
        <HStack><Text>车机平均油耗</Text><Spacer /><Text foregroundStyle="secondaryLabel">{fmt(l.st?.avg_consumption, "L/100km")}</Text></HStack>
        <HStack><Text>里程表</Text><Spacer /><Text foregroundStyle="secondaryLabel">{l.st && l.st.odometer_km != null ? `${Math.floor(l.st.odometer_km).toLocaleString("en-US")} km` : "—"}</Text></HStack>
        <HStack>
          <Text>车况时间</Text>
          <Spacer />
          <Text foregroundStyle={l.stale ? "systemOrange" : "secondaryLabel"}>{l.st && l.st.ts ? fmtDateTime(l.st.ts) : "—"}</Text>
        </HStack>
        {view.snapshot ? <HStack><Text>读取时间</Text><Spacer /><Text foregroundStyle="secondaryLabel">{statusWhen(view.snapshot.read_at)}</Text></HStack> : null}
        {view.error ? <Text font="footnote" foregroundStyle="systemRed">{`读取失败：${view.error}`}</Text> : null}
      </Section>
    </List>
  </NavigationStack>
}
