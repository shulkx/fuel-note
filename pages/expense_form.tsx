// 记费用 / 编辑费用（设计文档 22.9 节）：第一行是类别的分段（小熊的类别按 sortId，不含保险和交通规费；车险在「保险」页记），
// 下面的字段按规则变：1.6 每类都是 时间 · 金额 · 备注；1.7 每类加门店，有能用的权益时加「使用权益」和「实付」；1.8 维修保养加里程、项目。
// 超过 4 类时（以后在小熊里再建类别，或编辑一笔保险和交通规费的费用）改成第一组的单选列表。切换类别时已填的内容保留；编辑时也能改类别。
// 「使用权益」列出所有还能用的卡（不按门店、类别筛选，权益设计第 4 节）；「用于记费用」预选的、在使用权益里新勾上的储值，手动改之前抵扣跟着金额走。
// 保存的金额是实付；门店存在费用的 store_id，备注只是用户写的内容（2.0 起；导出到小熊时才把用量和门店写进备注最后一行）。
import {
  Button, DatePicker, Form, HStack, Navigation, NavigationLink, NavigationStack, Picker, Rectangle, Section, Spacer, Text, TextField, useRef, useState,
} from "scripting"
import {
  AppData, categoriesFor, checkExpense, ExpenseData, expenseUses, followAmount, formCategories, keptNumber, lastStoreFor, numText,
  perkBook, Store, usablePerks, Use, Vehicle, vehicleRecords, yuan,
} from "../common/model"
import { StoreActions } from "./benefit_parts"
import { PerkPick } from "./benefit_pick"
import { FieldRow } from "./components"
import { StorePicker } from "./store_picker"

/** 分段最多几段：iPhone 上不超过 5 段、各段文字长短相近（HIG · Segmented controls）；类别名长短不一，4 段为止 */
const MAX_SEGMENTS = 4
const round2 = (n: number) => Math.round(n * 100) / 100

export type ExpenseFormResult = { expense: ExpenseData; uses: Use[]; store: Store | null }

export function ExpenseForm({ getData, vehicle, record, initialCategory, preset, stores }: {
  getData: () => AppData
  vehicle: Vehicle
  record: (ExpenseData & { id: string; store_id?: string }) | null
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
    const uses: Use[] = expenseUses(book, vehicle.id, record.id).map(u => ({ perk_id: u.perk_id, used: u.used, deduct: u.deduct }))
    const amount = round2(record.amount + uses.reduce((t, u) => t + u.deduct, 0))
    const store = record.store_id ? data.ledger.stores.find(s => s.id === record.store_id) ?? null : null
    return { body: record.remark, store, uses, amount }
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
    : !!(amount || remark.trim() || active.length)

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
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    const result: ExpenseFormResult = { expense: { ts, category_id: category, amount: paid as number, remark: remark.trim() }, uses: active, store }
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
        ? <Section key="category">
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="segmented"
            listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
            {options}
          </Picker>
        </Section>
        : <Section key="category" header={<Text>类别</Text>}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="inline" labelsHidden>
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
      <Section key="remark" header={<Text>备注</Text>}
        footer={<Text>{record ? "可以改类别。车险在「保险」页记。" : "默认是最近一笔费用的类别和这一类上次的门店；切换类别时，已填的内容保留。车险在「保险」页记。"}</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="项目等" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
