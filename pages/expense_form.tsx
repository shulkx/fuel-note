// 记费用 / 编辑费用（设计文档 22.9 节）：第一行是类别的分段（小熊的类别按 sortId，不含保险和交通规费；车险在「保险」页记），
// 下面的字段按规则变：1.6 每类都是 时间 · 金额 · 备注；1.7 每类加门店，有能用的权益时加「使用权益」和「实付」；2.1 维修保养多一组「保养」（里程、项目）。
// 填了项目才另存一条保养记录（common/maintenance.ts）；带保养记录的费用编辑时类别锁住，备注是保养的说明（导出时小熊的费用备注由它和里程、项目生成）。
// 超过 4 类时（以后在小熊里再建类别，或编辑一笔保险和交通规费的费用）改成第一组的单选列表。切换类别时已填的内容保留；编辑时也能改类别。
// 「使用权益」列出所有还能用的卡（不按门店、类别筛选，权益设计第 4 节）；「用于记费用」预选的、在使用权益里新勾上的储值，手动改之前抵扣跟着金额走。
// 保存的金额是实付；门店存在费用的 store_id，备注只是用户写的内容（2.0 起；导出到小熊时才把用量和门店写进备注最后一行）。
import {
  Button, DatePicker, Form, HStack, Navigation, NavigationLink, NavigationStack, Picker, Rectangle, Section, Spacer, Text, TextField, useRef, useState,
} from "scripting"
import {
  AppData, categoriesFor, checkExpense, deductOf, ExpenseData, expenseUses, followAmount, formCategories, keptNumber, lastStoreFor, MAINTENANCE_CATEGORY,
  MaintenanceInput, MaintenanceRecord, numText, perkBook, Store, usablePerks, usedItems, Use, Vehicle, vehicleRecords, yuan,
} from "../common/model"
import { StoreActions } from "./benefit_parts"
import { PerkPick } from "./benefit_pick"
import { FieldRow } from "./components"
import { MaintenanceItems } from "./maintenance_items"
import { StorePicker } from "./store_picker"

/** 分段最多几段：iPhone 上不超过 5 段、各段文字长短相近（HIG · Segmented controls）；类别名长短不一，4 段为止 */
const MAX_SEGMENTS = 4
const round2 = (n: number) => Math.round(n * 100) / 100

/** maintenance：维修保养、填了项目时的「保养」一组，其他情况 null（保存时删掉这笔费用原来的保养记录） */
export type ExpenseFormResult = { expense: ExpenseData; uses: Use[]; store: Store | null; maintenance: MaintenanceInput | null }

const itemsText = (items: string[]) => (items.length <= 2 ? items.join("、") : `${items[0]} 等 ${items.length} 项`)

export function ExpenseForm({ getData, vehicle, record, maintenance, odometer: defaultOdometer, initialCategory, preset, stores }: {
  getData: () => AppData
  vehicle: Vehicle
  record: (ExpenseData & { id: string; store_id?: string }) | null
  /** 这笔费用的保养记录（编辑时）；有时类别锁住 */
  maintenance: MaintenanceRecord | null
  /** 新记保养时里程的默认值：车况的里程表；没有时 null */
  odometer: number | null
  /** 新记时默认的类别：最近一笔不是保险和交通规费的费用的类别（common/expense_stats.ts 的 defaultCategory） */
  initialCategory: number
  /** 权益详情「用于记费用」：勾上这一项、预选门店 */
  preset: { use: Use; store: Store | null } | null
  stores: StoreActions
}) {
  const dismiss = Navigation.useDismiss()
  const data = getData()
  const book = perkBook(data.ledger)
  const records = vehicleRecords(data, vehicle)
  const categories = formCategories(categoriesFor(data), record?.category_id ?? null)

  // 打开时的内容：门店取 store_id，用过的权益按这笔费用的 id 找，金额加回抵扣（存的是实付）
  const [opened] = useState(() => {
    if (!record) {
      return { body: "", store: preset?.store ?? lastStoreFor(records, initialCategory, data.ledger.stores), uses: preset ? [preset.use] : [], amount: null as number | null }
    }
    const uses: Use[] = expenseUses(book, vehicle.id, record.id).flatMap(u => {
      const p = book.perks.find(x => x.id === u.perk_id)
      return p ? [{ perk_id: u.perk_id, used: u.used, deduct: deductOf(p, u.used) }] : []
    })
    const amount = round2(record.amount + uses.reduce((t, u) => t + u.deduct, 0))
    const store = record.store_id ? data.ledger.stores.find(s => s.id === record.store_id) ?? null : null
    return { body: maintenance ? maintenance.remark : record.remark, store, uses, amount }
  })
  const [ts, setTs] = useState(record?.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? initialCategory)
  const [amount, setAmount] = useState(opened.amount != null ? numText(opened.amount) : "")
  const [remark, setRemark] = useState(opened.body)
  const [store, setStore] = useState<Store | null>(opened.store)
  const [uses, setUses] = useState<Use[]>(opened.uses)
  // 跟着金额走的储值：「用于记费用」预选的，和在使用权益里新勾上、还没手动改过的
  const [follow, setFollow] = useState<string[]>(() => (preset ? [preset.use.perk_id] : []))
  const openedAmount = useRef(amount)
  const openedOdometer = maintenance ? String(maintenance.odometer) : defaultOdometer != null ? String(Math.floor(defaultOdometer)) : ""
  const [odometer, setOdometer] = useState(openedOdometer)
  const [items, setItems] = useState<string[]>(maintenance?.items ?? [])
  const locked = !!maintenance
  const isMaint = category === MAINTENANCE_CATEGORY
  const used = usedItems(data.ledger.records, vehicle.id)

  const usable = usablePerks(book, vehicle.id, ts, record?.id ?? null)
  const value = keptNumber(amount, openedAmount.current, opened.amount ?? undefined)
  // 过期的卡（改了日期）不算；跟着金额走的储值按金额重新分配
  const active = followAmount(uses.filter(u => usable.some(x => x.perk.id === u.perk_id)), follow, usable, value)
  const deduct = round2(active.reduce((t, u) => t + u.deduct, 0))
  const paid = value == null ? null : round2(value - deduct)
  const usesText = (list: Use[]) => list.map(u => `${u.perk_id}:${u.used}:${u.deduct}`).sort().join("|")

  // 有改动时禁止下滑关闭
  const dirty = record
    ? ts !== record.ts || category !== record.category_id || paid !== record.amount || remark !== opened.body
      || (store?.id ?? null) !== (opened.store?.id ?? null) || usesText(active) !== usesText(opened.uses)
      || odometer !== openedOdometer || items.join("\n") !== (maintenance?.items ?? []).join("\n")
    : !!(amount || remark.trim() || active.length || items.length)

  function pickChanged(next: Use[], manual: string | null) {
    const added = next.filter(u => !uses.some(x => x.perk_id === u.perk_id)).map(u => u.perk_id)
    setFollow([...follow.filter(id => id !== manual && next.some(u => u.perk_id === id)), ...added.filter(id => usable.find(x => x.perk.id === id)?.perk.kind === "balance")])
    setUses(next)
  }

  async function save() {
    // 编辑记录但什么都没改：直接关闭，不写数据
    if (record && !dirty) return dismiss(null)
    const errors = checkExpense(value)
    if (!errors.length && paid != null && paid < 0) errors.push(`权益抵扣合计（${yuan(deduct)}）比金额多，请在「使用权益」里改小。`)
    const odo = odometer.trim() ? Number(odometer.replace(/[,\s]/g, "")) : 0
    if (isMaint && items.length && !(Number.isFinite(odo) && odo >= 0)) errors.push("里程要填数字（公里）。")
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    // 备注没改就保留原样（导入的费用备注里有小熊写的「保养里程」「保养项目」两行，保养的说明也照旧）
    const keptRemark = record && remark === opened.body ? record.remark : remark.trim()
    const maintRemark = maintenance && remark === opened.body ? maintenance.remark : remark.trim()
    const result: ExpenseFormResult = {
      expense: { ts, category_id: category, amount: paid as number, remark: keptRemark }, uses: active, store,
      maintenance: isMaint && items.length ? { odometer: Math.round(odo), items, remark: maintRemark } : null,
    }
    dismiss(result)
  }

  const options = categories.map(c => <Text key={String(c.id)} tag={c.id}>{c.name}</Text>)
  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle={record ? "编辑费用" : "记费用"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      {categories.length <= MAX_SEGMENTS
        // 分段直接放在背景上（与统计页的范围相同）
        ? <Section key="category" {...(locked ? { footer: <Text>这笔费用带保养记录，类别固定为维修保养。去掉全部项目保存后只留下费用，就能改类别。</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="segmented" disabled={locked}
            listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
            {options}
          </Picker>
        </Section>
        : <Section key="category" header={<Text>类别</Text>} {...(locked ? { footer: <Text>这笔费用带保养记录，类别固定为维修保养。去掉全部项目保存后只留下费用，就能改类别。</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="inline" labelsHidden disabled={locked}>
            {options}
          </Picker>
        </Section>}
      <Section key="fields"
        {...(active.length ? { footer: <Text>保存的金额是实付。导出到小熊油耗时，用了哪些权益和门店写在备注最后一行。</Text> } : {})}>
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores} />}>
          <HStack>
            <Text>门店</Text>
            <Spacer />
            <Text foregroundStyle={store ? "label" : "secondaryLabel"}>{store?.name ?? "不选"}</Text>
          </HStack>
        </NavigationLink>
        <FieldRow title="金额" unit="元">
          <TextField title="金额" value={amount} onChanged={setAmount} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {usable.length || active.length
          ? <NavigationLink destination={<PerkPick usable={usable} uses={active} amount={value} onChange={pickChanged} />}>
            <HStack>
              <Text>使用权益</Text>
              <Spacer />
              <Text foregroundStyle="secondaryLabel">{active.length ? `${active.length} 项 · 抵扣 ${yuan(deduct)}` : `可用 ${usable.length} 项`}</Text>
            </HStack>
          </NavigationLink>
          : null}
        {active.length ? <HStack>
          <Text>实付</Text>
          <Spacer />
          <Text font="headline">{paid != null ? yuan(paid) : "—"}</Text>
        </HStack> : null}
      </Section>
      {isMaint ? <Section key="maintenance" header={<Text>保养</Text>}
        footer={<Text>{locked ? "保养记录和这笔费用一起改。" : "里程默认取车况的里程表。填了项目才另存一条保养记录，费用页里和这笔费用合成一行；不填只记费用。"}</Text>}>
        <FieldRow title="里程" unit="km">
          <TextField title="里程" value={odometer} onChanged={setOdometer} prompt="0" keyboardType="numberPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <NavigationLink destination={<MaintenanceItems items={items} used={used} onChange={setItems} />}>
          <HStack>
            <Text>项目</Text>
            <Spacer />
            <Text foregroundStyle={items.length ? "label" : "secondaryLabel"} lineLimit={1}>{items.length ? itemsText(items) : "选择项目"}</Text>
          </HStack>
        </NavigationLink>
      </Section> : null}
      <Section key="remark" header={<Text>备注</Text>}
        footer={<Text>{locked
          ? "里程和项目不用再写进备注，导出到小熊时油记会自动加上。"
          : record ? "可以改类别。车险在「保险」页记。" : "默认是最近一笔费用的类别和这一类上次的门店；切换类别时，已填的内容保留。车险在「保险」页记。"}</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt={isMaint ? "选填" : "项目等"} axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
