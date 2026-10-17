// 公用的行和格式化
import { HStack, Image, Spacer, Text, VirtualNode, VStack } from "scripting"
import {
  AppData, categoryName, fmtDay, gradeText, LedgerRecord,
} from "../common/model"

/** 页面改数据、同步时用的回调 */
export type AppActions = {
  /** 当前最新的数据（异步操作之后用它，避免用到旧数据） */
  getData: () => AppData
  setData: (d: AppData) => void
  /** 同步小熊；upload 为 true 时同时上传待上传的修改 */
  sync: (upload: boolean) => Promise<void>
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function showError(title: string, e: unknown): Promise<void> {
  await Dialog.alert({ title, message: errorMessage(e) })
}

export const money = (n: number | null | undefined) => (n == null ? "—" : `¥${n.toFixed(2)}`)
export const km = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} km`)
export const cspt = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(2)} L/100km`)

/** 表单里「标题 …… 输入框 单位」的一行 */
export function FieldRow({ title, children, unit }: { title: string; children: VirtualNode; unit?: string }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    {children}
    {unit ? <Text foregroundStyle="secondaryLabel">{unit}</Text> : null}
  </HStack>
}

function PendingTag() {
  return <Text font="caption2" foregroundStyle="systemOrange">待上传</Text>
}

export function RecordRow({ data, record, consumption, average }: { data: AppData; record: LedgerRecord; consumption: number | null; average: number | null }) {
  if (record.kind === "fuel") {
    const high = consumption != null && average != null && consumption > average * 1.1
    return <HStack spacing={12}>
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
    return <HStack spacing={12}>
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
  return <HStack spacing={12}>
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
