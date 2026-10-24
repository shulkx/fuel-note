// 根页面：油耗、费用、保险、权益、设置五个标签（设计文档 21.2、22.3 节）。标签栏只做页面切换，「记加油」「记费用」「记保险」「添加权益」放在各自右上角的「+」。
// 负责打开表单、保存，以及识别未记录的加油停车（显示在油耗 › 记录的顶部）。数据都存在油记里，不和小熊同步。
import { AppEvents, Navigation, Script, Tab, TabView, Widget, useEffect, useObservable, useRef, useState } from "scripting"
import {
  addVehicle, AppData, batchInfo, batchPerks, cachedStatus, canReadStatus, categoriesFor, categoryName, currentVehicle, defaultCategory, defaultUse,
  deleteInsurance, deletePerks, deleteRecord, deleteStore, deleteUse, detectOpenStop, dismissRenewal, dismissStop, expenseEntries, ExpenseEntry,
  ExpenseRecord, expenseUses, fmtDate, fmtDateTime, insuranceForRecord, InsuranceYear, LedgerRecord, loadData, MAINTENANCE_CATEGORY, newId,
  NewVehicle, openStopNow, Perk, perkBook, PerkUse, providerById, readVehicleStatus, remaining, sameName, saveBatch, saveExpense, saveFuel,
  saveInsurance, savePerk, savePerks, saveStore, saveUse, saveWidgetSnapshot, Stop, Store, toExpenseData, toFuelData, updateSettings,
  usageLine, Use, usedOf, useText, Vehicle, vehicleById, vehicleRecords, vehicleTank, yearLabel, yuan,
} from "../common/model"
import { AppActions, errorMessage, money, showError } from "./components"
import { BatchPage } from "./benefit_batch"
import { BatchEditResult, BatchEditSheet } from "./benefit_batch_edit"
import { AddPerksForm, AddResult } from "./benefit_form"
import { ItemSheet, ItemSheetResult } from "./benefit_item_form"
import { BenefitActions, StoreActions } from "./benefit_parts"
import { BenefitTab } from "./benefit_tab"
import { UseSheet } from "./benefit_use"
import { InsuranceDetail, InsuranceDetailActions } from "./insurance_detail"
import { InsuranceForm, InsuranceFormResult } from "./insurance_form"
import { InsuranceTab } from "./insurance_tab"
import { ExpenseForm, ExpenseFormResult } from "./expense_form"
import { ExpenseTab } from "./expense_tab"
import { FuelForm, FuelFormResult } from "./fuel_form"
import { StatusSheet, StatusView } from "./fuel_status"
import { FuelTab } from "./fuel_tab"
import { SettingsPage } from "./settings"
import { VehicleAdd } from "./vehicle_add"
import { VehicleMenuActions } from "./vehicle_menu"

const TAB_FUEL = 0
const TAB_EXPENSE = 1
const TAB_INSURANCE = 2
const TAB_BENEFITS = 3
const TAB_SETTINGS = 4

export function App({ action, image, notice }: { action: string | null; image: UIImage | null; notice: string | null }) {
  const [initial] = useState(() => loadData())
  const [data, setDataState] = useState<AppData>(initial.data)
  const ref = useRef<AppData>(initial.data)
  const [message, setMessage] = useState<string | null>(null)
  // 选中的标签交给原生直接维护（Observable），不经过 React 状态回传，切换才不会被拉回；没有车辆时用它跳到设置
  const selection = useObservable<number>(TAB_FUEL)
  // 油耗 › 记录顶部的加油停车提示：先按上次缓存的行程显示，读到最新行程后更新
  const [openStop, setOpenStop] = useState<Stop | null>(() => openStopNow(initial.data, currentVehicle(initial.data)))
  // 车况（设计文档 18.3 节）：先显示上次缓存的结果；打开、回到前台、下拉刷新、切换车辆时读取（10 分钟内用缓存）
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [, setStatusVersion] = useState(0)

  const setData = (d: AppData) => {
    ref.current = d
    setDataState(d)
    setOpenStop(openStopNow(d, currentVehicle(d)))
    saveWidgetSnapshot(d)
    Widget.reloadAll()
  }
  const getData = () => ref.current
  const messageTimer = useRef<number | null>(null)

  /** 标题下方的临时提示，几秒后换回车辆名 */
  function flash(text: string | null) {
    setMessage(text)
    if (messageTimer.current != null) clearTimeout(messageTimer.current)
    messageTimer.current = text ? (setTimeout(() => setMessage(null), 6000) as unknown as number) : null
  }

  /** 保存后的数据放回去，标题下方闪一下提示 */
  function mutate(next: AppData, label: string | null = "已保存") {
    setData(next)
    if (label) flash(label)
  }

  /** 当前车辆；还没有车辆时跳到设置并提示 */
  function requireVehicle(): Vehicle | null {
    const v = currentVehicle(getData())
    if (v) return v
    selection.setValue(TAB_SETTINGS)
    void Dialog.alert({ title: "还没有车辆", message: "请先在「设置 › 车辆」中添加车辆，或从小熊油耗导入。" })
    return null
  }

  async function refreshOpenStop(force = false) {
    try {
      const d = getData()
      setOpenStop(await detectOpenStop(d, currentVehicle(d), force))
    } catch {
      setOpenStop(null) // 读不到行程时不显示提示，不打扰
    }
  }

  /** 读车况，读到后更新小组件。自动读取失败时不提示（保留上次的结果）；轻点车况行、下拉刷新或还没有车况时才显示原因 */
  async function refreshStatus(force = false): Promise<string | null> {
    const d = getData()
    const v = currentVehicle(d)
    if (!canReadStatus(v)) return null
    setStatusBusy(true)
    try {
      await readVehicleStatus(d, v, force)
      setStatusError(null)
      saveWidgetSnapshot(getData())
      Widget.reloadAll()
      return null
    } catch (e) {
      const message = errorMessage(e)
      setStatusError(force || !cachedStatus(v) ? message : null)
      return message
    } finally {
      setStatusBusy(false)
      setStatusVersion(Date.now())
    }
  }

  /** 车况的显示状态；当前车辆不能读车况时为 null（油耗 › 记录没有「当前」一组） */
  function statusView(d: AppData): StatusView | null {
    const v = currentVehicle(d)
    if (!v || !v.provider || !canReadStatus(v)) return null
    return { snapshot: cachedStatus(v), tank: vehicleTank(d, v), busy: statusBusy, error: statusError, source: providerById(v.provider.id)?.name || "车辆数据" }
  }

  /** 车况详情：看完整数据、重新读取 */
  function openStatus() {
    Navigation.present({
      element: <StatusSheet
        get={() => statusView(getData()) || { snapshot: null, tank: null, busy: false, error: null, source: "车辆数据" }}
        refresh={() => refreshStatus(true)}
      />,
    })
  }

  /** 当前车辆的行程和车况 */
  function refreshVehicle(force = false) {
    return Promise.all([refreshOpenStop(force), refreshStatus(force)])
  }

  /** 添加车辆（设计文档 17.4 节）：从车辆菜单、设置、没有车辆时进入；添加后切换到它 */
  async function openAddVehicle() {
    const res = await Navigation.present<NewVehicle | null>({ element: <VehicleAdd data={getData()} /> })
    if (!res) return
    try {
      mutate(addVehicle(getData(), res), `已添加「${res.name}」`)
      refreshVehicle()
    } catch (e) {
      await showError("添加失败", e)
    }
  }

  const vehicleActions: VehicleMenuActions = {
    switchVehicle: v => { setData(updateSettings(getData(), { current_vehicle_id: v.id })); flash(null); setStatusError(null); refreshVehicle() },
    addVehicle: () => { openAddVehicle() },
    manageVehicles: () => selection.setValue(TAB_SETTINGS),
  }

  const app: AppActions = { getData, setData, addVehicle: openAddVehicle }

  async function openFuel(vehicle: Vehicle, record: LedgerRecord | null, stop: Stop | null = null, image: UIImage | null = null) {
    const res = await Navigation.present<FuelFormResult | null>({
      element: <FuelForm
        data={getData()}
        vehicle={vehicle}
        record={record && record.kind === "fuel" ? { ...toFuelData(record), id: record.id } : null}
        initialStop={stop}
        initialImage={image}
      />,
    })
    if (!res) return
    try {
      mutate(saveFuel(getData(), vehicle, record ? record.id : null, res.fuel, res.newStation))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 选择门店页里新建、改名、删除门店：直接写进账本 */
  const storeActions: StoreActions = {
    save: s => { const r = saveStore(getData(), s); setData(r.data); return r.store },
    remove: id => setData(deleteStore(getData(), id)),
  }

  /**
   * 记费用、编辑费用。preset：权益详情「用于记费用」时勾上的那一项和预选的门店、类别（设计文档 22.10 节）。
   * 保存时一起写用了的权益和门店（金额是实付，门店存在费用上）
   */
  async function openExpense(vehicle: Vehicle, record: LedgerRecord | null, preset: { use: Use; store: Store | null; category: number } | null = null) {
    const d = getData()
    const res = await Navigation.present<ExpenseFormResult | null>({
      element: <ExpenseForm
        getData={getData}
        vehicle={vehicle}
        record={record && record.kind === "expense" ? { ...toExpenseData(record), id: record.id, ...(record.store_id ? { store_id: record.store_id } : {}) } : null}
        initialCategory={preset?.category ?? defaultCategory(expenseEntries(vehicleRecords(d, vehicle)), categoriesFor(d))}
        preset={preset ? { use: preset.use, store: preset.store } : null}
        stores={storeActions}
      />,
    })
    if (!res) return
    try {
      mutate(saveExpense(getData(), vehicle, record ? record.id : null, res.expense, { uses: res.uses, store: res.store }))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  // ---------- 保险（设计文档第 20 节） ----------

  /** 记保险、编辑保险、补充保单（link 是「只有金额」的那笔费用）。新记时用当前车辆 */
  async function openInsuranceForm(year: InsuranceYear | null, link: ExpenseRecord | null = null) {
    const v = year ? vehicleById(getData(), year.vehicle_id) : requireVehicle()
    if (!v) return
    const res = await Navigation.present<InsuranceFormResult | null>({ element: <InsuranceForm data={getData()} vehicle={v} year={year} link={link} /> })
    if (!res) return
    try {
      mutate(saveInsurance(getData(), v, res.year, res.amount).data)
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 删除一年的保险：连费用一起删，或只删保单明细；删了返回 true */
  async function removeInsurance(y: InsuranceYear): Promise<boolean> {
    const choice = await Dialog.actionSheet({
      title: `删除「${yearLabel(y)}」？`,
      message: "保单原件一起删除。",
      actions: [{ label: "删除保单和费用", destructive: true }, { label: "只删除保单明细，保留费用", destructive: true }],
    })
    if (choice !== 0 && choice !== 1) return false
    try {
      setData(deleteInsurance(getData(), y.id, choice === 0))
      return true
    } catch (e) {
      await showError("删除失败", e)
      return false
    }
  }

  // ---------- 权益（权益设计 docs/specs/2026-10-23-benefits-wallet.md，1.7） ----------
  // 动作都只收 id，按 id 从 getData() 重新取，不依赖推入页手里的旧对象

  const perkById = (id: string) => perkBook(getData().ledger).perks.find(p => p.id === id) ?? null

  /** 添加一批；yearId：从保单详情「赠送」一行打开时预选那一年。套餐可以顺手记一笔费用（只记这一次） */
  async function addPerks(yearId: string | null) {
    const v = requireVehicle()
    if (!v) return
    const res = await Navigation.present<AddResult | null>({ element: <AddPerksForm getData={getData} vehicle={v} presetYear={yearId} stores={storeActions} /> })
    if (!res) return
    try {
      mutate(savePerks(getData(), v, res.perks, res.purchase), `已添加 ${res.perks.length} 项`)
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 编辑一张卡（弹出编辑权益，保存即生效） */
  async function editPerk(id: string) {
    const p = perkById(id)
    const v = p ? vehicleById(getData(), p.vehicle_id) : null
    if (!p || !v) return
    const res = await Navigation.present<ItemSheetResult | null>({
      element: <ItemSheet getData={getData} perk={p} isNew={false} used={usedOf(perkBook(getData().ledger), p.id)} stores={storeActions} />,
    })
    if (!res) return
    try {
      setData(savePerk(getData(), v, res.perk))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 给一批添加一项：沿用这一批第一张卡的来自、有效期、门店；同名时先提示 */
  async function addToBatch(key: string) {
    const v = currentVehicle(getData())
    const first = v ? batchPerks(perkBook(getData().ledger), v.id, key)[0] : undefined
    if (!v || !first) return
    const base: Perk = { ...first, id: newId("pk"), name: "", kind: "count", total: 1, unit: "次", note: "", created_ts: Date.now() }
    const res = await Navigation.present<ItemSheetResult | null>({ element: <ItemSheet getData={getData} perk={base} isNew used={0} stores={storeActions} /> })
    if (!res) return
    const dup = sameName(perkBook(getData().ledger), v.id, key, res.perk.name)
    if (dup) {
      const choice = await Dialog.actionSheet({ title: "可能重复", message: `「${first.source}」里已有「${dup.name}」。`, actions: [{ label: "仍然添加" }] })
      if (choice !== 0) return
    }
    try {
      setData(savePerk(getData(), v, res.perk))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 记过的费用不变的说明：一笔时写出日期、类别和实付 */
  function keptExpenses(uses: PerkUse[]): string {
    const d = getData()
    const ids = new Set(uses.map(u => u.expense_id).filter((id): id is string => id != null))
    const found = d.ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense" && ids.has(r.id))
    if (!found.length) return ""
    if (found.length === 1) return `${fmtDate(found[0].ts)} 的${categoryName(d, found[0].category_id)}费用不变（实付 ${yuan(found[0].amount)}）。`
    return `记过的 ${found.length} 笔费用不变。`
  }

  /** 删除一张卡：确认里写明一起删除的使用记录，记过的费用不变；删了返回 true */
  async function removePerk(id: string): Promise<boolean> {
    const p = perkById(id)
    const v = p ? vehicleById(getData(), p.vehicle_id) : null
    if (!p || !v) return false
    const uses = perkBook(getData().ledger).uses.filter(u => u.perk_id === id)
    const message = [uses.length ? `${uses.length} 条使用记录一起删除。` : "", keptExpenses(uses)].filter(Boolean).join("\n")
    const choice = await Dialog.actionSheet({ title: `删除「${p.name}」？`, ...(message ? { message } : {}), actions: [{ label: "删除", destructive: true }] })
    if (choice !== 0) return false
    try {
      setData(deletePerks(getData(), v, [id]))
      return true
    } catch (e) {
      await showError("删除失败", e)
      return false
    }
  }

  /** 编辑一批：来自的名称、有效期、门店、原文写进这一批的每一张卡 */
  async function editBatch(key: string) {
    const v = currentVehicle(getData())
    if (!v) return
    const book = perkBook(getData().ledger)
    const info = batchInfo(book, v.id, key)
    const perks = batchPerks(book, v.id, key)
    if (!info || !perks.length) return
    const res = await Navigation.present<BatchEditResult | null>({
      element: <BatchEditSheet getData={getData} title={info.title} insurance={!!perks[0].insurance_id} end={info.end} store={info.store} mixedStores={info.mixedStores} raw={info.raw}
        count={perks.length} stores={storeActions} />,
    })
    if (!res) return
    try {
      setData(saveBatch(getData(), v, key, res.fields))
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  /** 删除一批：卡和使用记录一起删，记过的费用不变（套餐买价那一笔到费用页删）；删了返回 true */
  async function removeBatch(key: string): Promise<boolean> {
    const v = currentVehicle(getData())
    if (!v) return false
    const book = perkBook(getData().ledger)
    const perks = batchPerks(book, v.id, key)
    if (!perks.length) return false
    const ids = perks.map(p => p.id)
    const uses = book.uses.filter(u => ids.includes(u.perk_id))
    const message = [
      `这一批的 ${perks.length} 项${uses.length ? `和 ${uses.length} 条使用记录` : ""}一起删除。`,
      keptExpenses(uses) || "记过的费用不变。",
      perks[0].origin === "package" ? "要删买价那一笔，到费用页删除。" : "",
    ].filter(Boolean).join("\n")
    const choice = await Dialog.actionSheet({ title: `删除「${perks[0].source}」这一批？`, message, actions: [{ label: "删除这一批", destructive: true }] })
    if (choice !== 0) return false
    try {
      setData(deletePerks(getData(), v, ids))
      return true
    } catch (e) {
      await showError("删除失败", e)
      return false
    }
  }

  /** 记一次使用或修改（半屏） */
  async function useOnce(perkId: string, use: PerkUse | null) {
    const p = perkById(perkId)
    if (!p) return
    const res = await Navigation.present<PerkUse | null>({ element: <UseSheet getData={getData} perk={p} use={use} /> })
    if (!res) return
    try {
      mutate(saveUse(getData(), res), use ? "已保存" : "已记下这次使用")
    } catch (e) {
      await showError("保存失败", e)
    }
  }

  async function removeUse(u: PerkUse) {
    const p = perkById(u.perk_id)
    if (!p) return
    const choice = await Dialog.actionSheet({ title: `删除 ${fmtDate(u.ts)} 的这次使用？`, message: useText(p, u.used), actions: [{ label: "删除", destructive: true }] })
    if (choice !== 0) return
    try {
      setData(deleteUse(getData(), u.id))
    } catch (e) {
      await showError("删除失败", e)
    }
  }

  /** 用于记费用：打开记费用，勾上这一张，门店填卡上写的；类别默认维修保养（权益多用在保养上），没有这一类时用最近一笔的类别 */
  function useInExpense(perkId: string) {
    const d = getData()
    const p = perkById(perkId)
    const v = p ? vehicleById(d, p.vehicle_id) : null
    if (!p || !v) return
    const category = categoriesFor(d).some(c => c.id === MAINTENANCE_CATEGORY) ? MAINTENANCE_CATEGORY : defaultCategory(expenseEntries(vehicleRecords(d, v)), categoriesFor(d))
    openExpense(v, null, { use: defaultUse(p, remaining(perkBook(d.ledger), p), null), store: d.ledger.stores.find(s => s.id === p.store_id) ?? null, category })
  }

  /** 打开一笔费用（记在费用上的使用，按费用的 id） */
  function openExpenseById(id: string) {
    const r = getData().ledger.records.find(x => x.kind === "expense" && x.id === id)
    const v = r ? vehicleById(getData(), r.vehicle_id) : null
    if (r && v) openExpense(v, r)
  }

  /**
   * 记加油：没有车辆时先去设置添加。
   * stop 只在加油停车提示里点「记一笔」时传入（直接填入）；其他入口不传，表单里只给建议（设计文档 16.5 节）。
   */
  function addFuel(stop: Stop | null = null, image: UIImage | null = null) {
    const v = requireVehicle()
    if (v) openFuel(v, null, stop, image)
  }

  async function edit(record: LedgerRecord) {
    const v = currentVehicle(getData())
    if (!v) return
    if (record.kind === "fuel") return openFuel(v, record)
    // 车险的费用不在费用页：有保单的在保单详情里改，只有金额的在保险页补充保单
    if (record.kind === "expense") return openExpense(v, record)
    await Dialog.alert({
      title: "保养记录",
      message: [fmtDateTime(record.ts), `里程 ${record.odometer} 公里`, `花费 ${money(record.amount)}`, record.items.length ? `项目：${record.items.join("、")}` : "", record.remark].filter(Boolean).join("\n"),
    })
  }

  async function remove(record: LedgerRecord) {
    const v = currentVehicle(getData())
    if (!v) return
    const what = record.kind === "fuel" ? `${fmtDateTime(record.ts)} 的加油（${money(record.paid)}）` : `${fmtDateTime(record.ts)} 的${record.kind === "expense" ? categoryName(getData(), record.category_id) : "保养"}（${money(record.amount)}）`
    const insured = record.kind === "expense" && insuranceForRecord(getData().ledger.insurance, record.id)
    const book = perkBook(getData().ledger)
    const restored = record.kind === "expense" ? usageLine(book.perks, expenseUses(book, v.id, record.id), null) : ""
    const notes = [
      insured ? "这笔费用有保单明细，会一起删除（保单原件也删除）。" : "",
      restored ? `用掉的权益会恢复：${restored}。` : "",
    ].filter(Boolean)
    const choice = await Dialog.actionSheet({
      title: `删除 ${what}？`,
      ...(notes.length ? { message: notes.join("\n") } : {}),
      actions: [{ label: "删除", destructive: true }],
    })
    if (choice !== 0) return
    try {
      setData(deleteRecord(getData(), record))
    } catch (e) {
      await showError("删除失败", e)
    }
  }

  useEffect(() => {
    saveWidgetSnapshot(getData())
    void (async () => {
      if (initial.warnings.length) await Dialog.alert({ title: "数据文件", message: initial.warnings.join("\n") })
      // 从小组件进入：等主界面出现后再弹表单，避免两个页面同时弹出
      // 截屏记加油（设计文档第 19 节）带着图片进来：表单打开后直接识别
      if (notice) await Dialog.alert({ title: "截屏记加油", message: notice })
      if (action === "add_fuel") setTimeout(() => addFuel(null, image), 500)
    })()
    // 行程检测和车况同时开始：从小组件进入时，表单打开后可以直接等这次读取的结果
    refreshVehicle()
    // 油记已经打开时，小组件用 run_single 再次进入：在当前实例里处理「记加油」
    const offResume = Script.onResume(details => {
      const params = (details.queryParameters || {}) as Record<string, string>
      if (params.action === "add_fuel") addFuel()
    })
    const onPhase = (phase: string) => {
      if (phase === "active") refreshVehicle()
    }
    AppEvents.scenePhase.addListener(onPhase)
    return () => {
      AppEvents.scenePhase.removeListener(onPhase)
      offResume()
    }
  }, [])

  // 车况在油耗 › 记录最上面的「当前」一组（设计文档 18.2 节）；不能读车况时没有这一组
  const status = statusView(data)
  // 记录页的副标题：保存后的临时提示，平时是车辆名（设计文档 21.2 节）
  const vehicle = currentVehicle(data)
  const subtitle = message || vehicle?.name || null

  const insuranceDetailActions: InsuranceDetailActions = { edit: year => openInsuranceForm(year), remove: removeInsurance }
  const benefitActions: BenefitActions = {
    getData,
    addPerks: yearId => { void addPerks(yearId) },
    editPerk: id => { void editPerk(id) },
    removePerk,
    editBatch: key => { void editBatch(key) },
    addToBatch: key => { void addToBatch(key) },
    removeBatch,
    useOnce: (id, use) => { void useOnce(id, use) },
    removeUse: u => { void removeUse(u) },
    useInExpense,
    openExpense: openExpenseById,
    stores: storeActions,
  }

  /** 费用 › 记录里的一笔：保养（只能查看）、其他费用 */
  function openEntry(e: ExpenseEntry) {
    const r = e.maintenance ?? e.expense
    if (r) edit(r)
  }

  // 标签栏不随滚动收起（用户要求，2026-10-19）
  return <TabView selection={selection} tabBarMinimizeBehavior="never">
    <Tab title="油耗" systemImage="fuelpump" value={TAB_FUEL}>
      <FuelTab data={data} subtitle={subtitle} stop={openStop} status={status} openStatus={openStatus} actions={{
        addFuel: () => addFuel(),
        recordStop: s => addFuel(s),
        dismissStop: s => { setData(dismissStop(getData(), s)); setOpenStop(null) },
        edit,
        remove,
        ...vehicleActions,
        refresh: async () => { await refreshVehicle(true) },
      }} />
    </Tab>
    <Tab title="费用" systemImage="yensign.circle" value={TAB_EXPENSE}>
      <ExpenseTab data={data} subtitle={subtitle} actions={{
        addExpense: () => { const v = requireVehicle(); if (v) openExpense(v, null) },
        open: openEntry,
        // 保养不能删（2.1 起可以编辑、删除）
        remove: e => { if (e.expense && !e.maintenance) remove(e.expense) },
        ...vehicleActions,
      }} />
    </Tab>
    <Tab title="保险" systemImage="checkmark.shield" value={TAB_INSURANCE}>
      <InsuranceTab data={data} subtitle={subtitle} actions={{
        getData,
        addInsurance: link => { openInsuranceForm(null, link) },
        renew: () => { openInsuranceForm(null) },
        dismissRenewal: y => setData(dismissRenewal(getData(), y.id)),
        removeExpense: r => remove(r),
        detail: insuranceDetailActions,
        giftPage: key => <BatchPage data={data} batchKey={key} actions={benefitActions} />,
        addGift: async yearId => { await addPerks(yearId) },
        ...vehicleActions,
      }} />
    </Tab>
    <Tab title="权益" systemImage="ticket" value={TAB_BENEFITS}>
      <BenefitTab data={data} subtitle={subtitle} actions={{
        ...benefitActions,
        policyPage: y => <InsuranceDetail get={getData} yearId={y.id} actions={insuranceDetailActions} />,
        ...vehicleActions,
      }} />
    </Tab>
    <Tab title="设置" systemImage="gearshape" value={TAB_SETTINGS}>
      <SettingsPage data={data} app={app} />
    </Tab>
  </TabView>
}

/** 主界面 */
export async function runApp(action: string | null, image: UIImage | null = null, notice: string | null = null): Promise<void> {
  await Navigation.present({ element: <App action={action} image={image} notice={notice} /> })
}
