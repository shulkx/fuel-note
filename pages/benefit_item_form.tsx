// 一张卡的字段（权益设计第 5、6 节，画布第九轮 R9Item）：名称；类型 储值 · 次数；储值的金额，次数的次数和单位（抵用券写「张」）；说明。不记价值。
// 两种外壳：ItemForm 在「添加权益」里推入，「完成」只是暂存（这一批还没保存）；ItemSheet 单独弹出（编辑一张卡、给一批添加一项），
// 多了有效期、门店，「保存」即写进账本。用过的卡不能改类型，总量不能少于已用；次数不填按 1。
import {
  Button, DatePicker, EnvironmentValuesReader, Form, HStack, Navigation, NavigationLink, NavigationStack, Picker, Section, Spacer, Text, TextField, Toggle, useState,
} from "scripting"
import { AppData, endOfDayBJ, newId, numText, parseNum, Perk, perkAmount, perkBook, PerkKind, perkErrors, perkStart, Store } from "../common/model"
import { StoreActions } from "./benefit_parts"
import { FieldRow } from "./components"
import { StorePicker } from "./store_picker"

type Draft = { name: string; kind: PerkKind; total: string; unit: string; note: string }

function draftOf(p: Perk | null): Draft {
  return {
    name: p?.name ?? "", kind: p?.kind ?? "count", total: p ? numText(p.total) : "", unit: p && p.kind === "count" ? p.unit : "次", note: p?.note ?? "",
  }
}

/** 草稿写回一张卡（base 提供 id、来自、有效期、门店等这一批的字段） */
function applyDraft(base: Perk, d: Draft): Perk {
  const n = parseNum(d.total)
  const total = d.kind === "balance" ? (n ?? 0) : n != null && n > 0 ? n : 1
  return {
    ...base, name: d.name.trim(), kind: d.kind, total,
    unit: d.kind === "balance" ? "元" : d.unit.trim() || "次", note: d.note.trim(),
  }
}

/** 名称、类型、数量、说明几组（两种外壳共用） */
function Fields({ d, set, used, noteFooter }: { d: Draft; set: (patch: Partial<Draft>) => void; used: { kind: PerkKind; amount: string } | null; noteFooter: string | null }) {
  return [
    <Section key="name" {...(used ? { footer: <Text>已经用过，不能更改类型。</Text> } : {})}>
      <TextField title="名称" value={d.name} onChanged={name => set({ name })} prompt="名称，例如「基础保养」" />
      <Picker title="类型" value={d.kind} onChanged={(v: string) => set({ kind: v as PerkKind })} pickerStyle="segmented" disabled={!!used}>
        <Text tag="balance">储值</Text>
        <Text tag="count">次数</Text>
      </Picker>
    </Section>,
    d.kind === "balance"
      ? <Section key="amount" footer={<Text>{[used ? `已用 ${used.amount}，金额不能少于已用。` : "", "维修保养券、保养基金这类按金额抵扣的。"].join("")}</Text>}>
        <FieldRow title="金额" unit="元"><TextField title="金额" value={d.total} onChanged={total => set({ total })} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" /></FieldRow>
      </Section>
      : <Section key="count" footer={<Text>{[used ? `已用 ${used.amount}，次数不能少于已用。` : "", "次数不填时为 1。抵用券、抵扣券也按次数记，单位写「张」；用的时候不抵钱，费用记实付。"].join("")}</Text>}>
        <FieldRow title="次数"><TextField title="次数" value={d.total} onChanged={total => set({ total })} prompt="1" keyboardType="numberPad" multilineTextAlignment="trailing" /></FieldRow>
        <HStack><Text>单位</Text><Spacer /><TextField title="单位" value={d.unit} onChanged={unit => set({ unit })} prompt="次" multilineTextAlignment="trailing" /></HStack>
      </Section>,
    <Section key="note" header={<Text>说明</Text>} {...(noteFooter ? { footer: <Text>{noteFooter}</Text> } : {})}>
      <TextField title="说明" value={d.note} onChanged={note => set({ note })} prompt="使用条件，例如「不与其他优惠叠加」" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
    </Section>,
  ]
}

/** 在「添加权益」里推入：编辑草稿里的一项，「完成」交回列表。item 为 null 时新加；base 是这一批的公共字段 */
export function ItemForm({ item, base, onSave }: { item: Perk | null; base: Perk; onSave: (p: Perk) => void }) {
  const [d, setD] = useState<Draft>(() => draftOf(item))
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })

  async function done(back: () => void) {
    const next = applyDraft(item ?? { ...base, id: newId("pk") }, d)
    const errors = perkErrors(next, null, 0)
    if (errors.length) {
      await Dialog.alert({ title: "还不能完成", message: errors.join("\n") })
      return
    }
    onSave(next)
    back()
  }

  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <Form
    navigationTitle={item ? "编辑一项" : "添加一项"}
    navigationBarTitleDisplayMode="inline"
    toolbar={{ confirmationAction: <Button title="完成" action={() => { void done(env.dismiss) }} /> }}
  >
    {Fields({ d, set, used: null, noteFooter: "有效期、门店和来自沿用这一批。" })}
  </Form>}</EnvironmentValuesReader>
}

export type ItemSheetResult = { perk: Perk }

/** 按字段名排好再比，字段的先后不算改动 */
const sortedJson = (o: object) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/**
 * 单独弹出：编辑一张卡（used 是已用的量），或给一批添加一项（perk 是新卡，带这一批的来自、有效期、门店）。
 * 「保存」把结果交回；没改时直接关闭
 */
export function ItemSheet({ getData, perk, isNew, used, stores }: { getData: () => AppData; perk: Perk; isNew: boolean; used: number; stores: StoreActions }) {
  const dismiss = Navigation.useDismiss()
  const [d, setD] = useState<Draft>(() => draftOf(isNew ? null : perk))
  // 有效期起（2.1.0-beta.5）：显示实际用的那一天；改了才写进卡里
  const [openedStart] = useState(() => perkStart(perkBook(getData().ledger), perk))
  const [start, setStart] = useState(openedStart)
  const [hasEnd, setHasEnd] = useState(perk.end_ts != null)
  const [end, setEnd] = useState(perk.end_ts ?? Date.now() + 365 * 86400e3)
  const [store, setStore] = useState<Store | null>(() => getData().ledger.stores.find(s => s.id === perk.store_id) ?? null)
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch })
  const { store_id: _old, ...rest } = perk
  const next = applyDraft({ ...rest, end_ts: hasEnd ? endOfDayBJ(end) : null, ...(store ? { store_id: store.id } : {}), ...(start !== openedStart ? { start_ts: start } : {}) }, d)
  const dirty = isNew || sortedJson(next) !== sortedJson(perk)

  async function save() {
    if (!dirty) return dismiss(null)
    const errors = perkErrors(next, isNew ? null : perk, used)
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    const result: ItemSheetResult = { perk: next }
    dismiss(result)
  }

  return <NavigationStack interactiveDismissDisabled={isNew ? !!d.name.trim() : dirty}>
    <Form
      navigationTitle={isNew ? "添加一项" : "编辑权益"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      {Fields({ d, set, used: !isNew && used > 0 ? { kind: perk.kind, amount: perkAmount(perk, used) } : null, noteFooter: null })}
      <Section key="batch" footer={<Text>{perk.insurance_id ? "改的只是这一项；整批的有效期、门店在这一批的「编辑」里改。" : "改的只是这一项；整批的来自、有效期、门店在这一批的「编辑」里改。"}</Text>}>
        <DatePicker title="有效期起" value={start} onChanged={setStart} displayedComponents={["date"]} />
        <Toggle title="有有效期" value={hasEnd} onChanged={setHasEnd} />
        {hasEnd ? <DatePicker title="有效期至" value={end} onChanged={setEnd} displayedComponents={["date"]} /> : null}
        <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores} near={null} query="" />}>
          <HStack><Text>门店</Text><Spacer /><Text foregroundStyle={store ? "label" : "secondaryLabel"}>{store?.name ?? "不填"}</Text></HStack>
        </NavigationLink>
        <HStack><Text>来自</Text><Spacer /><Text foregroundStyle="secondaryLabel">{perk.source}</Text></HStack>
      </Section>
    </Form>
  </NavigationStack>
}
