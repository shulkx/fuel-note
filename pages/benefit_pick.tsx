// 使用权益（权益设计第 4 节，画布第九轮 R9Use）：记费用里「使用权益」一行推入。列出费用那天还能用的卡（2.1 起按有效期起和到期），按来自分组，不按门店、类别筛选。
// 勾上储值时默认抵扣剩余和还没抵扣的金额中较小的，可以改；次数（含抵用券）只记用掉，用步进器，不抵钱。抵扣从这次的金额里减去，费用记实付。
// 关联了养修的费用（2.1 设计第 12 节，画布 YsUsePick、YsUseOld）：上面列出工单上的优惠（旧工单是项目名里写的赠送）对照着勾；金额就是实付，不再减去抵扣。
import { Button, HStack, Image, List, Section, Spacer, Stepper, Text, TextField, useState, VStack } from "scripting"
import { deductOf, defaultUse, groupKey, kindText, numText, parseNum, perkAmount, Usable, Use, yuan } from "../common/model"
import { serviceDay } from "./service_parts"
import { IconTile, ORIGIN_COLORS, perkIcon } from "./benefit_parts"

export function PerkPick({ usable, uses, amount, onChange, refs = null, linked = false }: {
  usable: Usable[]
  uses: Use[]
  /** 关联了养修：上面对照的工单优惠（金额 null 的是项目名里写的赠送） */
  refs?: Array<{ name: string; amount: number | null }> | null
  /** 关联了养修：金额就是实付，不显示「实付」一行 */
  linked?: boolean
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
  const ends = (g: { items: Usable[] }) => {
    const list = g.items.map(u => u.perk.end_ts).filter((t): t is number => t != null)
    return list.length ? `到 ${serviceDay(Math.min(...list))}` : "不限"
  }
  const oldTickets = !!refs && refs.length > 0 && refs.every(r => r.amount == null)

  return <List navigationTitle="使用权益" navigationBarTitleDisplayMode="inline">
    {refs && refs.length ? <Section key="refs" header={<Text>{oldTickets ? "工单里写的赠送、延保" : "沃尔沃结算里的优惠"}</Text>}
      footer={<Text>{oldTickets ? "2024 年 10 月以前的工单没有优惠明细，对照项目名勾。" : "只读，对照着勾。一条优惠可能是几项权益合起来的，几项都勾。"}</Text>}>
      {refs.map((r, i) => <HStack key={String(i)}>
        <Text>{r.name}</Text>
        <Spacer />
        {r.amount != null ? <Text foregroundStyle="secondaryLabel">{`−${yuan(r.amount)}`}</Text> : null}
      </HStack>)}
    </Section> : null}
    {groups.map(g => <Section key={g.key} header={<HStack><Text>{g.title}</Text><Spacer /><Text>{ends(g)}</Text></HStack>}>
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
    <Section key="total" footer={<Text>{linked
      ? "只列这笔费用那天有效、还有剩余的权益。储值的抵扣算进费用统计；这笔费用记的是实付，不再减去抵扣。"
      : "列出这笔费用那天还能用的权益。储值从金额里抵扣，次数只记用掉；费用记实付。"}</Text>}>
      <HStack>
        <Text>{`已选 ${picked.length} 项`}</Text>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{`抵扣 ${yuan(deduct)}`}</Text>
      </HStack>
      {amount != null && !linked ? <HStack>
        <Text>实付</Text>
        <Spacer />
        <Text font="headline">{yuan(Math.max(0, amount - deduct))}</Text>
      </HStack> : null}
    </Section>
  </List>
}
