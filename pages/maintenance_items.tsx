// 保养项目（2.1 设计第 5 节，画布第十三轮，从记费用推入）：上面是已选的（红色按钮去掉，按加进来的先后排）；
// 下面输入项目名称，或从这辆车用过的项目里点（按用过的次数排）。不用小熊的项目表。
import { Button, FlowLayout, HStack, Image, List, Section, Spacer, Text, TextField, useState } from "scripting"

export function MaintenanceItems({ items, used, onChange }: { items: string[]; used: string[]; onChange: (next: string[]) => void }) {
  const [list, setList] = useState(items)
  const [input, setInput] = useState("")

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

  const rest = used.filter(n => !list.includes(n))
  return <List navigationTitle="保养项目" navigationSubtitle={list.length ? `已选 ${list.length} 项` : "还没有选"}>
    <Section key="picked" header={<HStack><Text>已选</Text><Spacer /><Text>{list.length ? `${list.length} 项` : ""}</Text></HStack>}
      footer={<Text>左边的红色按钮去掉一项。项目按加进来的先后排。</Text>}>
      {list.length
        ? list.map(n => <HStack key={n}>
          <Button action={() => update(list.filter(x => x !== n))} buttonStyle="plain">
            <Image systemName="minus.circle.fill" foregroundStyle="systemRed" />
          </Button>
          <Text>{n}</Text>
        </HStack>)
        : <Text foregroundStyle="secondaryLabel">还没有选。在下面输入，或点用过的项目。</Text>}
    </Section>
    <Section key="add" header={<Text>添加项目</Text>}
      footer={<Text>{rest.length
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
