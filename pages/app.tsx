// 根页面：记录、统计、设置三个标签；负责打开表单、保存、同步
import { AppEvents, Navigation, Tab, TabView, Widget, useEffect, useRef, useState } from "scripting"
import {
  afterChange, AppData, autoSync, categoryName, currentVehicle, deleteRecord, ExpenseData, fmtDateTime, LedgerRecord, loadData, saveExpense,
  saveFuel, SyncResult, syncXxyh, toExpenseData, toFuelData, updateSettings, Vehicle,
} from "../common/model"
import { AppActions, money, showError } from "./components"
import { ExpenseForm } from "./expense_form"
import { FuelForm, FuelFormResult } from "./fuel_form"
import { RecordsPage } from "./records"
import { SettingsPage } from "./settings"
import { StatsPage } from "./stats"

export function App({ action }: { action: string | null }) {
  const [initial] = useState(() => loadData())
  const [data, setDataState] = useState<AppData>(initial.data)
  const ref = useRef<AppData>(initial.data)
  const [status, setStatus] = useState<string | null>(null)
  const [tab, setTab] = useState(0)

  const setData = (d: AppData) => {
    ref.current = d
    setDataState(d)
    Widget.reloadAll()
  }
  const getData = () => ref.current

  async function applySync(p: Promise<SyncResult | null>) {
    const r = await p
    if (!r) return
    setData(r.data)
    if (r.error) setStatus(`同步失败：${r.error}`)
    else if (r.message) setStatus(r.message)
  }

  const app: AppActions = { getData, setData, sync: upload => applySync(syncXxyh(getData(), { upload })) }

  async function openFuel(vehicle: Vehicle, record: LedgerRecord | null) {
    const res = await Navigation.present<FuelFormResult | null>({
      element: <FuelForm data={getData()} vehicle={vehicle} record={record && record.kind === "fuel" ? { ...toFuelData(record), id: record.id } : null} />,
    })
    if (!res) return
    try {
      const r = saveFuel(getData(), vehicle, record ? record.id : null, res.fuel, res.newStation)
      setData(r.data)
      setStatus(r.linked ? "已保存，正在上传到小熊油耗…" : "已保存")
      await applySync(afterChange(r.data, r.linked))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  async function openExpense(vehicle: Vehicle, record: LedgerRecord | null) {
    const res = await Navigation.present<ExpenseData | null>({
      element: <ExpenseForm data={getData()} record={record && record.kind === "expense" ? { ...toExpenseData(record), id: record.id } : null} />,
    })
    if (!res) return
    try {
      const r = saveExpense(getData(), vehicle, record ? record.id : null, res)
      setData(r.data)
      setStatus(r.linked ? "已保存，正在上传到小熊油耗…" : "已保存")
      await applySync(afterChange(r.data, r.linked))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  async function edit(record: LedgerRecord) {
    const v = currentVehicle(getData())
    if (!v) return
    if (record.kind === "fuel") return openFuel(v, record)
    if (record.kind === "expense") return openExpense(v, record)
    await Dialog.alert({
      title: "保养记录",
      message: [fmtDateTime(record.ts), `里程 ${record.odometer} 公里`, `花费 ${money(record.amount)}`, record.items && `项目：${record.items}`, record.remark, "保养记录请在小熊油耗 App 中修改。"].filter(Boolean).join("\n"),
    })
  }

  async function remove(record: LedgerRecord) {
    const v = currentVehicle(getData())
    if (!v) return
    const what = record.kind === "fuel" ? `${fmtDateTime(record.ts)} 的加油（${money(record.paid)}）` : `${fmtDateTime(record.ts)} 的${record.kind === "expense" ? categoryName(getData(), record.category_id) : "保养"}（${money(record.amount)}）`
    const ok = await Dialog.confirm({ title: "删除记录", message: `删除 ${what}？${record.origin === "xxyh" ? "\n删除会同步到小熊油耗。" : ""}`, confirmLabel: "删除" })
    if (!ok) return
    try {
      const r = deleteRecord(getData(), v, record)
      setData(r.data)
      await applySync(afterChange(r.data, r.linked))
    } catch (e) {
      await showError("删除失败", e)
    }
  }

  async function addVehicleFirst() {
    setTab(2)
  }

  useEffect(() => {
    if (initial.warnings.length) Dialog.alert({ title: "数据文件", message: initial.warnings.join("\n") })
    applySync(autoSync(getData()))
    const v = currentVehicle(getData())
    if (action === "add_fuel" && v) openFuel(v, null)
    const onPhase = (phase: string) => { if (phase === "active") applySync(autoSync(getData())) }
    AppEvents.scenePhase.addListener(onPhase)
    return () => AppEvents.scenePhase.removeListener(onPhase)
  }, [])

  return <TabView tabIndex={tab} onTabIndexChanged={setTab}>
    <Tab title="记录" systemImage="list.bullet.rectangle">
      <RecordsPage data={data} status={status} actions={{
        addFuel: () => { const v = currentVehicle(getData()); if (v) openFuel(v, null) },
        addExpense: () => { const v = currentVehicle(getData()); if (v) openExpense(v, null) },
        edit,
        remove,
        switchVehicle: v => setData(updateSettings(getData(), { current_vehicle_id: v.id })),
        addVehicle: addVehicleFirst,
        sync: () => app.sync(true),
      }} />
    </Tab>
    <Tab title="统计" systemImage="chart.bar.xaxis">
      <StatsPage data={data} />
    </Tab>
    <Tab title="设置" systemImage="gearshape">
      <SettingsPage data={data} app={app} />
    </Tab>
  </TabView>
}
