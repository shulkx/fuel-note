// 编辑这一批（权益设计第 4 节）：来自的名称（车险赠送固定是「2026 车险」，不能改）、有效期、门店、原文，保存时写进这一批的每一张卡。
// 一批不是要维护的对象，这里只是一次改几张卡的快捷方式；没有改动时「保存」直接关闭。
import { Button, DatePicker, Form, HStack, Navigation, NavigationLink, NavigationStack, Section, Spacer, Text, TextField, Toggle, useState } from "scripting"
import { AppData, BatchFields, endOfDayBJ, Store } from "../common/model"
import { StoreActions } from "./benefit_parts"
import { StorePicker } from "./store_picker"

export type BatchEditResult = { fields: BatchFields; store: Store | null }

export function BatchEditSheet({ getData, title, insurance, end, storeName, raw, count, stores }: {
  getData: () => AppData
  title: string
  /** 来自某一年车险：名称不能改 */
  insurance: boolean
  end: number | null
  /** 这一批共同的门店；不一样时为空 */
  storeName: string
  raw: string
  count: number
  stores: StoreActions
}) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(title)
  const [hasEnd, setHasEnd] = useState(end != null)
  const [endTs, setEndTs] = useState(end ?? Date.now() + 365 * 86400e3)
  const [store, setStore] = useState<Store | null>(() => (storeName ? (getData().ledger.stores ?? []).find(s => s.name === storeName) ?? { id: "", name: storeName, full_name: "", address: "", phone: "", lng: null, lat: null, source: "manual" } : null))
  const [text, setText] = useState(raw)

  const nextEnd = hasEnd ? endOfDayBJ(endTs) : null
  const fields: BatchFields = {
    ...(!insurance && name.trim() !== title ? { source: name.trim() } : {}),
    ...(nextEnd !== end ? { end_ts: nextEnd } : {}),
    ...((store?.name ?? "") !== storeName ? { store: store?.name ?? "" } : {}),
    ...(text.trim() !== raw.trim() ? { raw: text.trim() } : {}),
  }
  const dirty = Object.keys(fields).length > 0

  async function save() {
    if (!dirty) return dismiss(null)
    if (!insurance && !name.trim()) {
      await Dialog.alert({ title: "还不能保存", message: "请填名称。" })
      return
    }
    const result: BatchEditResult = { fields, store }
    dismiss(result)
  }

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle="编辑这一批"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      <Section key="info" footer={<Text>{`改完写进这一批的每一项（${count} 项）。${insurance ? "车险赠送的名称跟着保险的年份，不能更改。" : ""}`}</Text>}>
        {insurance
          ? <HStack><Text>来自</Text><Spacer /><Text foregroundStyle="secondaryLabel">{title}</Text></HStack>
          : <TextField title="名称" value={name} onChanged={setName} prompt="名称" />}
        <Toggle title="有有效期" value={hasEnd} onChanged={setHasEnd} />
        {hasEnd ? <DatePicker title="有效期至" value={endTs} onChanged={setEndTs} displayedComponents={["date"]} /> : null}
        <NavigationLink destination={<StorePicker getData={getData} selected={store} onPick={setStore} stores={stores} />}>
          <HStack><Text>门店</Text><Spacer /><Text foregroundStyle={store ? "label" : "secondaryLabel"}>{store?.name ?? "不填"}</Text></HStack>
        </NavigationLink>
      </Section>
      <Section key="raw" header={<Text>原文</Text>} footer={<Text>销售发来的文字，存在这一批里备查。</Text>}>
        <TextField title="原文" value={text} onChanged={setText} prompt="粘贴原文（选填）" axis="vertical" lineLimit={{ min: 2, max: 8 }} />
      </Section>
    </Form>
  </NavigationStack>
}
