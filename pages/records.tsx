// 记录：按月分组，左滑删除，下拉同步；左上角车辆菜单，右上角「+」新增；顶部是车况（剩余油量）和未记录的加油停车提示
import { Button, ContentUnavailableView, HStack, Image, List, Menu, NavigationStack, ProgressView, Section, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, consumptionById, currentVehicle, daysAgoText, distanceText, fmtTime, fuelLow, fuelRatio, FuelRecord, LedgerRecord, monthKey, monthTitle,
  StatusSnapshot, statusStale, statusWhen, Stop, summarize, vehicleRecords,
} from "../common/model"
import { km, money, RecordRow } from "./components"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

const PAGE = 120

export type RecordsActions = VehicleMenuActions & {
  addFuel: () => void
  addExpense: () => void
  edit: (r: LedgerRecord) => void
  remove: (r: LedgerRecord) => void
  sync: () => Promise<void>
  recordStop: (s: Stop) => void
  dismissStop: (s: Stop) => void
  refreshStatus: () => void
}

/** 记录页顶部的车况（设计文档 18.2 节）：snapshot 为 null 表示还没读到过 */
export type StatusRowState = { snapshot: StatusSnapshot | null; tank: number | null; busy: boolean; error: string | null }

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

/**
 * 「油箱 52 / 55 L · 约 620 km」、油量条、车况时间。轻点重新读取。
 * 油量低于油箱的 15% 时油量条和图标为橙色；车况超过 1 天时时间为橙色
 */
function StatusRow({ state, onRefresh }: { state: StatusRowState; onRefresh: () => void }) {
  const st = state.snapshot ? state.snapshot.status : null
  const fuel = st && st.fuel_l != null ? Math.round(st.fuel_l) : null
  const ratio = st ? fuelRatio(st.fuel_l, state.tank) : null
  const low = !!st && fuelLow(st.fuel_l, state.tank, st.range_km)
  const stale = !!st && statusStale(st.ts)
  const tint = low ? "systemOrange" : "systemGreen"
  const amount = fuel == null ? "油量未知" : state.tank ? `油箱 ${fuel}` : `剩余 ${fuel} L`
  const rest = [state.tank && fuel != null ? ` / ${state.tank} L` : "", st && st.range_km != null ? ` · 约 ${st.range_km} km` : ""].join("")
  return <Button action={onRefresh} buttonStyle="plain">
    <VStack alignment="leading" spacing={8}>
      <HStack spacing={8}>
        <Image systemName="fuelpump.fill" foregroundStyle={st ? tint : "secondaryLabel"} />
        {st
          ? <HStack spacing={0}>
            <Text fontWeight="semibold" monospacedDigit>{amount}</Text>
            <Text foregroundStyle="secondaryLabel" monospacedDigit lineLimit={1}>{rest}</Text>
          </HStack>
          : <Text foregroundStyle="secondaryLabel">{state.busy ? "正在读取车况…" : "还没有车况，轻点读取"}</Text>}
        <Spacer />
        {state.busy
          ? <ProgressView />
          : st && st.ts ? <Text font="caption" foregroundStyle={stale ? "systemOrange" : "secondaryLabel"} monospacedDigit>{statusWhen(st.ts)}</Text> : null}
      </HStack>
      {ratio != null ? <ProgressView value={ratio} tint={tint} /> : null}
      {state.error ? <Text font="caption" foregroundStyle="systemRed" lineLimit={2}>{`车况读取失败：${state.error}`}</Text> : null}
    </VStack>
  </Button>
}

export function RecordsPage({ data, subtitle, status, stop, actions }: {
  data: AppData
  subtitle: string | null
  status: StatusRowState | null
  stop: Stop | null
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
  const toolbar = {
    topBarLeading: <VehicleMenu data={data} actions={actions} />,
    ...(vehicle ? {
      topBarTrailing: <Menu title="新增" systemImage="plus" primaryAction={actions.addFuel}>
        <Button title="记加油" systemImage="fuelpump" action={actions.addFuel} />
        <Button title="记费用" systemImage="yensign.circle" action={actions.addExpense} />
      </Menu>,
    } : {}),
  }
  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !records.length && !stop && !status
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
      {status ? <Section key="status">
        <StatusRow state={status} onRefresh={actions.refreshStatus} />
      </Section> : null}
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
