// 记费用 / 编辑费用（设计文档 22.9 节）：第一行是类别的分段（小熊的类别按 sortId，不含保险和交通规费；车险在「保险」页记），
// 下面的字段按规则变：1.6 每类都是 时间 · 金额 · 备注；1.7 每类加门店，有能用的权益时加「使用权益」和「实付」；2.1 维修保养多一组「保养」（里程、项目）。
// 填了项目才另存一条保养记录（common/maintenance.ts）；带保养记录的费用编辑时类别锁住，备注是保养的说明（导出时小熊的费用备注由它和里程、项目生成）。
// 超过 4 类时（以后在小熊里再建类别，或编辑一笔保险和交通规费的费用）改成第一组的单选列表。切换类别时已填的内容保留；编辑时也能改类别。
// 「使用权益」列出所有还能用的卡（不按门店、类别筛选，权益设计第 4 节）；「用于记费用」预选的、在使用权益里新勾上的储值，手动改之前抵扣跟着金额走。
// 保存的金额是实付；门店存在费用的 store_id，备注只是用户写的内容（2.0 起；导出到小熊时才把用量和门店写进备注最后一行）。
import {
  Button, DatePicker, Form, HStack, Navigation, NavigationLink, NavigationStack, Picker, Rectangle, Section, Spacer, Text, TextField, Toggle, useRef, useState, VStack,
} from "scripting"
import {
  AppData, categoriesFor, checkExpense, deductOf, ExpenseData, expenseUses, followAmount, formCategories, keptNumber, lastStoreFor, MAINTENANCE_CATEGORY,
  MaintenanceInput, MaintenanceRecord, numText, parseNum, perkBook, ServiceDraft, ServiceTicket, settlementRefs, Store, ticketLabel, usablePerks, usedItems, Use,
  Vehicle, vehicleRecords, yuan,
} from "../common/model"
import { StoreActions } from "./benefit_parts"
import { PerkPick } from "./benefit_pick"
import { FieldRow } from "./components"
import { MaintenanceItems } from "./maintenance_items"
import { serviceDay, SettlementSection, SourceRow } from "./service_parts"
import { StorePicker } from "./store_picker"

/** 分段最多几段：iPhone 上不超过 5 段、各段文字长短相近（HIG · Segmented controls）；类别名长短不一，4 段为止 */
const MAX_SEGMENTS = 4
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * maintenance：维修保养、填了项目时的「保养」一组，其他情况 null（保存时删掉这笔费用原来的保养记录）。
 * others：从养修填写时另记的工单（关掉的 expense 为 null）
 */
export type ExpenseFormResult = {
  expense: ExpenseData; uses: Use[]; store: Store | null; maintenance: MaintenanceInput | null
  others?: Array<{ ro_no: string; expense: ExpenseData | null; uses: Use[] }>
}

/**
 * 从养修填写（draft：新记）或编辑关联了养修的费用（2.1 设计第 8 节，画布 YsImport、YsSplit）：上面一行写来源，金额一栏叫「实付」，
 * 用了的权益不从金额里减，沃尔沃结算只读；新记时还有另记的工单
 */
export type ServiceForm = {
  title: string
  arrive: number
  dealer: string
  /** 这次进店的工单张数 */
  ticketCount: number
  /** 这笔费用对应的工单 */
  tickets: ServiceTicket[]
  draft: ServiceDraft | null
  /** 经销商的坐标（WGS-84）：还没找到门店时，选择门店的「附近」按它 */
  dealerPoint: [number, number] | null
  /** 项目页：项目来自哪个工时、写进备注的检查和问题、候选（沃尔沃的叫法） */
  sources: Record<string, string>
  notes: string[]
  vocabulary: string[] | null
}

const itemsText = (items: string[]) => (items.length <= 2 ? items.join("、") : `${items[0]} 等 ${items.length} 项`)
const usesSig = (list: Use[]) => list.map(u => `${u.perk_id}:${u.used}`).sort().join("|")

/** 另记一笔的工单（从养修填写时） */
type OtherState = { on: boolean; amount: string; uses: Use[] }

export function ExpenseForm({ getData, vehicle, record, maintenance, odometer: defaultOdometer, initialCategory, preset, stores, service = null }: {
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
  /** 从养修填写，或编辑关联了养修的费用；平时 null */
  service?: ServiceForm | null
}) {
  const dismiss = Navigation.useDismiss()
  const data = getData()
  const book = perkBook(data.ledger)
  const records = vehicleRecords(data, vehicle)
  const categories = formCategories(categoriesFor(data), record?.category_id ?? null)
  // 关联了养修：金额就是实付，用了的权益不从金额里减（2.1 设计第 12 节）
  const linked = !!service
  const draft = service?.draft ?? null

  // 打开时的内容：门店取 store_id，用过的权益按这笔费用的 id 找，金额加回抵扣（存的是实付；关联了养修的不加回）
  const [opened] = useState(() => {
    if (!record) {
      if (draft) return { body: draft.main.remark, store: draft.store, uses: draft.main.uses, amount: draft.main.amount }
      return { body: "", store: preset?.store ?? lastStoreFor(records, initialCategory, data.ledger.stores), uses: preset ? [preset.use] : [], amount: null as number | null }
    }
    const uses: Use[] = expenseUses(book, vehicle.id, record.id).flatMap(u => {
      const p = book.perks.find(x => x.id === u.perk_id)
      return p ? [{ perk_id: u.perk_id, used: u.used, deduct: deductOf(p, u.used) }] : []
    })
    const amount = linked ? record.amount : round2(record.amount + uses.reduce((t, u) => t + u.deduct, 0))
    const store = record.store_id ? data.ledger.stores.find(s => s.id === record.store_id) ?? null : null
    return { body: maintenance ? maintenance.remark : record.remark, store, uses, amount }
  })
  const [ts, setTs] = useState(record?.ts ?? draft?.main.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? (draft ? MAINTENANCE_CATEGORY : initialCategory))
  const [amount, setAmount] = useState(opened.amount != null ? numText(opened.amount) : "")
  const [remark, setRemark] = useState(opened.body)
  const [store, setStore] = useState<Store | null>(opened.store)
  const [uses, setUses] = useState<Use[]>(opened.uses)
  // 跟着金额走的储值：「用于记费用」预选的，和在使用权益里新勾上、还没手动改过的（关联了养修的不跟着金额走）
  const [follow, setFollow] = useState<string[]>(() => (preset ? [preset.use.perk_id] : []))
  const openedAmount = useRef(amount)
  const draftOdometer = draft?.main.odometer ?? null
  const openedOdometer = maintenance ? String(maintenance.odometer) : draftOdometer != null ? String(draftOdometer) : draft ? "" : defaultOdometer != null ? String(Math.floor(defaultOdometer)) : ""
  const [odometer, setOdometer] = useState(openedOdometer)
  const [items, setItems] = useState<string[]>(maintenance?.items ?? draft?.main.items.map(i => i.name) ?? [])
  const [notes, setNotes] = useState<string[]>(service?.notes ?? [])
  const [others, setOthers] = useState<OtherState[]>(() => (draft ? draft.others.map(o => ({ on: true, amount: o.amount != null ? numText(o.amount) : "", uses: o.uses })) : []))
  const locked = !!maintenance || !!draft
  const isMaint = category === MAINTENANCE_CATEGORY
  const used = service?.vocabulary ?? usedItems(data.ledger.records, vehicle.id)

  const usable = usablePerks(book, vehicle.id, ts, record?.id ?? null)
  const value = keptNumber(amount, openedAmount.current, opened.amount ?? undefined)
  // 过期的卡（改了日期）不算；跟着金额走的储值按金额重新分配
  const active = followAmount(uses.filter(u => usable.some(x => x.perk.id === u.perk_id)), linked ? [] : follow, usable, value)
  const deduct = round2(active.reduce((t, u) => t + u.deduct, 0))
  const paid = value == null ? null : linked ? value : round2(value - deduct)
  const usesText = (list: Use[]) => list.map(u => `${u.perk_id}:${u.used}:${u.deduct}`).sort().join("|")
  // 按工单先勾好、还没改过的标橙（2.1 设计第 12 节）；按经销商找到、还没换过的门店标橙（第 10 节）
  const usesSuggested = !!draft && active.length > 0 && usesSig(active) === usesSig(draft.main.uses)
  const storeSuggested = !!draft && draft.storePending && !!store && store.id === draft.store?.id

  // 有改动时禁止下滑关闭（从养修填写的一打开就算：内容都是填好的）
  const dirty = record
    ? ts !== record.ts || category !== record.category_id || paid !== record.amount || remark !== opened.body
      || (store?.id ?? null) !== (opened.store?.id ?? null) || usesText(active) !== usesText(opened.uses)
      || odometer !== openedOdometer || items.join("\n") !== (maintenance?.items ?? []).join("\n")
    : !!(draft || amount || remark.trim() || active.length || items.length)

  function pickChanged(next: Use[], manual: string | null) {
    const added = next.filter(u => !uses.some(x => x.perk_id === u.perk_id)).map(u => u.perk_id)
    setFollow([...follow.filter(id => id !== manual && next.some(u => u.perk_id === id)), ...added.filter(id => usable.find(x => x.perk.id === id)?.perk.kind === "balance")])
    setUses(next)
  }

  function setOther(i: number, patch: Partial<OtherState>) {
    setOthers(others.map((o, j) => (j === i ? { ...o, ...patch } : o)))
  }

  /** 项目页里把一条写进备注的检查改成项目：从「写进备注」里去掉，也从备注里去掉 */
  function noteToItem(note: string) {
    setNotes(notes.filter(n => n !== note))
    setRemark(remark.split("；").filter(x => x.trim() !== note).join("；"))
  }

  async function save() {
    // 编辑记录但什么都没改：直接关闭，不写数据
    if (record && !dirty) return dismiss(null)
    const errors = checkExpense(value).map(e => (linked ? e.replace("金额", "实付") : e))
    if (!linked && !errors.length && paid != null && paid < 0) errors.push(`权益抵扣合计（${yuan(deduct)}）比金额多，请在「使用权益」里改小。`)
    const odo = odometer.trim() ? Number(odometer.replace(/[,\s]/g, "")) : 0
    if (isMaint && items.length && !(Number.isFinite(odo) && odo >= 0)) errors.push("里程要填数字（公里）。")
    if (draft) {
      draft.others.forEach((o, i) => {
        if (!others[i].on) return
        const e = checkExpense(parseNum(others[i].amount))
        if (e.length) errors.push(`另记的「${ticketLabel(o.ticket)}」（${serviceDay(o.ts)} 开单）：${e[0].replace("金额", "实付")}`)
      })
    }
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
      ...(draft ? {
        others: draft.others.map((o, i) => ({
          ro_no: o.ticket.ro_no,
          expense: others[i].on ? { ts: o.ts, category_id: MAINTENANCE_CATEGORY, amount: parseNum(others[i].amount) as number, remark: o.remark } : null,
          uses: others[i].on ? others[i].uses.filter(u => usablePerks(book, vehicle.id, o.ts, null).some(x => x.perk.id === u.perk_id)) : [],
        })),
      } : {}),
    }
    dismiss(result)
  }

  const options = categories.map(c => <Text key={String(c.id)} tag={c.id}>{c.name}</Text>)
  const lockNote = draft ? "从养修填写，类别固定为维修保养。" : "这笔费用带保养记录，类别固定为维修保养。去掉全部项目保存后只留下费用，就能改类别。"
  const own = draft ? draft.main.own : null
  const usesValue = active.length ? `${active.length} 项${deduct ? ` · 抵扣 ${yuan(deduct)}` : ""}` : `可用 ${usable.length} 项`
  // 选择门店：从养修填写、还没找到门店时，「附近」按经销商的坐标（第 10 节）
  const dealerPoint = draft && !store && service?.dealerPoint ? service.dealerPoint : null
  const fieldsFooter = draft
    ? [
      own != null && own !== 0 ? `沃尔沃写的自付是 ${yuan(own)}。套餐、赠送付过的工单也照全额写自付，请填实际付的钱。` : "",
      storeSuggested || usesSuggested
        ? `标橙的请核对：${[storeSuggested ? "门店按经销商的位置或名称找到，保存后记下经销商代码" : "", usesSuggested ? "使用权益按工单先勾好了" : ""].filter(Boolean).join("；")}。`
        : "",
      `使用权益只列 ${serviceDay(ts)} 有效的权益，用了的不从实付里减。`,
    ].filter(Boolean).join("")
    : linked ? "金额是实付，用了的权益不从里面减。" : active.length ? "保存的金额是实付。导出到小熊油耗时，用了哪些权益和门店写在备注最后一行。" : ""
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
        ? <Section key="category" {...(locked ? { footer: <Text>{lockNote}</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="segmented" disabled={locked}
            listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
            {options}
          </Picker>
        </Section>
        : <Section key="category" header={<Text>类别</Text>} {...(locked ? { footer: <Text>{lockNote}</Text> } : {})}>
          <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="inline" labelsHidden disabled={locked}>
            {options}
          </Picker>
        </Section>}
      {service ? <Section key="source">
        <SourceRow title={service.title} arrive={service.arrive} tickets={service.ticketCount} dealer={service.dealer} />
      </Section> : null}
      <Section key="fields" {...(fieldsFooter ? { footer: <Text>{fieldsFooter}</Text> } : {})}>
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores}
          near={dealerPoint ? { point: dealerPoint, label: `${service?.dealer || "经销商"}附近` } : { vehicle, ts }} query="" />}>
          <HStack>
            <Text>门店</Text>
            <Spacer />
            <Text foregroundStyle={storeSuggested ? "systemOrange" : store ? "label" : "secondaryLabel"} lineLimit={1}>{store?.name ?? "不选"}</Text>
          </HStack>
        </NavigationLink>
        <FieldRow title={linked ? "实付" : "金额"} unit="元">
          <TextField title={linked ? "实付" : "金额"} value={amount} onChanged={setAmount} prompt={draft && draft.main.amount == null ? "必填" : "0.00"}
            keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {usable.length || active.length
          ? <NavigationLink destination={<PerkPick usable={usable} uses={active} amount={linked ? null : value} onChange={pickChanged}
            {...(service ? { refs: settlementRefs(service.tickets), linked: true } : {})} />}>
            <HStack>
              <Text>使用权益</Text>
              <Spacer />
              <Text foregroundStyle={usesSuggested ? "systemOrange" : "secondaryLabel"}>{usesValue}</Text>
            </HStack>
          </NavigationLink>
          : null}
        {active.length && !linked ? <HStack>
          <Text>实付</Text>
          <Spacer />
          <Text font="headline">{paid != null ? yuan(paid) : "—"}</Text>
        </HStack> : null}
      </Section>
      {isMaint && (!draft || draft.main.items.length || items.length) ? <Section key="maintenance" header={<Text>保养</Text>}
        footer={<Text>{draft ? "里程是工单上的到店里程，项目按沃尔沃工单上的叫法整理。" : locked ? "保养记录和这笔费用一起改。" : "里程默认取车况的里程表。填了项目才另存一条保养记录，费用页里和这笔费用合成一行；不填只记费用。"}</Text>}>
        <FieldRow title="里程" unit="km">
          <TextField title="里程" value={odometer} onChanged={setOdometer} prompt="0" keyboardType="numberPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <NavigationLink destination={<MaintenanceItems items={items} used={used} onChange={setItems}
          {...(service ? { sources: service.sources, notes, onNote: noteToItem } : {})} />}>
          <HStack>
            <Text>项目</Text>
            <Spacer />
            <Text foregroundStyle={items.length ? "label" : "secondaryLabel"} lineLimit={1}>{items.length ? itemsText(items) : "选择项目"}</Text>
          </HStack>
        </NavigationLink>
      </Section> : null}
      {service && service.tickets.length ? <SettlementSection
        title={service.tickets.every(t => t.type === "保养") ? "沃尔沃结算" : `沃尔沃结算 · ${ticketLabel(service.tickets[0])}`}
        tickets={service.tickets} note="只读，对照着勾使用权益。" /> : null}
      {draft && draft.others.length ? <Section key="others" header={<Text>同一次进店的其他工单</Text>}
        footer={<Text>每张工单各记一笔维修保养费用（时间是开单时间，备注写项目和优惠），各有自己的使用权益；关掉的不记。</Text>}>
        {draft.others.flatMap((o, i) => {
          const st = others[i]
          const usableO = usablePerks(book, vehicle.id, o.ts, null)
          const activeO = st.uses.filter(u => usableO.some(x => x.perk.id === u.perk_id))
          const suggested = activeO.length > 0 && usesSig(activeO) === usesSig(o.uses)
          const sub = [`${serviceDay(o.ts)} 开单`, o.ticket.projects.join("、"), ...o.ticket.prefs.map(p => `${p.name} −${yuan(p.amount)}`), `自付 ${yuan(o.ticket.own)}`]
            .filter(Boolean).join(" · ")
          const rows = [<Toggle key={`on-${i}`} value={st.on} onChanged={on => setOther(i, { on })}>
            <VStack alignment="leading" spacing={2}>
              <Text>{`${ticketLabel(o.ticket)} · 另记一笔`}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{sub}</Text>
            </VStack>
          </Toggle>]
          if (st.on) {
            rows.push(<FieldRow key={`amount-${i}`} title="实付" unit="元">
              <TextField title="实付" value={st.amount} onChanged={a => setOther(i, { amount: a })} prompt={o.amount == null ? "必填" : "0.00"}
                keyboardType="decimalPad" multilineTextAlignment="trailing" />
            </FieldRow>)
            if (usableO.length || activeO.length) {
              rows.push(<NavigationLink key={`uses-${i}`} destination={<PerkPick usable={usableO} uses={activeO} amount={null} refs={settlementRefs([o.ticket])} linked
                onChange={next => setOther(i, { uses: next })} />}>
                <HStack>
                  <Text>使用权益</Text>
                  <Spacer />
                  <Text foregroundStyle={suggested ? "systemOrange" : "secondaryLabel"}>{activeO.length ? `${activeO.length} 项` : `可用 ${usableO.length} 项`}</Text>
                </HStack>
              </NavigationLink>)
            }
          }
          return rows
        })}
      </Section> : null}
      <Section key="remark" header={<Text>备注</Text>}
        footer={<Text>{draft
          ? "工单里检查和客户反映的问题写在这里。里程和项目不用再写进备注，导出到小熊时油记会自动加上。"
          : locked
            ? "里程和项目不用再写进备注，导出到小熊时油记会自动加上。"
            : record ? "可以改类别。车险在「保险」页记。" : "默认是最近一笔费用的类别和这一类上次的门店；切换类别时，已填的内容保留。车险在「保险」页记。"}</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt={isMaint ? "选填" : "项目等"} axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
