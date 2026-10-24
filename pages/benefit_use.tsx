// 记一次使用 / 修改这次使用（权益设计第 4 节）：半屏，从权益详情打开。不花钱的使用（车内杀菌、空调清洗）在这里记，不记费用；
// 有费用时用权益详情里的「用于记费用」。修改时沿用原来的 id，剩余加回这一次的用量；没改时「保存」直接关闭。
import { Button, DatePicker, Form, Navigation, NavigationStack, Section, Stepper, Text, TextField, useState } from "scripting"
import { AppData, newId, numText, parseNum, Perk, perkAmount, perkBook, PerkUse, remaining } from "../common/model"
import { FieldRow } from "./components"

export function UseSheet({ getData, perk, use }: { getData: () => AppData; perk: Perk; use: PerkUse | null }) {
  const dismiss = Navigation.useDismiss()
  const left = Math.round((remaining(perkBook(getData().ledger), perk) + (use?.used ?? 0)) * 100) / 100
  const [ts, setTs] = useState(use?.ts ?? Date.now())
  const [count, setCount] = useState(use?.used ?? Math.min(1, left))
  const [amount, setAmount] = useState(use ? numText(use.used) : "")
  const [note, setNote] = useState(use?.note ?? "")
  const used = perk.kind === "balance" ? parseNum(amount) : count
  const dirty = !use || ts !== use.ts || used !== use.used || note.trim() !== use.note

  async function save() {
    if (use && !dirty) return dismiss(null)
    if (used == null || !(used > 0)) {
      await Dialog.alert({ title: "还不能保存", message: perk.kind === "balance" ? "请填用了多少钱。" : "用量要大于 0。" })
      return
    }
    if (used > left + 0.005) {
      await Dialog.alert({ title: "还不能保存", message: `只剩 ${perkAmount(perk, left)}。` })
      return
    }
    const next: PerkUse = { id: use?.id ?? newId("pu"), perk_id: perk.id, ts, used, expense_id: null, note: note.trim() }
    dismiss(next)
  }

  return <NavigationStack presentationDetents={["medium", "large"]} presentationDragIndicator="visible">
    <Form
      navigationTitle={use ? "编辑这次使用" : "记一次使用"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
      }}
    >
      <Section key="use" header={<Text>{perk.name}</Text>} footer={<Text>不花钱的使用（车内杀菌、空调清洗）在这里记，不另记费用；有费用时用权益详情里的「用于记费用」。</Text>}>
        <DatePicker title="日期" value={ts} onChanged={setTs} displayedComponents={["date"]} />
        {perk.kind === "balance"
          ? <FieldRow title={`用量（剩 ${perkAmount(perk, left)}）`} unit="元">
            <TextField title="用量" value={amount} onChanged={setAmount} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
          </FieldRow>
          : <Stepper
            title={`用量 ${count} ${perk.unit}（剩 ${left} ${perk.unit}）`}
            onIncrement={() => setCount(Math.min(left, count + 1))}
            onDecrement={() => setCount(Math.max(1, count - 1))}
          />}
        <TextField title="备注" value={note} onChanged={setNote} prompt="备注（选填）" />
      </Section>
    </Form>
  </NavigationStack>
}
