// 公用的行和格式化
import { Button, HStack, Image, Spacer, Text, VirtualNode, VStack } from "scripting"
import {
  AppData, categoryName, daysAgoText, fmtDay, fmtShort, fmtTime, gradeText, LedgerRecord, Stop,
} from "../common/model"

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

function PendingTag() {
  return <Text font="caption2" foregroundStyle="systemOrange">待上传</Text>
}

export function RecordRow({ data, record, consumption, average }: { data: AppData; record: LedgerRecord; consumption: number | null; average: number | null }) {
  if (record.kind === "fuel") {
    const high = consumption != null && average != null && consumption > average * 1.1
    return <HStack spacing={12} foregroundStyle="label">
      <Image systemName="fuelpump.fill" foregroundStyle="systemGreen" frame={{ width: 24 }} />
      <VStack alignment="leading" spacing={3}>
        <HStack spacing={6}>
          <Text font="body">{fmtDay(record.ts)}</Text>
          {record.pending ? <PendingTag /> : null}
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel">
          {`${record.liters.toFixed(2)} L · ${gradeText(record.grade)} · ${km(record.odometer)}${record.full ? "" : " · 未加满"}`}
        </Text>
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={3}>
        <Text font="body" monospacedDigit>{money(record.paid)}</Text>
        <Text font="caption" monospacedDigit foregroundStyle={high ? "systemOrange" : "secondaryLabel"}>{consumption != null ? cspt(consumption) : " "}</Text>
      </VStack>
    </HStack>
  }
  if (record.kind === "expense") {
    return <HStack spacing={12} foregroundStyle="label">
      <Image systemName="yensign.circle.fill" foregroundStyle="systemBlue" frame={{ width: 24 }} />
      <VStack alignment="leading" spacing={3}>
        <HStack spacing={6}>
          <Text font="body">{categoryName(data, record.category_id)}</Text>
          {record.pending ? <PendingTag /> : null}
        </HStack>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{[fmtDay(record.ts), record.remark].filter(Boolean).join(" · ")}</Text>
      </VStack>
      <Spacer />
      <Text font="body" monospacedDigit>{money(record.amount)}</Text>
    </HStack>
  }
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName="wrench.and.screwdriver.fill" foregroundStyle="systemPurple" frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <Text font="body">保养</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{[fmtDay(record.ts), km(record.odometer), record.items].filter(Boolean).join(" · ")}</Text>
    </VStack>
    <Spacer />
    <Text font="body" monospacedDigit>{money(record.amount)}</Text>
  </HStack>
}

export function StatTile({ title, value, detail }: { title: string; value: string; detail?: string }) {
  return <VStack alignment="leading" spacing={4} frame={{ maxWidth: "infinity", alignment: "leading" }}>
    <Text font="caption" foregroundStyle="secondaryLabel">{title}</Text>
    <Text font="title3" fontWeight="semibold" monospacedDigit>{value}</Text>
    {detail ? <Text font="caption2" foregroundStyle="tertiaryLabel">{detail}</Text> : null}
  </VStack>
}
