// 费用 › 记录（设计文档 22.5 节，画布「第七轮 · 1.6」，1.6.0-beta.4）：车险以外的每一笔费用，按年分组，组头是年份和合计。
// 车险（关联了保险年度的、只有金额的）在保险页（pages/insurance_tab.tsx）；年检、牌照这类没有保单的照常在这里。
// 费用和保养合成一笔一行（common/expense_stats.ts 的 expenseEntries），保养只算一次；保养只能查看，不能左滑删除（2.1 起可以编辑）。
// 只读费用和保养：加油在「油耗」标签（pages/fuel_records.tsx）。
// 2.1.0-beta.5：关联了支持养修的车辆数据时，最上面一组「沃尔沃养修」（画布 YsExpense）：几次没记、最近一次没记的进店和「记下」、全部养修记录；
// 都记下后这一组不显示。下拉重新读一次养修记录。
// 2.1.0-beta.6：标题不再用备注：换了机油的保养是「第 N 次保养」，养修记下的按做了什么（common/service.ts 的 entryTitle）。
import { Button, ContentUnavailableView, DynamicShapeStyle, HStack, Image, List, NavigationLink, Section, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, categoryName, currentVehicle, entryTitle, expenseEntries, ExpenseEntry, expenseStoreName, expenseYears, fmtDay, insuranceYears, oilChangeNumbers, ServiceView, Vehicle,
  vehicleRecords, visitState, withoutCarInsurance, yuan,
} from "../common/model"
import { km, swipeToDelete, TabNav } from "./components"
import { categoryPalette, Palette } from "./expense_parts"
import { VisitRow } from "./service_parts"
import { ServiceActions, ServiceVisitsPage } from "./service_visits"

/** 费用页最上面的养修一组；车辆不支持养修时 null */
export type ServiceSection = { vehicle: Vehicle; view: ServiceView; actions: ServiceActions }

const PAGE = 120

export type ExpenseRecordsActions = {
  /** 打开一笔：保养显示说明，其他费用打开记费用 */
  open: (e: ExpenseEntry) => void
  remove: (e: ExpenseEntry) => void
}

/** 类别的图标（小熊的四个类别；自己建的类别用通用的图标），颜色与费用统计的横条相同 */
const CATEGORY_ICONS: Record<number, string> = {
  100000: "road.lanes",
  100001: "wrench.and.screwdriver.fill",
  100002: "doc.text.fill",
  100003: "ellipsis.circle.fill",
}

/** 一笔的一行：左边类别的图标和颜色，标题（最多两行）和说明，右边金额 */
function EntryRow({ icon, color, title, detail, amount }: { icon: string; color: DynamicShapeStyle; title: string; detail: string; amount: string }) {
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName={icon} foregroundStyle={color} frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <Text font="body" lineLimit={2}>{title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer />
    <Text font="body" monospacedDigit>{amount}</Text>
  </HStack>
}

/**
 * 一笔费用的一行（设计文档 22.5 节）：标题见 entryTitle（「第九次保养」「补漆 · 前保、后保」，自己记的是备注的第一行）；
 * - 保养（保养记录和它对应的费用合成一行）：第二行 类别 · 日期 · 里程；
 * - 其他费用：第二行 类别 · 日期 · 门店
 */
function ExpenseRow({ data, entry, palette, numbers }: { data: AppData; entry: ExpenseEntry; palette: Palette; numbers: Map<string, number> }) {
  const icon = CATEGORY_ICONS[entry.category_id] ?? "yensign.circle.fill"
  const color = palette.color(entry.category_id)
  const category = categoryName(data, entry.category_id)
  const title = entryTitle(data.ledger, numbers, entry, category)
  const m = entry.maintenance
  if (m) {
    return <EntryRow icon={icon} color={color} title={title}
      detail={[category, fmtDay(m.ts), m.odometer > 0 ? km(m.odometer) : ""].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} />
  }
  const store = entry.expense ? expenseStoreName(data.ledger.stores, entry.expense) : null
  return <EntryRow icon={icon} color={color} title={title}
    detail={[category, fmtDay(entry.ts), store ?? ""].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} />
}

/** 最上面一组：组头写几次没记；第一行是最近一次没记的进店，右边「记下」；第二行推入养修记录 */
function ServiceGroup({ data, service }: { data: AppData; service: ServiceSection }) {
  const { view, vehicle, actions } = service
  const states = view.visits.map(v => ({ v, kind: visitState(data.ledger, vehicle.id, v).kind }))
  const todo = states.filter(x => x.kind === "todo").map(x => x.v)
  const settled = states.filter(x => x.kind !== "unsettled").length
  if (!todo.length) return null
  const brand = view.title.replace(/养修$/, "")
  return <Section key="service" header={<HStack><Text>{view.title}</Text><Spacer /><Text>{`${todo.length} 次没记`}</Text></HStack>}
    footer={<Text>{`${brand} App 里有、油记里还没记的进店。轻点「记下」打开填好的记费用；都记下后这一组不显示。`}</Text>}>
    <VisitRow visit={todo[0]} naming={view.naming} right={<Button title="记下" action={() => actions.record(todo[0])} buttonStyle="bordered" />} />
    <NavigationLink destination={<ServiceVisitsPage data={data} vehicle={vehicle} view={view} actions={actions} />}>
      <HStack>
        <Text>全部养修记录</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{`${settled} 次`}</Text>
      </HStack>
    </NavigationLink>
  </Section>
}

export function ExpenseRecords({ data, nav, subtitle, actions, service = null }: {
  data: AppData; nav: TabNav; subtitle: string | null; actions: ExpenseRecordsActions
  service?: ServiceSection | null
}) {
  const vehicle = currentVehicle(data)
  const [limit, setLimit] = useState(PAGE)
  const entries = useMemo(() => {
    if (!vehicle) return []
    return withoutCarInsurance(expenseEntries(vehicleRecords(data, vehicle)), insuranceYears(data.ledger.insurance, vehicle.id))
  }, [data, vehicle?.id])
  const totals = useMemo(() => new Map(expenseYears(entries).map(y => [y.year, y.total])), [entries])
  const numbers = useMemo(() => (vehicle ? oilChangeNumbers(data.ledger, vehicle.id) : new Map<string, number>()), [data, vehicle?.id])
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
    toolbar={nav.toolbar}
    {...(empty ? { overlay: empty } : {})}
    {...(service ? { refreshable: service.actions.refresh } : {})}
  >
    {service ? <ServiceGroup data={data} service={service} /> : null}
    {years.map(g => <Section key={String(g.year)} header={<HStack><Text>{`${g.year}年`}</Text><Spacer /><Text monospacedDigit>{yuan(totals.get(g.year) ?? 0)}</Text></HStack>}>
      {g.items.map(e => <Button
        key={e.id}
        action={() => actions.open(e)}
        trailingSwipeActions={swipeToDelete(() => actions.remove(e))}
      >
        <ExpenseRow data={data} entry={e} palette={palette} numbers={numbers} />
      </Button>)}
    </Section>)}
    {entries.length > limit ? <Section><Button title={`显示更早的记录（还有 ${entries.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
  </List>
}
