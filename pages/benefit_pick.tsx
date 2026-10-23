// 使用权益（权益设计第 4 节，画布第九轮 R9Use）：记费用里「使用权益」一行推入。列出所有还能用的卡，按来自分组，不按门店、类别筛选。
// 勾上储值时默认抵扣剩余和还没抵扣的金额中较小的，可以改；次数（含抵用券）只记用掉，用步进器，不抵钱。抵扣从这次的金额里减去，费用记实付。
import { Button, HStack, Image, List, Section, Spacer, Stepper, Text, TextField, useState, VStack } from "scripting"
import { deductOf, defaultUse, groupKey, kindText, money2, numText, parseNum, perkAmount, Usable, Use } from "../common/model"
import { IconTile, ORIGIN_COLORS, perkIcon } from "./benefit_parts"

export function PerkPick({ usable, uses, amount, onChange }: {
  usable: Usable[]
  uses: Use[]
  /** 这次的金额（还没填时 null）：储值默认抵扣不超过还没抵扣的部分 */
  amount: number | null
  /** manual：手动改了抵扣金额的那一张（之后不再跟着金额走）；勾上、取消、改次数时为 null */
  onChange: (uses: Use[], manual: string | null) => void
}) {
  const [picked, setPicked] = useState<Use[]>(uses)
  // 储值的抵扣金额输入框（按卡的 id）
  const [texts, setTexts] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const u of uses) out[u.perk_id] = numText(u.used)
    return out
  })

  function update(next: Use[], manual: string | null) {
    setPicked(next)
    onChange(next, manual)
  }

  function toggle(u: Usable) {
    if (picked.some(p => p.perk_id === u.perk.id)) return update(picked.filter(p => p.perk_id !== u.perk.id), null)
    const open = amount == null ? null : Math.max(0, amount - picked.reduce((t, p) => t + p.deduct, 0))
    const use = defaultUse(u.perk, u.left, open)
    if (u.perk.kind === "balance") setTexts({ ...texts, [u.perk.id]: numText(use.used) })
    update([...picked, use], null)
  }

  function setAmount(u: Usable, text: string) {
    setTexts({ ...texts, [u.perk.id]: text })
    const n = parseNum(text)
    const used = n == null ? 0 : Math.max(0, Math.min(n, u.left))
    update(picked.map(p => (p.perk_id === u.perk.id ? { ...p, used, deduct: deductOf(u.perk, used) } : p)), u.perk.id)
  }

  function setCount(u: Usable, used: number) {
    update(picked.map(p => (p.perk_id === u.perk.id ? { ...p, used, deduct: deductOf(u.perk, used) } : p)), null)
  }

  const groups: Array<{ key: string; title: string; items: Usable[] }> = []
  for (const u of usable) {
    const k = groupKey(u.perk)
    let g = groups.find(x => x.key === k)
    if (!g) { g = { key: k, title: u.perk.source, items: [] }; groups.push(g) }
    g.items.push(u)
  }
  const deduct = picked.reduce((t, p) => t + p.deduct, 0)

  return <List navigationTitle="使用权益" navigationBarTitleDisplayMode="inline">
    {groups.map(g => <Section key={g.key} header={<Text>{g.title}</Text>}>
      {g.items.flatMap(u => {
        const use = picked.find(p => p.perk_id === u.perk.id) ?? null
        const rows = [<Button key={u.perk.id} action={() => toggle(u)}>
          <HStack spacing={12} foregroundStyle="label">
            <Image systemName={use ? "checkmark.circle.fill" : "circle"} foregroundStyle={use ? "accentColor" : "tertiaryLabel"} font="title3" />
            <IconTile icon={perkIcon(u.perk)} color={ORIGIN_COLORS[u.perk.origin]} />
            <VStack alignment="leading" spacing={1}>
              <Text>{u.perk.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{`${kindText(u.perk)} · 剩 ${perkAmount(u.perk, u.left)}`}</Text>
            </VStack>
            <Spacer />
          </HStack>
        </Button>]
        if (use && u.perk.kind === "balance") {
          rows.push(<HStack key={`${u.perk.id}-amount`}>
            <Text>抵扣金额</Text>
            <Spacer />
            <TextField title="抵扣金额" value={texts[u.perk.id] ?? ""} onChanged={t => setAmount(u, t)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
            <Text foregroundStyle="secondaryLabel">元</Text>
          </HStack>)
        }
        if (use && u.perk.kind !== "balance" && u.left > 1) {
          rows.push(<Stepper
            key={`${u.perk.id}-count`}
            title={`用 ${use.used} ${u.perk.unit}`}
            onIncrement={() => setCount(u, Math.min(u.left, use.used + 1))}
            onDecrement={() => setCount(u, Math.max(1, use.used - 1))}
          />)
        }
        return rows
      })}
    </Section>)}
    <Section key="total" footer={<Text>列出所有还能用的权益。储值从金额里抵扣，次数只记用掉；费用记实付。</Text>}>
      <HStack>
        <Text>{`已选 ${picked.length} 项`}</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{`抵扣 ${money2(deduct)}`}</Text>
      </HStack>
      {amount != null ? <HStack>
        <Text>实付</Text>
        <Spacer />
        <Text font="headline">{money2(Math.max(0, amount - deduct))}</Text>
      </HStack> : null}
    </Section>
  </List>
}
