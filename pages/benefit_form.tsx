// 添加权益（权益设计第 5 节，画布第九轮 R9Add、R9Recognize）：一批，顶部分段 车险赠送 · 保养套餐 · 其他。
// 车险赠送选哪一年的车险，来自写「2026 车险」，有效期默认取保险到期日；套餐填名称、有效期、价格和购买日期，「同时记一笔费用」默认打开（只记这一次）；
// 其他填名称和有效期。「识别」一组：粘贴文字或选截图，用设置里选的大模型整理成几项，默认勾选，保单自带的服务和已有的同名默认不勾；推断出的门店标橙。
// 保存后是几张独立的卡（来自、有效期、门店填进每一张），不和来源保持关联；保存前查同名，有内容时取消先确认。
import {
  Button, DatePicker, Form, HStack, Image, Navigation, NavigationLink, NavigationStack, Picker, ProgressView, Rectangle, Section, Spacer, Text, TextField, Toggle,
  useEffect, useState, VStack,
} from "scripting"
import {
  AppData, batchPerks, bjDayStart, currentInsurance, endOfDayBJ, giftName, insuranceDefaults, insuranceYears, kindText, 
  newId, normalizeName, numText, parseNum, Perk, perkAmount, perkBook, PerkOrigin, PerkScan, policyDate, PurchaseExpense, recognizePerks, ScanPick,
  scanPicks, Store, Vehicle, yearInsurer, yearOf, yearPeriod, yuan,
} from "../common/model"
import { EXPIRING, StoreActions } from "./benefit_parts"
import { ItemForm } from "./benefit_item_form"
import { FieldRow } from "./components"
import { StorePicker } from "./store_picker"

export type AddResult = { perks: Perk[]; purchase: PurchaseExpense | null }

const ORIGIN_TITLES: Record<PerkOrigin, string> = { insurance: "车险赠送", package: "保养套餐", other: "其他" }
const DAY = 86400e3

/** 草稿里的一项：识别出的带勾选和说明 */
type Draft = Perk & { on?: boolean; warn?: string }

export function AddPerksForm({ getData, vehicle, presetYear, stores, scanned }: {
  getData: () => AppData
  vehicle: Vehicle
  /** 从保单详情「赠送」一行打开：预选这一年的车险 */
  presetYear: string | null
  stores: StoreActions
  /** 已有的识别结果和原文：打开时直接显示识别后的样子（FuelNote Check 截图用） */
  scanned?: { raw: string; scan: PerkScan; summary: string }
}) {
  const dismiss = Navigation.useDismiss()
  const data = getData()
  const book = perkBook(data.ledger)
  const now = Date.now()
  const years = insuranceYears(data.ledger.insurance, vehicle.id)
  const candidates = data.ledger.stores
  const [origin, setOrigin] = useState<PerkOrigin>(presetYear || years.length ? "insurance" : "package")
  const [yearId, setYearId] = useState<string>(presetYear ?? (currentInsurance(years, now) ?? years[0])?.id ?? "")
  const year = years.find(y => y.id === yearId) ?? null
  const [name, setName] = useState("")
  const [hasEnd, setHasEnd] = useState(true)
  const [end, setEnd] = useState<number | null>(null)
  const [store, setStore] = useState<Store | null>(null)
  // 识别出的店名不在我的门店里时先记下名字，轻点门店时在高德里搜（2.1 设计第 10 节）；不先建一家没定位的门店
  const [pendingStore, setPendingStore] = useState("")
  const [price, setPrice] = useState("")
  const [bought, setBought] = useState(now)
  const [withExpense, setWithExpense] = useState(true)
  const [mode, setMode] = useState<"text" | "image">("text")
  const [raw, setRaw] = useState(scanned?.raw ?? "")
  const [images, setImages] = useState<UIImage[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)
  const [items, setItems] = useState<Draft[]>([])
  const [editing, setEditing] = useState<number | null>(null)

  // 有效期：车险赠送默认取保险到期日，其余默认一年后；用户改过就用改过的
  const defaultEnd = origin === "insurance" ? (year ? yearPeriod(year)?.end ?? now : now) : now + 365 * DAY
  const endValue = end ?? defaultEnd
  const source = origin === "insurance" ? (year ? insuranceDefaults(year).source : "") : name.trim()
  const key = origin === "insurance" ? `ins:${yearId}` : `src:${source}`
  const existing = source ? batchPerks(book, vehicle.id, key) : []
  const picked = items.filter(d => d.on !== false)
  const picking = items.some(d => d.on !== undefined)
  const dirty = !!(items.length || raw.trim() || images.length || name.trim() || price)

  /** 草稿的公共字段：来自、有效期、门店、原文 */
  function base(): Perk {
    return {
      id: newId("pk"), vehicle_id: vehicle.id, name: "", kind: "count", total: 1, unit: "次",
      end_ts: origin === "insurance" || hasEnd ? endOfDayBJ(endValue) : null, ...(store ? { store_id: store.id } : {}), source,
      insurance_id: origin === "insurance" ? yearId || null : null, origin, raw: mode === "text" ? raw.trim() : "", note: "", created_ts: now,
    }
  }

  function changeOrigin(o: PerkOrigin) {
    setOrigin(o)
    setEnd(null)
  }

  async function pickImages() {
    const list = await Photos.pickPhotos(3)
    if (list && list.length) setImages(list)
  }

  async function recognize() {
    setBusy(true)
    setStatus(null)
    const r = await recognizePerks({ text: mode === "text" ? raw : null, images: mode === "image" ? images : [] }, origin, data.ledger.settings)
    setBusy(false)
    if (!r.scan) {
      setStatus({ text: r.error ?? "没有认出权益", error: true })
      return
    }
    applyScan(r.scan, r.summary)
  }

  /** 识别结果变成草稿（默认勾选，保单自带的服务和已有的同名不勾）；名称、售价、有效期、门店没填时用识别出的 */
  function applyScan(scan: PerkScan, summary: string) {
    const picks: ScanPick[] = scanPicks(scan, existing.map(p => p.name))
    const b = base()
    setItems([...items.filter(d => d.on === undefined), ...picks.map(pk => ({
      ...b, id: newId("pk"), name: pk.name, kind: pk.kind, total: pk.total, unit: pk.unit, note: pk.note, on: pk.on, warn: pk.warn,
    }))])
    if (origin !== "insurance") {
      if (scan.source && !name.trim()) setName(scan.source)
      if (origin === "package" && scan.price != null && !price.trim()) setPrice(numText(scan.price))
      if (scan.end_date) {
        const [y, m, d] = scan.end_date.split("-").map(Number)
        setHasEnd(true)
        setEnd(bjDayStart(y, m, d))
      }
    }
    if (!store && scan.store) {
      const n = normalizeName(scan.store)
      const named = candidates.find(s => normalizeName(s.name) === n || normalizeName(s.full_name) === n) ?? null
      if (named) setStore(named)
      else setPendingStore(scan.store)
    }
    setStatus({ text: summary, error: false })
  }

  useEffect(() => {
    if (scanned) applyScan(scanned.scan, scanned.summary)
  }, [])

  function putItem(p: Perk, index: number | null) {
    if (index == null) setItems([...items, p])
    // 识别出的一项改过以后算确认过：勾上、去掉说明；手动加的保持手动加的样子
    else setItems(items.map((d, i) => (i === index ? (d.on === undefined ? p : { ...p, on: true, warn: "" }) : d)))
  }

  async function cancel() {
    if (!dirty) return dismiss(null)
    const n = picked.length
    const choice = await Dialog.actionSheet({ title: n ? `放弃添加的 ${n} 项？` : "放弃这次添加？", actions: [{ label: "放弃", destructive: true }] })
    if (choice === 0) dismiss(null)
  }

  async function save() {
    const errors: string[] = []
    if (origin === "insurance" && !year) errors.push("请选择哪一年的车险。")
    if (origin !== "insurance" && !name.trim()) errors.push("请填名称。")
    const p = parseNum(price)
    if (origin === "package" && withExpense && !(p != null && p > 0)) errors.push("请填套餐的价格，或关掉「同时记一笔费用」。")
    if (!picked.length) errors.push(picking ? "请至少勾选一项。" : "请至少添加一项。")
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    const dup = picked.filter(d => existing.some(e => normalizeName(e.name) === normalizeName(d.name))).map(d => `「${d.name}」`)
    if (dup.length) {
      const choice = await Dialog.actionSheet({ title: "可能重复", message: `「${source}」里已有${dup.join("、")}。`, actions: [{ label: "仍然添加" }] })
      if (choice !== 0) return
    }
    const b = base()
    // 套餐的有效期从购买日期起（2.1.0-beta.5）；车险赠送跟着保险的购买日，其他从今天起（不写，取 created_ts）
    const perks: Perk[] = picked.map(({ on, warn, ...d }) => ({
      ...d, end_ts: b.end_ts, ...(b.store_id ? { store_id: b.store_id } : {}), ...(origin === "package" ? { start_ts: bought } : {}),
      source: b.source, insurance_id: b.insurance_id, origin, raw: b.raw, created_ts: now,
    }))
    const purchase: PurchaseExpense | null = origin === "package" && withExpense && p != null && p > 0
      ? { amount: p, ts: bought, remark: name.trim() } : null
    const result: AddResult = { perks, purchase }
    dismiss(result)
  }

  const editItem = editing != null ? items[editing] : null

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle="添加权益"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => { void cancel() }} />,
        confirmationAction: <Button title={picked.length ? `添加 ${picked.length} 项` : "添加"} action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
      navigationDestination={{
        isPresented: editing != null,
        onChanged: shown => { if (!shown) setEditing(null) },
        content: editItem ? <ItemForm item={editItem} base={base()} onSave={p => putItem(p, editing)} /> : <Text>权益</Text>,
      }}
    >
      <Section key="origin">
        <Picker title="种类" value={origin} onChanged={(v: string) => changeOrigin(v as PerkOrigin)} pickerStyle="segmented"
          listRowInsets={0} listRowBackground={<Rectangle fill="rgba(0,0,0,0)" />}>
          {(["insurance", "package", "other"] as const).map(k => <Text key={k} tag={k}>{ORIGIN_TITLES[k]}</Text>)}
        </Picker>
      </Section>

      {origin === "insurance"
        ? <Section key="insurance" footer={<Text>{existing.length
          ? `「${source}」已有 ${existing.length} 项，添加的也放进这一组。`
          : pendingStore ? `识别出的门店是「${pendingStore}」，我的门店里还没有。轻点门店在高德里选这家店，搜索框里已经填好店名。` : "有效期默认取这一年的保险到期日，门店会填进每一项。"}</Text>}>
          {years.length
            ? <Picker title="车险" value={yearId} onChanged={(v: string) => { setYearId(v); setEnd(null) }} pickerStyle="menu">
              {years.map(y => <Text key={y.id} tag={y.id}>{`${yearOf(y)} · ${yearInsurer(y)}`}</Text>)}
            </Picker>
            : <Text foregroundStyle="secondaryLabel">还没有记保险，先在「保险」页记保险。</Text>}
          <DatePicker title="有效期至" value={endValue} onChanged={v => setEnd(v)} displayedComponents={["date"]} />
          <StoreRow getData={getData} store={store} pending={pendingStore} setStore={s => { setStore(s); setPendingStore("") }} stores={stores} />
          {existing.length ? <VStack alignment="leading" spacing={2}>
            <HStack><Text>已有</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${existing.length} 项`}</Text></HStack>
            <Text font="caption" foregroundStyle="secondaryLabel">{existing.map(giftName).join(" · ")}</Text>
          </VStack> : null}
        </Section>
        : <Section key="info" footer={<Text>{pendingStore ? `识别出的门店是「${pendingStore}」，我的门店里还没有。轻点门店在高德里选这家店，搜索框里已经填好店名。` : "名称就是这一批的「来自」。有效期和门店会填进每一项，之后可以分别修改。"}</Text>}>
          <TextField title="名称" value={name} onChanged={setName} prompt={origin === "package" ? "套餐名称" : "名称，例如「洗车卡」"} />
          <Toggle title="有有效期" value={hasEnd} onChanged={setHasEnd} />
          {hasEnd ? <DatePicker title="有效期至" value={endValue} onChanged={v => setEnd(v)} displayedComponents={["date"]} /> : null}
          <StoreRow getData={getData} store={store} pending={pendingStore} setStore={s => { setStore(s); setPendingStore("") }} stores={stores} />
        </Section>}

      {origin === "package" ? <Section key="price" footer={<Text>{withExpense
        ? `保存时记一笔维修保养费用${parseNum(price) ? ` ${yuan(parseNum(price)!)}` : ""}（${policyDate(bought)}）。只记这一次，之后费用和权益互不影响。`
        : "已经在费用里记过这一笔时关掉。"}</Text>}>
        <FieldRow title="价格" unit="元">
          <TextField title="价格" value={price} onChanged={setPrice} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <DatePicker title="购买日期" value={bought} onChanged={setBought} displayedComponents={["date"]} />
        <Toggle title="同时记一笔费用" value={withExpense} onChanged={setWithExpense} />
      </Section> : null}

      <Section key="recognize" header={<Text>识别</Text>}
        footer={<Text>{mode === "text" ? "文字发给「设置 › 识别方式」选的大模型，发送前去掉手机号、证件号、车牌和车架号；文字存进这一批的原文。" : "截图原样发给「设置 › 识别方式」选的大模型。"}</Text>}>
        <Picker title="识别" value={mode} onChanged={(v: string) => setMode(v as "text" | "image")} pickerStyle="segmented">
          <Text tag="text">文字</Text>
          <Text tag="image">截图</Text>
        </Picker>
        {mode === "text"
          ? <TextField title="原文" value={raw} onChanged={setRaw} prompt="粘贴销售发来的文字" axis="vertical" lineLimit={{ min: 2, max: 8 }} />
          : <Button action={() => { void pickImages() }}>
            <HStack>
              <Image systemName="photo.on.rectangle" />
              <Text>{images.length ? `已选 ${images.length} 张截图，轻点重选` : "选择截图"}</Text>
              <Spacer />
            </HStack>
          </Button>}
        {busy
          ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">识别中…</Text></HStack>
          : <Button title="识别" systemImage="sparkles" disabled={mode === "text" ? !raw.trim() : !images.length} action={() => { void recognize() }} />}
        {status ? <Text font="footnote" foregroundStyle={status.error ? EXPIRING : "secondaryLabel"}>{status.text}</Text> : null}
      </Section>

      <Section key="items" header={<HStack><Text>权益</Text><Spacer /><Text>{picking ? `勾选 ${picked.length} 项` : `${items.length} 项`}</Text></HStack>}
        footer={<Text>{picking ? "轻点勾选或取消；左滑修改或删除。勾选的保存为卡。" : "点一项可以修改，左滑删除。"}</Text>}>
        {items.map((d, i) => d.on === undefined
          ? <NavigationLink key={d.id} destination={<ItemForm item={d} base={base()} onSave={p => putItem(p, i)} />}
            trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setItems(items.filter((_, j) => j !== i))} />] }}>
            <VStack alignment="leading" spacing={1}>
              <Text>{d.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{`${kindText(d)} · 共 ${perkAmount(d, d.total)}`}</Text>
            </VStack>
          </NavigationLink>
          : <Button key={d.id} action={() => setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
            trailingSwipeActions={{
              allowsFullSwipe: false, actions: [
                <Button title="删除" systemImage="trash" role="destructive" action={() => setItems(items.filter((_, j) => j !== i))} />,
                <Button title="修改" systemImage="pencil" tint="systemBlue" action={() => setEditing(i)} />,
              ],
            }}>
            <HStack spacing={12} foregroundStyle="label">
              <Image systemName={d.on ? "checkmark.circle.fill" : "circle"} foregroundStyle={d.on ? "accentColor" : "tertiaryLabel"} font="title3" />
              <VStack alignment="leading" spacing={1}>
                <Text foregroundStyle={d.on ? "label" : "secondaryLabel"}>{d.name}</Text>
                <Text font="caption" foregroundStyle={d.warn ? EXPIRING : "secondaryLabel"}>{d.warn || `${kindText(d)} · 共 ${perkAmount(d, d.total)}`}</Text>
              </VStack>
              <Spacer />
            </HStack>
          </Button>)}
        <NavigationLink destination={<ItemForm item={null} base={base()} onSave={p => putItem(p, null)} />}>
          <Text foregroundStyle="accentColor">添加一项</Text>
        </NavigationLink>
      </Section>
    </Form>
  </NavigationStack>
}

/** 门店一行：识别出、还不是我的门店的店名标橙，轻点打开选择门店、搜索框里填好这个名字 */
function StoreRow({ getData, store, pending, setStore, stores }: {
  getData: () => AppData; store: Store | null; pending: string; setStore: (s: Store | null) => void; stores: StoreActions
}) {
  return <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores} near={null} query={store ? "" : pending} />}>
    <HStack>
      <Text>门店</Text>
      <Spacer />
      <Text foregroundStyle={store ? "label" : pending ? EXPIRING : "secondaryLabel"} lineLimit={1}>{store?.name ?? (pending || "不填")}</Text>
    </HStack>
  </NavigationLink>
}
