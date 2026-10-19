// 记录：按月分组，左滑删除，下拉同步；左上角车辆菜单，右上角「+」新增；顶部提示未记录的加油停车。
// 车况（剩余油量）不在列表里，在标签栏上方的底部配件（pages/fuel_status.tsx）
import {
  Button, ContentUnavailableView, HStack, Image, List, Menu, NavigationStack, Section, Spacer, Text, Toolbar, ToolbarItem, VirtualNode, VStack, useMemo, useState,
} from "scripting"
import {
  AppData, consumptionById, currentVehicle, daysAgoText, distanceText, fmtTime, FuelRecord, LedgerRecord, monthKey, monthTitle, Stop, summarize,
  vehicleRecords,
} from "../common/model"
import { km, money, RecordRow } from "./components"
import { leadingToolbarItems, VehicleMenuActions } from "./vehicle_menu"

const PAGE = 120

export type RecordsActions = VehicleMenuActions & {
  addFuel: () => void
  addExpense: () => void
  edit: (r: LedgerRecord) => void
  remove: (r: LedgerRecord) => void
  sync: () => Promise<void>
  recordStop: (s: Stop) => void
  dismissStop: (s: Stop) => void
}

/** 列表顶部：最近 2 天里还没记录的加油停车。行内有多个按钮，每个都要指定 buttonStyle，否则点整行会同时触发 */
function StopRow({ stop, onRecord, onDismiss }: { stop: Stop; onRecord: () => void; onDismiss: () => void }) {
  const when = `${daysAgoText(stop.end_ts)} ${fmtTime(stop.end_ts)}`
  const where = stop.candidate ? stop.candidate.station.name : stop.place?.address || "加油站"
  return <HStack spacing={10}>
    <Button action={onRecord} buttonStyle="plain">
      <HStack spacing={10}>
        <Image systemName="fuelpump.fill" foregroundStyle="systemGreen" />
        <VStack alignment="leading" spacing={1}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{`${when} 有一次加油停车`}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
            {[where, stop.candidate?.dist != null ? distanceText(stop.candidate.dist) : "", km(Math.floor(stop.odometer_km))].filter(Boolean).join(" · ")}
          </Text>
        </VStack>
      </HStack>
    </Button>
    <Spacer />
    <Button title="记一笔" action={onRecord} buttonStyle="borderedProminent" tint="systemGreen" />
    <Button action={onDismiss} buttonStyle="plain">
      <Image systemName="xmark" font="footnote" foregroundStyle="secondaryLabel" />
    </Button>
  </HStack>
}

export function RecordsPage({ data, subtitle, stop, statusItem, actions }: {
  data: AppData
  subtitle: string | null
  stop: Stop | null
  /** 车况按钮（能读车况时） */
  statusItem: VirtualNode | null
  actions: RecordsActions
}) {
  const vehicle = currentVehicle(data)
  const [limit, setLimit] = useState(PAGE)
  const records = useMemo(() => (vehicle ? vehicleRecords(data, vehicle) : []), [data, vehicle?.id])
  const consumption = useMemo(() => consumptionById(records.filter(r => r.kind === "fuel") as FuelRecord[]), [records])
  const average = useMemo(() => summarize(records, "all").avg_consumption, [records])
  const months = useMemo(() => {
    const out: Array<{ key: string; total: number; items: LedgerRecord[] }> = []
    for (const r of records.slice(0, limit)) {
      const key = monthKey(r.ts)
      let m = out[out.length - 1]
      if (!m || m.key !== key) { m = { key, total: 0, items: [] }; out.push(m) }
      m.items.push(r)
    }
    // 月份合计用该月全部记录（不受分页影响）
    for (const m of out) m.total = records.filter(r => monthKey(r.ts) === m.key).reduce((s, r) => s + (r.kind === "fuel" ? r.paid : r.amount), 0)
    return out
  }, [records, limit])

  // 不需要的属性整个不传：Scripting 对显式的 undefined 也可能留出空位（空按钮、空图标）
  // 「+」：轻点直接记加油，长按展开菜单（与「邮件」的撰写按钮相同：轻点新建，长按看草稿）
  // 左上角车辆菜单（设计文档 17.3 节）：没有车辆时也在，用来添加车辆
  const toolbar = <Toolbar>
    {[
      ...leadingToolbarItems(data, actions, statusItem),
      ...(vehicle ? [<ToolbarItem key="add" placement="topBarTrailing">
        <Menu title="新增" systemImage="plus" primaryAction={actions.addFuel}>
          <Button title="记加油" systemImage="fuelpump" action={actions.addFuel} />
          <Button title="记费用" systemImage="yensign.circle" action={actions.addExpense} />
        </Menu>
      </ToolbarItem>] : []),
    ]}
  </Toolbar>
  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !records.length && !stop
      ? <ContentUnavailableView title="还没有记录" systemImage="fuelpump" description="点右上角的「+」记录加油；长按可记录其他费用。" />
      : null

  return <NavigationStack>
    <List
      navigationTitle={vehicle ? vehicle.name : "油记"}
      {...(subtitle ? { navigationSubtitle: subtitle } : {})}
      refreshable={actions.sync}
      toolbar={toolbar}
      {...(empty ? { overlay: empty } : {})}
    >
      {stop ? <Section key="stop">
        <StopRow stop={stop} onRecord={() => actions.recordStop(stop)} onDismiss={() => actions.dismissStop(stop)} />
      </Section> : null}
      {months.map(m => <Section key={m.key} header={<HStack><Text>{monthTitle(m.key)}</Text><Spacer /><Text monospacedDigit>{money(m.total)}</Text></HStack>}>
        {m.items.map(r => <Button
          key={r.id}
          action={() => actions.edit(r)}
          {...(r.kind === "maintenance" ? {} : {
            trailingSwipeActions: {
              allowsFullSwipe: false,
              actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => actions.remove(r)} />],
            },
          })}
        >
          <RecordRow data={data} record={r} consumption={r.kind === "fuel" ? consumption.get(r.id) ?? null : null} average={average} />
        </Button>)}
      </Section>)}
      {records.length > limit ? <Section><Button title={`显示更早的记录（还有 ${records.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
    </List>
  </NavigationStack>
}
