// 根页面：记录、统计、设置三个标签，加一个「记加油」突出标签（iOS 27；更早的系统显示为普通标签）。
// 负责打开表单、保存、同步，以及底部提示「发现未记录的加油停车」（iOS 26 起的 tabViewBottomAccessory）。
import {
  AppEvents, Button, ContentUnavailableView, HStack, Image, Navigation, NavigationStack, Script, Spacer, Tab, TabView, Text, VStack, Widget,
  useEffect, useObservable, useRef, useState,
} from "scripting"
import {
  afterChange, AppData, autoSync, categoryName, currentVehicle, daysAgoText, deleteRecord, detectOpenStop, dismissStop, distanceText,
  ExpenseData, fmtDateTime, fmtTime, LedgerRecord, loadData, openStopNow, saveExpense, saveFuel, saveWidgetSnapshot, Stop, SyncResult,
  syncSubtitle, syncXxyh, toExpenseData, toFuelData, updateSettings, Vehicle, waitForPendingSync,
} from "../common/model"
import { AppActions, km, money, showError } from "./components"
import { ExpenseForm } from "./expense_form"
import { FuelForm, FuelFormResult } from "./fuel_form"
import { RecordsPage } from "./records"
import { SettingsPage } from "./settings"
import { StatsPage } from "./stats"

const TAB_RECORDS = 0
const TAB_STATS = 1
const TAB_SETTINGS = 2
const TAB_ADD_FUEL = 3

/** 底部提示：最近 2 天里还没记录的加油停车 */
function StopAccessory({ stop, onRecord, onDismiss }: { stop: Stop; onRecord: () => void; onDismiss: () => void }) {
  const when = `${daysAgoText(stop.end_ts)} ${fmtTime(stop.end_ts)}`
  const where = stop.candidate ? stop.candidate.station.name : stop.place?.address || "加油站"
  return <HStack spacing={10} padding={{ horizontal: 14 }}>
    <Image systemName="fuelpump.fill" foregroundStyle="systemGreen" />
    <Button action={onRecord} buttonStyle="plain">
      <VStack alignment="leading" spacing={1}>
        <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{`${when} 有一次加油停车`}</Text>
        <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
          {[where, stop.candidate?.dist != null ? distanceText(stop.candidate.dist) : "", km(Math.floor(stop.odometer_km))].filter(Boolean).join(" · ")}
        </Text>
      </VStack>
    </Button>
    <Spacer />
    <Button title="记一笔" action={onRecord} buttonStyle="borderedProminent" tint="systemGreen" />
    <Button action={onDismiss} buttonStyle="plain">
      <Image systemName="xmark" font="footnote" foregroundStyle="secondaryLabel" />
    </Button>
  </HStack>
}

export function App({ action }: { action: string | null }) {
  const [initial] = useState(() => loadData())
  const [data, setDataState] = useState<AppData>(initial.data)
  const ref = useRef<AppData>(initial.data)
  const [message, setMessage] = useState<string | null>(null)
  // 选中的标签交给原生直接维护（Observable），不经过 React 状态回传，切换才不会被拉回
  const selection = useObservable<number>(TAB_RECORDS)
  const [openStop, setOpenStopState] = useState<Stop | null>(null)
  const openStopRef = useRef<Stop | null>(null)
  const setOpenStop = (s: Stop | null) => {
    openStopRef.current = s
    setOpenStopState(s)
  }

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

  const app: AppActions = { getData, setData, sync: upload => applySync(syncXxyh(getData(), { upload })) }

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

  /** 记加油：没有车辆时先去设置添加 */
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
    // 点到「记加油」标签：退回原来的标签，打开表单
    const onSelect = (value: number, oldValue: number) => {
      if (value !== TAB_ADD_FUEL) return
      selection.setValue(oldValue === TAB_ADD_FUEL ? TAB_RECORDS : oldValue)
      addFuel(openStopRef.current)
    }
    selection.subscribe(onSelect)
    return () => selection.unsubscribe(onSelect)
  }, [])

  useEffect(() => {
    saveWidgetSnapshot(getData())
    void (async () => {
      if (initial.warnings.length) await Dialog.alert({ title: "数据文件", message: initial.warnings.join("\n") })
      // 从小组件进入：等主界面出现后再弹表单，避免两个页面同时弹出
      if (action === "add_fuel") setTimeout(() => addFuel(), 500)
    })()
    applySync(autoSync(getData())).then(() => refreshOpenStop())
    // 油记已经打开时，小组件用 run_single 再次进入：在当前实例里处理「记加油」
    const offResume = Script.onResume(details => {
      const params = (details.queryParameters || {}) as Record<string, string>
      if (params.action === "add_fuel") addFuel(openStopRef.current)
    })
    const onPhase = (phase: string) => {
      if (phase !== "active") return
      applySync(autoSync(getData())).then(() => refreshOpenStop())
    }
    AppEvents.scenePhase.addListener(onPhase)
    return () => {
      AppEvents.scenePhase.removeListener(onPhase)
      offResume()
    }
  }, [])

  // 只有要提示时才传 tabViewBottomAccessory：传 undefined 也会留出一条空的配件栏
  const accessory = openStop
    ? {
      tabViewBottomAccessory: <StopAccessory
        stop={openStop}
        onRecord={() => addFuel(openStop)}
        onDismiss={() => { setData(dismissStop(getData(), openStop)); setOpenStop(null) }}
      />,
    }
    : {}

  return <TabView
    selection={selection}
    tabBarMinimizeBehavior="onScrollDown"
    {...accessory}
  >
    <Tab title="记录" systemImage="list.bullet.rectangle" value={TAB_RECORDS}>
      <RecordsPage data={data} subtitle={message || syncSubtitle(data)} actions={{
        addFuel: () => addFuel(),
        addExpense: () => { const v = currentVehicle(getData()); if (v) openExpense(v, null) },
        edit,
        remove,
        switchVehicle: v => { setData(updateSettings(getData(), { current_vehicle_id: v.id })); flash(null); refreshOpenStop() },
        addVehicle: async () => selection.setValue(TAB_SETTINGS),
        sync: async () => { await app.sync(true); await refreshOpenStop(true) },
      }} />
    </Tab>
    <Tab title="统计" systemImage="chart.bar.xaxis" value={TAB_STATS}>
      <StatsPage data={data} />
    </Tab>
    <Tab title="设置" systemImage="gearshape" value={TAB_SETTINGS}>
      <SettingsPage data={data} app={app} />
    </Tab>
    <Tab title="记加油" systemImage="fuelpump.fill" role="prominent" value={TAB_ADD_FUEL}>
      <NavigationStack>
        <VStack spacing={16}>
          <ContentUnavailableView title="记加油" systemImage="fuelpump" />
          <Button title="记一笔加油" action={() => addFuel(openStop)} buttonStyle="glassProminent" />
        </VStack>
      </NavigationStack>
    </Tab>
  </TabView>
}

/** 主界面：关闭后先等正在进行的上传结束，再退出脚本 */
export async function runApp(action: string | null): Promise<void> {
  await Navigation.present({ element: <App action={action} /> })
  await waitForPendingSync()
}
