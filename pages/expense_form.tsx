// 记费用 / 编辑费用
import { Button, DatePicker, Form, Navigation, NavigationStack, Picker, Section, Text, TextField, useState } from "scripting"
import { AppData, categoriesFor, checkExpense, ExpenseData, numText, parseNum } from "../common/model"
import { FieldRow } from "./components"

export function ExpenseForm({ data, record }: { data: AppData; record: (ExpenseData & { id: string }) | null }) {
  const dismiss = Navigation.useDismiss()
  const categories = categoriesFor(data)
  const [ts, setTs] = useState(record?.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? categories[0]?.id ?? 100003)
  const [amount, setAmount] = useState(record ? numText(record.amount) : "")
  const [remark, setRemark] = useState(record?.remark ?? "")

  async function save() {
    const value = parseNum(amount)
    const errors = checkExpense(value)
    if (errors.length) {
      await Dialog.alert({ title: "还不能保存", message: errors.join("\n") })
      return
    }
    const result: ExpenseData = { ts, category_id: category, amount: value as number, remark: remark.trim() }
    dismiss(result)
  }

  return <NavigationStack>
    <Form
      navigationTitle={record ? "编辑费用" : "记费用"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
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
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="例如：高速费、洗车" axis="vertical" />
      </Section>
    </Form>
  </NavigationStack>
}
