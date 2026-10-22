// 公用的行和格式化
import { Button, HStack, Image, NavigationLink, Spacer, Text, ToolBarProps, VirtualNode, VStack } from "scripting"
import { AppData, daysAgoText, fmtShort, fmtTime, Stop } from "../common/model"

/** 页面改数据、同步时用的回调 */
export type AppActions = {
  /** 当前最新的数据（异步操作之后用它，避免用到旧数据） */
  getData: () => AppData
  setData: (d: AppData) => void
  /** 同步小熊；upload 为 true 时同时上传待上传的修改 */
  sync: (upload: boolean) => Promise<void>
  /** 打开「添加车辆」，添加后切换到新车辆 */
  addVehicle: () => Promise<void>
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function showError(title: string, e: unknown): Promise<void> {
  await Dialog.alert({ title, message: errorMessage(e) })
}

export const money = (n: number | null | undefined) => (n == null ? "—" : `¥${n.toFixed(2)}`)
export const km = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} km`)
export const cspt = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)} L/100km`)

/** 字段名，后面可以跟来源标记 */
export function FieldLabel({ title, source }: { title: string; source?: VirtualNode | null }) {
  return <HStack spacing={6}>
    <Text lineLimit={1}>{title}</Text>
    {source || null}
  </HStack>
}

/** 表单里「标题 [来源] …… 输入框 单位」的一行 */
export function FieldRow({ title, children, unit, source }: { title: string; children: VirtualNode; unit?: string; source?: VirtualNode | null }) {
  return <HStack>
    <FieldLabel title={title} source={source} />
    <Spacer />
    {children}
    {unit ? <Text foregroundStyle="secondaryLabel">{unit}</Text> : null}
  </HStack>
}

/**
 * 自动填写的字段名后面标出来源（行程、截图……）；手动改过后不再显示。
 * 只用两个字、固定宽度：时间一行的日期选择器很宽，加图标或允许压缩时会被挤成竖排。
 */
export function SourceTag({ title, onInfo }: { title: string; onInfo?: () => void }) {
  // 推断出来的值（油价、近期、推算）带 ⓘ，点开看依据
  const label = <Text
    font="caption2"
    foregroundStyle={onInfo ? "systemBlue" : "secondaryLabel"}
    lineLimit={1}
    fixedSize
    padding={{ horizontal: 6, vertical: 2 }}
    background={{ style: "tertiarySystemFill", shape: "capsule" }}
  >{onInfo ? `${title} ⓘ` : title}</Text>
  return onInfo ? <Button action={onInfo} buttonStyle="plain">{label}</Button> : label
}

export const TripTag = () => <SourceTag title="行程" />

/** 停车的时间：今天、昨天用「今天 09:21」，更早的用「10-12 14:38」 */
export const stopWhen = (ts: number) => {
  const day = daysAgoText(ts)
  return day === "今天" || day === "昨天" ? `${day} ${fmtTime(ts)}` : fmtShort(ts)
}

/** 中文和数字之间加空格：「发现今天 09:21」「发现 10-12 14:38」 */
export const joinWhen = (prefix: string, when: string) => (/^\d/.test(when) ? `${prefix} ${when}` : `${prefix}${when}`)

/** 停车的地点：油站名，没有时用地址 */
export const stopWhere = (s: Stop) => (s.candidate ? s.candidate.station.name : s.place ? s.place.address || s.place.district || "未知地点" : "没有位置")

/** 有还没上传到小熊的修改 */
export function PendingTag() {
  return <Text font="caption2" foregroundStyle="systemOrange">待上传</Text>
}

/**
 * 标签里的一页：标题和工具栏由标签给，副标题各页自己定。
 * 「记录 | 统计」（设计文档 21.2 节，1.6.0-beta.3 用户在 FuelNote Check 里比较六种放法后选定）：记录页右上角「+」旁边一个统计图标，
 * 点开推入「油耗统计」「费用统计」一页，左上角返回（也可以从左边缘右滑返回），返回后记录页停在原来的位置
 */
export type TabNav = { title: string; toolbar: ToolBarProps }

/** 记录页右上角打开统计页的图标，和「+」放在同一组 */
export function StatsLink({ page }: { page: VirtualNode }) {
  return <NavigationLink destination={page}>
    <Image systemName="chart.bar.xaxis" accessibilityLabel="统计" />
  </NavigationLink>
}

export function StatTile({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <Text font="caption" foregroundStyle="secondaryLabel">{title}</Text>
    <Text font="title3" fontWeight="semibold" monospacedDigit>{value}</Text>
    {detail ? <Text font="caption2" foregroundStyle="tertiaryLabel">{detail}</Text> : null}
  </VStack>
}
