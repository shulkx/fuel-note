// 根页面：记录、统计、设置三个标签。标签栏只做页面切换，「记加油」等操作放在记录页右上角的「+」。
// 负责打开表单、保存、同步，以及识别未记录的加油停车（显示在记录页顶部）。
import { AppEvents, Navigation, Script, Tab, TabView, Widget, useEffect, useObservable, useRef, useState } from "scripting"
import {
  addVehicle, afterChange, AppData, autoSync, categoryName, currentVehicle, deleteRecord, detectOpenStop, dismissStop, ExpenseData, fmtDateTime,
  LedgerRecord, loadData, NewVehicle, openStopNow, saveExpense, saveFuel, saveWidgetSnapshot, Stop, SyncResult, syncSubtitle, syncXxyh,
  toExpenseData, toFuelData, updateSettings, Vehicle, waitForPendingSync,
} from "../common/model"
import { AppActions, money, showError } from "./components"
import { ExpenseForm } from "./expense_form"
import { FuelForm, FuelFormResult } from "./fuel_form"
import { RecordsPage } from "./records"
import { SettingsPage } from "./settings"
import { StatsPage } from "./stats"
import { VehicleAdd } from "./vehicle_add"
import { VehicleMenuActions } from "./vehicle_menu"

const TAB_RECORDS = 0
const TAB_STATS = 1
const TAB_SETTINGS = 2

export function App({ action }: { action: string | null }) {
  const [initial] = useState(() => loadData())
  const [data, setDataState] = useState<AppData>(initial.data)
  const ref = useRef<AppData>(initial.data)
  const [message, setMessage] = useState<string | null>(null)
  // 选中的标签交给原生直接维护（Observable），不经过 React 状态回传，切换才不会被拉回；没有车辆时用它跳到设置
  const selection = useObservable<number>(TAB_RECORDS)
  // 记录页顶部的加油停车提示：先按上次缓存的行程显示，读到最新行程后更新
  const [openStop, setOpenStop] = useState<Stop | null>(() => openStopNow(initial.data, currentVehicle(initial.data)))

  const setData = (d: AppData) => {
    ref.current = d
    setDataState(d)
    setOpenStop(openStopNow(d, currentVehicle(d)))
    saveWidgetSnapshot(d)
    Widget.reloadAll()
  }
  const getData = () => ref.current
  const messageTimer = useRef<number | null>(null)

  /** 标题下方的临时提示，几秒后换回同步状态；出错的提示一直留到下次同步 */
  function flash(text: string | null, sticky = false) {
    setMessage(text)
    if (messageTimer.current != null) clearTimeout(messageTimer.current)
    messageTimer.current = text && !sticky ? (setTimeout(() => setMessage(null), 6000) as unknown as number) : null
  }

  async function applySync(p: Promise<SyncResult | null>) {
    const r = await p
    if (!r) return
    setData(r.data)
    if (r.error) flash(`同步失败：${r.error}`, true)
    else flash(r.message)
    if (r.alert) await Dialog.alert({ title: "同步提示", message: r.alert })
  }

  async function refreshOpenStop(force = false) {
    try {
      const d = getData()
      setOpenStop(await detectOpenStop(d, currentVehicle(d), force))
    } catch {
      setOpenStop(null) // 读不到行程时不显示提示，不打扰
    }
  }

  /** 添加车辆（设计文档 17.4 节）：从车辆菜单、设置、记录页没有车辆时进入；添加后切换到它 */
  async function openAddVehicle() {
    const res = await Navigation.present<NewVehicle | null>({ element: <VehicleAdd data={getData()} /> })
    if (!res) return
    try {
      setData(addVehicle(getData(), res))
      flash(`已添加「${res.name}」`)
      refreshOpenStop()
    } catch (e) {
      await showError("添加失败", e)
    }
  }

  const vehicleActions: VehicleMenuActions = {
    switchVehicle: v => { setData(updateSettings(getData(), { current_vehicle_id: v.id })); flash(null); refreshOpenStop() },
    addVehicle: () => { openAddVehicle() },
    manageVehicles: () => selection.setValue(TAB_SETTINGS),
  }

  const app: AppActions = { getData, setData, sync: upload => applySync(syncXxyh(getData(), { upload })), addVehicle: openAddVehicle }

  async function openFuel(vehicle: Vehicle, record: LedgerRecord | null, stop: Stop | null = null) {
    const res = await Navigation.present<FuelFormResult | null>({
      element: <FuelForm data={getData()} vehicle={vehicle} record={record && record.kind === "fuel" ? { ...toFuelData(record), id: record.id } : null} initialStop={stop} />,
    })
    if (!res) return
    try {
      const r = saveFuel(getData(), vehicle, record ? record.id : null, res.fuel, res.newStation)
      setData(r.data)
      flash(r.linked ? "已保存，正在上传到小熊油耗…" : "已保存", r.linked)
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
      flash(r.linked ? "已保存，正在上传到小熊油耗…" : "已保存", r.linked)
      await applySync(afterChange(r.data, r.linked))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /**
   * 记加油：没有车辆时先去设置添加。
   * stop 只在加油停车提示里点「记一笔」时传入（直接填入）；其他入口不传，表单里只给建议（设计文档 16.5 节）。
   */
  function addFuel(stop: Stop | null = null) {
    const v = currentVehicle(getData())
    if (!v) {
      selection.setValue(TAB_SETTINGS)
      Dialog.alert({ title: "还没有车辆", message: "请先在「设置 › 车辆」中添加车辆，或连接小熊油耗。" })
      return
    }
    openFuel(v, null, stop)
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
    const choice = await Dialog.actionSheet({
      title: `删除 ${what}？`,
      ...(record.origin === "xxyh" ? { message: "删除会同步到小熊油耗。" } : {}),
      actions: [{ label: "删除", destructive: true }],
    })
    if (choice !== 0) return
    try {
      const r = deleteRecord(getData(), v, record)
      setData(r.data)
      await applySync(afterChange(r.data, r.linked))
    } catch (e) {
      await showError("删除失败", e)
    }
  }

  useEffect(() => {
    saveWidgetSnapshot(getData())
    void (async () => {
      if (initial.warnings.length) await Dialog.alert({ title: "数据文件", message: initial.warnings.join("\n") })
      // 从小组件进入：等主界面出现后再弹表单，避免两个页面同时弹出
      if (action === "add_fuel") setTimeout(() => addFuel(), 500)
    })()
    // 行程检测和同步同时开始：从小组件进入时，表单打开后可以直接等这次读取的结果
    refreshOpenStop()
    applySync(autoSync(getData()))
    // 油记已经打开时，小组件用 run_single 再次进入：在当前实例里处理「记加油」
    const offResume = Script.onResume(details => {
      const params = (details.queryParameters || {}) as Record<string, string>
      if (params.action === "add_fuel") addFuel()
    })
    const onPhase = (phase: string) => {
      if (phase !== "active") return
      refreshOpenStop()
      applySync(autoSync(getData()))
    }
    AppEvents.scenePhase.addListener(onPhase)
    return () => {
      AppEvents.scenePhase.removeListener(onPhase)
      offResume()
    }
  }, [])

  return <TabView selection={selection} tabBarMinimizeBehavior="onScrollDown">
    <Tab title="记录" systemImage="list.bullet.rectangle" value={TAB_RECORDS}>
      <RecordsPage data={data} subtitle={message || syncSubtitle(data)} stop={openStop} actions={{
        addFuel: () => addFuel(),
        addExpense: () => { const v = currentVehicle(getData()); if (v) openExpense(v, null) },
        recordStop: s => addFuel(s),
        dismissStop: s => { setData(dismissStop(getData(), s)); setOpenStop(null) },
        edit,
        remove,
        ...vehicleActions,
        sync: async () => { await app.sync(true); await refreshOpenStop(true) },
      }} />
    </Tab>
    <Tab title="统计" systemImage="chart.bar.xaxis" value={TAB_STATS}>
      <StatsPage data={data} vehicleActions={vehicleActions} />
    </Tab>
    <Tab title="设置" systemImage="gearshape" value={TAB_SETTINGS}>
      <SettingsPage data={data} app={app} />
    </Tab>
  </TabView>
}

/** 主界面：关闭后先等正在进行的上传结束，再退出脚本 */
export async function runApp(action: string | null): Promise<void> {
  await Navigation.present({ element: <App action={action} /> })
  await waitForPendingSync()
}
