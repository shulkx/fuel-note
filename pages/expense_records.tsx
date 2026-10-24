// 费用 › 记录（设计文档 22.5 节，画布「第七轮 · 1.6」，1.6.0-beta.4）：车险以外的每一笔费用，按年分组，组头是年份和合计。
// 车险（关联了保险年度的、只有金额的）在保险页（pages/insurance_tab.tsx）；年检、牌照这类没有保单的照常在这里。
// 费用和小熊的保养合成一笔一行（common/expense_stats.ts 的 expenseEntries），保养只算一次；保养只能查看，不能左滑删除。下拉同步。
// 只读费用和保养：加油在「油耗」标签（pages/fuel_records.tsx）。
import { Button, ContentUnavailableView, DynamicShapeStyle, HStack, Image, List, Section, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, categoryName, currentVehicle, expenseEntries, ExpenseEntry, expenseYears, fmtDay, insuranceYears, vehicleRecords, withoutCarInsurance,
  yuan,
} from "../common/model"
import { km, PendingTag, swipeToDelete, TabNav } from "./components"
import { categoryPalette, Palette } from "./expense_parts"

const PAGE = 120

export type ExpenseRecordsActions = {
  /** 打开一笔：保养显示说明，其他费用打开记费用 */
  open: (e: ExpenseEntry) => void
  remove: (e: ExpenseEntry) => void
  sync: () => Promise<void>
}

/** 类别的图标（小熊的四个类别；自己建的类别用通用的图标），颜色与费用统计的横条相同 */
const CATEGORY_ICONS: Record<number, string> = {
  100000: "road.lanes",
  100001: "wrench.and.screwdriver.fill",
  100002: "doc.text.fill",
  100003: "ellipsis.circle.fill",
}

/** 一笔的一行：左边类别的图标和颜色，标题（最多两行）和说明，右边金额 */
function EntryRow({ icon, color, title, detail, amount, pending }: { icon: string; color: DynamicShapeStyle; title: string; detail: string; amount: string; pending: boolean }) {
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName={icon} foregroundStyle={color} frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={6}>
        <Text font="body" lineLimit={2}>{title}</Text>
        {pending ? <PendingTag /> : null}
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer />
    <Text font="body" monospacedDigit>{amount}</Text>
  </HStack>
}

/**
 * 一笔费用的一行（设计文档 22.5 节）：
 * - 保养（小熊的保养记录，和同一时刻的费用合成一行）：标题是保养的说明（「第五次保养」），没有说明时用项目；第二行 类别 · 日期 · 里程；
 * - 其他费用：标题是备注的第一行，没有备注时是类别名；第二行 类别 · 日期 · 备注的最后一行（多半是门店）
 */
function ExpenseRow({ data, entry, palette }: { data: AppData; entry: ExpenseEntry; palette: Palette }) {
  const pending = !!(entry.expense?.pending || entry.maintenance?.pending)
  const icon = CATEGORY_ICONS[entry.category_id] ?? "yensign.circle.fill"
  const color = palette.color(entry.category_id)
  const category = categoryName(data, entry.category_id)
  const m = entry.maintenance
  if (m) {
    const title = m.remark.split("\n")[0].trim() || m.items.replace(/[,，、\s]+$/, "") || category
    return <EntryRow icon={icon} color={color} title={title}
      detail={[category, fmtDay(m.ts), m.odometer > 0 ? km(m.odometer) : ""].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} pending={pending} />
  }
  const lines = (entry.expense?.remark ?? "").split("\n").map(l => l.trim()).filter(Boolean)
  return <EntryRow icon={icon} color={color} title={lines[0] || category}
    detail={[category, fmtDay(entry.ts), lines.length > 1 ? lines[lines.length - 1] : ""].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} pending={pending} />
}

export function ExpenseRecords({ data, nav, subtitle, actions }: { data: AppData; nav: TabNav; subtitle: string | null; actions: ExpenseRecordsActions }) {
  const vehicle = currentVehicle(data)
  const [limit, setLimit] = useState(PAGE)
  const entries = useMemo(() => {
    if (!vehicle) return []
    return withoutCarInsurance(expenseEntries(vehicleRecords(data, vehicle)), insuranceYears(data.ledger.insurance, vehicle.id))
  }, [data, vehicle?.id])
  const totals = useMemo(() => new Map(expenseYears(entries).map(y => [y.year, y.total])), [entries])
  const palette = useMemo(() => categoryPalette(entries), [entries])
  const years = useMemo(() => {
    const out: Array<{ year: number; items: ExpenseEntry[] }> = []
    for (const e of entries.slice(0, limit)) {
      const year = new Date(e.ts).getFullYear()
      let g = out[out.length - 1]
      if (!g || g.year !== year) { g = { year, items: [] }; out.push(g) }
      g.items.push(e)
    }
    return out
  }, [entries, limit])

  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !entries.length
      ? <ContentUnavailableView title="还没有费用" systemImage="yensign.circle" description="点右上角的「+」记费用；车险在「保险」页。" />
      : null

  return <List
    navigationTitle={nav.title}
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    refreshable={actions.sync}
    toolbar={nav.toolbar}
    {...(empty ? { overlay: empty } : {})}
  >
    {years.map(g => <Section key={String(g.year)} header={<HStack><Text>{`${g.year}年`}</Text><Spacer /><Text monospacedDigit>{yuan(totals.get(g.year) ?? 0)}</Text></HStack>}>
      {g.items.map(e => <Button
        key={e.id}
        action={() => actions.open(e)}
        {...(e.maintenance ? {} : { trailingSwipeActions: swipeToDelete(() => actions.remove(e)) })}
      >
        <ExpenseRow data={data} entry={e} palette={palette} />
      </Button>)}
    </Section>)}
    {entries.length > limit ? <Section><Button title={`显示更早的记录（还有 ${entries.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
  </List>
}
