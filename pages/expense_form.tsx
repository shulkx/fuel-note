// 记费用 / 编辑费用
import { Button, DatePicker, Form, HStack, Navigation, NavigationStack, Picker, Section, Spacer, Text, TextField, useRef, useState } from "scripting"
import { AppData, categoriesFor, checkExpense, ExpenseData, keptNumber, numText } from "../common/model"
import { FieldRow } from "./components"

export function ExpenseForm({ data, record }: { data: AppData; record: (ExpenseData & { id: string }) | null }) {
  const dismiss = Navigation.useDismiss()
  const categories = categoriesFor(data)
  const [ts, setTs] = useState(record?.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? categories[0]?.id ?? 100003)
  const [amount, setAmount] = useState(record ? numText(record.amount) : "")
  const [remark, setRemark] = useState(record?.remark ?? "")

  // 打开时的内容：编辑记录时，与它相同的字段用原值、不算改动（金额输入框只显示两位小数）
  const opened = useRef({ amount, remark })
  const value = keptNumber(amount, opened.current.amount, record?.amount)
  const remarkValue = record && remark === opened.current.remark ? record.remark : remark.trim()

  // 有改动时禁止下滑关闭
  const dirty = record
    ? ts !== record.ts || category !== record.category_id || value !== record.amount || remarkValue !== record.remark
    : !!(amount || remark.trim())

  async function save() {
    // 编辑记录但什么都没改：直接关闭，不写数据
    if (record && !dirty) return dismiss(null)
    const errors = checkExpense(value)
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    const result: ExpenseData = { ts, category_id: category, amount: value as number, remark: remarkValue }
    dismiss(result)
  }

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
      <Section>
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <Picker title="类别" value={category} onChanged={(v: number) => setCategory(v)} pickerStyle="menu">
          {categories.map(c => <Text tag={c.id}>{c.name}</Text>)}
        </Picker>
        <FieldRow title="金额" unit="元">
          <TextField title="金额" value={amount} onChanged={setAmount} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>
      <Section title="备注">
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="例如：高速费、洗车" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
