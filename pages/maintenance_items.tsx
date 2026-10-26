// 保养项目（2.1 设计第 5 节，画布第十三轮 MtItems、第十五轮 YsItems，从记费用推入）：上面是已选的（红色按钮去掉，按加进来的先后排）；
// 下面输入项目名称，或从候选里点（手动记时是这辆车用过的项目，2.1.0-beta.5 起有养修记录时是沃尔沃的叫法，都按次数排）。不用小熊的项目表。
// 从养修填写时：已选的第二行写来自哪个工时；中间一组是写进备注的检查和问题，轻点「改成项目」加到已选、从备注里去掉。
import { Button, FlowLayout, HStack, Image, List, Section, Spacer, Text, TextField, useState, VStack } from "scripting"

export function MaintenanceItems({ items, used, onChange, sources = null, notes = null, onNote = null }: {
  items: string[]
  used: string[]
  onChange: (next: string[]) => void
  /** 从养修填写：项目来自哪个工时 */
  sources?: Record<string, string> | null
  /** 从养修填写：写进备注的检查和问题 */
  notes?: string[] | null
  /** 把一条改成项目（表单从备注里去掉它） */
  onNote?: ((note: string) => void) | null
}) {
  const [list, setList] = useState(items)
  const [input, setInput] = useState("")
  const [left, setLeft] = useState<string[]>(notes ?? [])

  function update(next: string[]) {
    setList(next)
    onChange(next)
  }

  function add(name: string) {
    const n = name.trim()
    if (n && !list.includes(n)) update([...list, n])
  }

  function addInput() {
    add(input)
    setInput("")
  }

  function noteToItem(note: string) {
    add(note)
    setLeft(left.filter(n => n !== note))
    if (onNote) onNote(note)
  }

  const rest = used.filter(n => !list.includes(n))
  const fromService = !!sources
  return <List navigationTitle="保养项目" navigationSubtitle={list.length ? `已选 ${list.length} 项` : "还没有选"}>
    <Section key="picked" header={<HStack><Text>已选</Text><Spacer /><Text>{list.length ? `${list.length} 项` : ""}</Text></HStack>}
      footer={<Text>{fromService ? "来自沃尔沃工单。左边的红色按钮去掉一项；项目按加进来的先后排。" : "左边的红色按钮去掉一项。项目按加进来的先后排。"}</Text>}>
      {list.length
        ? list.map(n => <HStack key={n}>
          <Button action={() => update(list.filter(x => x !== n))} buttonStyle="plain">
            <Image systemName="minus.circle.fill" foregroundStyle="systemRed" />
          </Button>
          {sources && sources[n]
            ? <VStack alignment="leading" spacing={2}>
              <Text>{n}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{`工单：${sources[n]}`}</Text>
            </VStack>
            : <Text>{n}</Text>}
        </HStack>)
        : <Text foregroundStyle="secondaryLabel">还没有选。在下面输入，或点候选的项目。</Text>}
    </Section>
    {left.length ? <Section key="notes" header={<Text>写进备注</Text>}
      footer={<Text>工单里检查和客户反映的问题不算项目，写进备注；轻点「改成项目」加到上面。提供照片、免费检查、车辆健康检查不记。</Text>}>
      {left.map(n => <HStack key={n}>
        <Image systemName="plus.circle.fill" foregroundStyle="systemGreen" />
        <Text>{n}</Text>
        <Spacer />
        <Button title="改成项目" action={() => noteToItem(n)} buttonStyle="borderless" />
      </HStack>)}
    </Section> : null}
    <Section key="add" header={<Text>添加项目</Text>}
      footer={<Text>{fromService
        ? `沃尔沃的叫法：从全部养修记录整理，加上记过的项目，按次数排${rest.length ? `（${rest.length} 个）` : ""}。导出到小熊时，项目用逗号连起来写进保养记录。`
        : rest.length
          ? `下面是用过的 ${rest.length} 个项目，按用过的次数排，轻点加进来。不用小熊的项目表；导出到小熊时，项目用逗号连起来写进保养记录。`
          : "不用小熊的项目表；导出到小熊时，项目用逗号连起来写进保养记录。"}</Text>}>
      <HStack>
        <TextField title="项目名称" value={input} onChanged={setInput} prompt="输入项目名称" onSubmit={addInput} />
        <Button title="添加" action={addInput} disabled={!input.trim()} buttonStyle="borderless" />
      </HStack>
      {rest.length
        ? <FlowLayout spacing={8}>
          {rest.map(n => <Button key={n} title={n} action={() => add(n)} buttonStyle="bordered" />)}
        </FlowLayout>
        : null}
    </Section>
  </List>
}
