// 记录：按月分组，左滑删除，下拉同步
import { Button, ContentUnavailableView, HStack, List, Menu, NavigationStack, Section, Spacer, Text, useMemo, useState } from "scripting"
import {
  AppData, consumptionById, currentVehicle, FuelRecord, LedgerRecord, monthKey, monthTitle, summarize, Vehicle, vehicleRecords,
} from "../common/model"
import { money, RecordRow } from "./components"

const PAGE = 120

export type RecordsActions = {
  addFuel: () => void
  addExpense: () => void
  edit: (r: LedgerRecord) => void
  remove: (r: LedgerRecord) => void
  switchVehicle: (v: Vehicle) => void
  addVehicle: () => void
  sync: () => Promise<void>
}

export function RecordsPage({ data, subtitle, actions }: { data: AppData; subtitle: string | null; actions: RecordsActions }) {
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

  const vehicles = data.ledger.vehicles

  return <NavigationStack>
    <List
      navigationTitle={vehicle ? vehicle.name : "油记"}
      navigationSubtitle={subtitle || undefined}
      refreshable={actions.sync}
      toolbar={{
        topBarLeading: vehicles.length > 1
          ? <Menu title="车辆" systemImage="car.2">{vehicles.map(v => <Button title={v.name} systemImage={v.id === vehicle?.id ? "checkmark" : undefined} action={() => actions.switchVehicle(v)} />)}</Menu>
          : undefined,
        topBarTrailing: vehicle
          ? <Menu title="新增" systemImage="plus">
              <Button title="记费用" systemImage="yensign.circle" action={actions.addExpense} />
              <Button title="记加油" systemImage="fuelpump" action={actions.addFuel} />
            </Menu>
          : undefined,
      }}
    >
      {!vehicle ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="在「设置」中添加车辆，或连接小熊油耗导入已有数据。" /> : null}
      {vehicle && !records.length ? <ContentUnavailableView title="还没有记录" systemImage="fuelpump" description="点标签栏右侧的加油按钮记一笔加油。" /> : null}
      {months.map(m => <Section header={<HStack><Text>{monthTitle(m.key)}</Text><Spacer /><Text monospacedDigit>{money(m.total)}</Text></HStack>}>
        {m.items.map(r => <Button
          key={r.id}
          action={() => actions.edit(r)}
          trailingSwipeActions={r.kind === "maintenance" ? undefined : {
            allowsFullSwipe: false,
            actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => actions.remove(r)} />],
          }}
        >
          <RecordRow data={data} record={r} consumption={r.kind === "fuel" ? consumption.get(r.id) ?? null : null} average={average} />
        </Button>)}
      </Section>)}
      {records.length > limit ? <Section><Button title={`显示更早的记录（还有 ${records.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
    </List>
  </NavigationStack>
}
