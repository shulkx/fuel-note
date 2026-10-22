// 记费用 / 编辑费用（设计文档 22.9 节，1.6.0-beta.4）：第一行是类别的分段（小熊的类别按 sortId，不含保险和交通规费；车险在「保险」页记），
// 下面的字段按规则变（1.6 每类都是 时间 · 金额 · 备注；1.7 加门店、使用权益，1.8 维修保养加里程、项目）。
// 超过 4 类时（以后在小熊里再建类别，或编辑一笔保险和交通规费的费用）改成第一组的单选列表。切换类别时已填的内容保留；编辑时也能改类别。
import { Button, DatePicker, Form, HStack, Navigation, NavigationStack, Picker, Rectangle, Section, Spacer, Text, TextField, useRef, useState } from "scripting"
import { AppData, categoriesFor, checkExpense, ExpenseData, formCategories, keptNumber, numText } from "../common/model"
import { FieldRow } from "./components"

/** 分段最多几段：iPhone 上不超过 5 段、各段文字长短相近（HIG · Segmented controls）；类别名长短不一，4 段为止 */
const MAX_SEGMENTS = 4

export function ExpenseForm({ data, record, initialCategory }: {
  data: AppData
  record: (ExpenseData & { id: string }) | null
  /** 新记时默认的类别：最近一笔不是保险和交通规费的费用的类别（common/expense_stats.ts 的 defaultCategory） */
  initialCategory: number
}) {
  const dismiss = Navigation.useDismiss()
  const categories = formCategories(categoriesFor(data), record?.category_id ?? null)
  const [ts, setTs] = useState(record?.ts ?? Date.now())
  const [category, setCategory] = useState<number>(record?.category_id ?? initialCategory)
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
      <Section key="fields">
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <FieldRow title="金额" unit="元">
          <TextField title="金额" value={amount} onChanged={setAmount} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>
      <Section key="remark" header={<Text>备注</Text>} footer={<Text>{record ? "可以改类别。" : "默认是最近一笔费用的类别；切换类别时，时间、金额、备注保留。"}车险在「保险」页记。</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="项目、门店等" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}
