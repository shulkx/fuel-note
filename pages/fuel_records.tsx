// 油耗 › 记录（设计文档 21.3 节）：最上面是「当前」一组（车况，pages/fuel_status.tsx），其次提示未记录的加油停车；
// 下面是加油记录，按月分组，月合计只算加油。左滑删除，下拉同步（同时重新读车况）。
// 只读加油记录：费用、保险在「费用」标签（pages/expense_records.tsx）。
import { Button, ContentUnavailableView, HStack, Image, List, Section, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, consumptionById, currentVehicle, daysAgoText, distanceText, fmtDay, fmtTime, FuelRecord, fuelRecords, gradeText, LedgerRecord, monthKey, monthTitle,
  Stop, summarize,
} from "../common/model"
import { cspt, km, money, PendingTag, TabNav } from "./components"
import { CurrentSection, StatusView } from "./fuel_status"

const PAGE = 120

export type Fill = FuelRecord & LedgerRecord

export type FuelRecordsActions = {
  edit: (r: Fill) => void
  remove: (r: Fill) => void
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

/** 一次加油：日期、实付；升数 · 标号 · 里程；本次油耗（比平均高 10% 以上用橙色） */
function FuelRow({ record, consumption, average }: { record: Fill; consumption: number | null; average: number | null }) {
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

export function FuelRecords({ data, nav, subtitle, stop, status, openStatus, actions }: {
  data: AppData
  nav: TabNav
  subtitle: string | null
  stop: Stop | null
  /** 车况；当前车辆不能读车况时为 null */
  status: StatusView | null
  openStatus: () => void
  actions: FuelRecordsActions
}) {
  const vehicle = currentVehicle(data)
  const [limit, setLimit] = useState(PAGE)
  const fills = useMemo(() => (vehicle ? fuelRecords(data, vehicle) : []), [data, vehicle?.id])
  const consumption = useMemo(() => consumptionById(fills), [fills])
  const average = useMemo(() => summarize(fills, "all").avg_consumption, [fills])
  const months = useMemo(() => {
    const out: Array<{ key: string; total: number; items: Fill[] }> = []
    for (const r of fills.slice(0, limit)) {
      const key = monthKey(r.ts)
      let m = out[out.length - 1]
      if (!m || m.key !== key) { m = { key, total: 0, items: [] }; out.push(m) }
      m.items.push(r)
    }
    // 月份合计用该月全部加油（不受分页影响）
    for (const m of out) m.total = fills.filter(r => monthKey(r.ts) === m.key).reduce((s, r) => s + r.paid, 0)
    return out
  }, [fills, limit])

  // 不需要的属性整个不传：Scripting 对显式的 undefined 也可能留出空位（空按钮、空图标）
  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !fills.length && !stop && !status
      ? <ContentUnavailableView title="还没有加油记录" systemImage="fuelpump" description="点右上角的「+」记加油。" />
      : null

  return <List
    navigationTitle={nav.title}
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    refreshable={actions.sync}
    toolbar={nav.toolbar}
    {...(empty ? { overlay: empty } : {})}
  >
    {status ? <CurrentSection key="current" view={status} last={fills[0] ?? null} onOpen={openStatus} /> : null}
    {stop ? <Section key="stop">
      <StopRow stop={stop} onRecord={() => actions.recordStop(stop)} onDismiss={() => actions.dismissStop(stop)} />
    </Section> : null}
    {months.map(m => <Section key={m.key} header={<HStack><Text>{monthTitle(m.key)}</Text><Spacer /><Text monospacedDigit>{money(m.total)}</Text></HStack>}>
      {m.items.map(r => <Button
        key={r.id}
        action={() => actions.edit(r)}
        trailingSwipeActions={{
          allowsFullSwipe: false,
          actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => actions.remove(r)} />],
        }}
      >
        <FuelRow record={r} consumption={consumption.get(r.id) ?? null} average={average} />
      </Button>)}
    </Section>)}
    {fills.length > limit ? <Section><Button title={`显示更早的记录（还有 ${fills.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
  </List>
}
