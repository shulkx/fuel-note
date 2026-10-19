// 车况（设计文档 18.2 节）：记录页最上面的「当前」一组（上次加油后正在进行的这一箱），和点开后的详情。
// 「当前」挨着车名、在记录之前，读起来是这辆车现在的状态；浅色底与白色的记录卡片区分。
// 1.2.5–1.3.0 放在标签栏上方的底部配件；1.3.1 测试版试过车辆切换右边的按钮，用户觉得放在顶部不像当前车辆的信息（2026-10-19）。
// 界面见画布「车况放法（第五轮）」B 和「B「当前」卡片的颜色」。
import {
  Button, DynamicShapeStyle, Gauge, HStack, List, Navigation, NavigationStack, ProgressView, Rectangle, Section, ShapeStyle, Spacer, Text, useState, VStack, ZStack,
} from "scripting"
import { currentTank, CurrentTank, fmtDateTime, FuelRecord, fuelLow, fuelRatio, StatusSnapshot, statusWhen } from "../common/model"

/** 车况的显示状态：snapshot 为 null 表示还没读到过 */
export type StatusView = { snapshot: StatusSnapshot | null; tank: number | null; busy: boolean; error: string | null; source: string }

type Tint = DynamicShapeStyle

const GREEN: Tint = { light: "#10B981", dark: "#34D399" }
const ORANGE: Tint = { light: "#F97316", dark: "#FB923C" }
const GREY: Tint = { light: "#A1A1AA", dark: "#71717A" }

/** 「当前」卡片的颜色（与小组件的配色 B 相同）：底色与白色的记录卡片区分；还没有车况时灰色 */
const TONES: Record<CurrentTank["tone"], { ring: Tint; bg: Tint; text: ShapeStyle | Tint }> = {
  normal: { ring: GREEN, bg: { light: "#DCFCE7", dark: "rgba(74,222,128,0.18)" }, text: "label" },
  low: { ring: ORANGE, bg: { light: "#FFEDD5", dark: "rgba(251,146,60,0.2)" }, text: { light: "#C2410C", dark: "#FDBA74" } },
  none: { ring: GREY, bg: { light: "#E5E7EB", dark: "rgba(255,255,255,0.1)" }, text: "label" },
}

function look(v: StatusView) {
  const st = v.snapshot ? v.snapshot.status : null
  const low = !!st && fuelLow(st.fuel_l, v.tank, st.range_km)
  return {
    st,
    fuel: st && st.fuel_l != null ? String(Math.round(st.fuel_l)) : null,
    ratio: st ? fuelRatio(st.fuel_l, v.tank) : null,
    low,
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
  tint: Tint
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

/**
 * 记录页最上面的「当前」：剩余油量、续航，上次加油后已行驶的里程；分组标题右边是车况时间。
 * 轻点打开车况详情（每种状态都一样）；下拉刷新时重新读取
 */
export function CurrentSection({ view, last, onOpen }: { view: StatusView; last: FuelRecord | null; onOpen: () => void }) {
  const c = currentTank(view.snapshot ? view.snapshot.status : null, view.tank, last, view)
  const t = TONES[c.tone]
  return <Section header={<HStack><Text>当前</Text><Spacer />{c.when ? <Text>{c.when}</Text> : null}</HStack>}>
    <Button action={onOpen} listRowBackground={<Rectangle fill={t.bg} />}>
      <HStack spacing={14} foregroundStyle="label">
        <FuelRing ratio={c.ratio} size={46} tint={t.ring}>
          <Text font={12} fontWeight="bold" fontDesign="rounded">{c.center}</Text>
        </FuelRing>
        <VStack alignment="leading" spacing={3}>
          <Text font="headline" foregroundStyle={t.text}>{c.main}</Text>
          {c.detail ? <Text font="caption" foregroundStyle="secondaryLabel">{c.detail}</Text> : null}
        </VStack>
        <Spacer />
      </HStack>
    </Button>
  </Section>
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
          <Text foregroundStyle="secondaryLabel">{l.st && l.st.ts ? fmtDateTime(l.st.ts) : "—"}</Text>
        </HStack>
        {view.snapshot ? <HStack><Text>读取时间</Text><Spacer /><Text foregroundStyle="secondaryLabel">{statusWhen(view.snapshot.read_at)}</Text></HStack> : null}
        {view.error ? <Text font="footnote" foregroundStyle="systemRed">{`读取失败：${view.error}`}</Text> : null}
      </Section>
    </List>
  </NavigationStack>
}
