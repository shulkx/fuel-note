// 权益详情（权益设计第 6 节，画布第九轮 R9Card）：剩余、有效期、门店、来自、说明、使用记录；
// 右上角「编辑」（弹出编辑权益，保存即生效），「用于记费用」「记一次使用」，最下面「删除这项权益」（不受费用限制，记过的费用不动）。
// 使用记录：记在费用上的轻点打开那笔费用（按费用的 id）；记一次使用的轻点修改、左滑删除；对应的费用已经不在的左滑删除。
import { Button, ContentUnavailableView, EnvironmentValuesReader, HStack, List, NavigationLink, Section, Spacer, Text, VirtualNode, VStack } from "scripting"
import {
  AppData, ExpenseRecord, fmtDate, groupKey, perkAmount, perkBook, perkState, perkYear, policyDate, remaining, useText, yearInsurer, yearPeriod, yuan,
} from "../common/model"
import { BenefitActions, periodLine } from "./benefit_parts"
import { swipeToDelete } from "./components"

function Row({ title, value }: { title: string; value: string }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function PerkDetail({ data, perkId, actions, batchPage }: {
  data: AppData
  perkId: string
  actions: BenefitActions
  /** 「来自」一行推入这一批；从这一批进来时不传，这一行不能点 */
  batchPage?: (key: string) => VirtualNode
}) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env => {
    const book = perkBook(data.ledger)
    const perk = book.perks.find(p => p.id === perkId)
    if (!perk) return <List navigationTitle="权益" overlay={<ContentUnavailableView title="这项权益已删除" systemImage="ticket" />}></List>
    const now = Date.now()
    const left = remaining(book, perk)
    const year = perkYear(book, perk)
    const expenses = new Map(data.ledger.records.filter((r): r is ExpenseRecord => r.kind === "expense").map(r => [r.id, r]))
    const uses = book.uses.filter(u => u.perk_id === perk.id).sort((a, b) => b.ts - a.ts)
    const active = perkState(book, perk, now) === "active"
    const fromText = year ? `${perk.source} · ${yearInsurer(year)}` : perk.source

    async function remove() {
      if (await actions.removePerk(perk!.id)) env.dismiss()
    }

    const useFooter = [
      uses.some(u => u.expense_id != null) ? "记在费用上的，轻点打开那笔费用。" : "",
      uses.some(u => u.expense_id == null) ? "记一次使用的，轻点修改，左滑删除。" : "",
    ].filter(Boolean).join("")

    return <List
      navigationTitle={perk.name}
      navigationSubtitle={[perk.source, perk.end_ts != null ? `至 ${policyDate(perk.end_ts)}` : ""].filter(Boolean).join(" · ")}
      toolbar={{ primaryAction: <Button title="编辑" action={() => actions.editPerk(perk.id)} /> }}
    >
      <Section key="info">
        <Row title="剩余" value={`${perkAmount(perk, left)} · 共 ${perkAmount(perk, perk.total)}`} />
        <Row title="有效期" value={periodLine(perk.end_ts, year ? yearPeriod(year) : null, now)} />
        <Row title="门店" value={data.ledger.stores.find(s => s.id === perk.store_id)?.name ?? "不填"} />
        {batchPage
          ? <NavigationLink destination={batchPage(groupKey(perk))}>
            <HStack><Text>来自</Text><Spacer /><Text foregroundStyle="secondaryLabel">{fromText}</Text></HStack>
          </NavigationLink>
          : <Row title="来自" value={fromText} />}
        {perk.note ? <Text font="footnote" foregroundStyle="secondaryLabel">{perk.note}</Text> : null}
      </Section>

      <Section key="uses" header={<Text>使用记录</Text>} {...(useFooter ? { footer: <Text>{useFooter}</Text> } : {})}>
        {uses.length ? uses.map(u => {
          if (u.expense_id == null) {
            return <Button key={u.id} action={() => actions.useOnce(perk.id, u)} trailingSwipeActions={swipeToDelete(() => actions.removeUse(u))}>
              <HStack foregroundStyle="label">
                <VStack alignment="leading" spacing={2}>
                  <Text>{useText(perk, u.used)}</Text>
                  <Text font="caption" foregroundStyle="secondaryLabel">{[fmtDate(u.ts), "记一次使用", u.note].filter(Boolean).join(" · ")}</Text>
                </VStack>
                <Spacer />
              </HStack>
            </Button>
          }
          const e = expenses.get(u.expense_id)
          return <Button key={u.id} action={() => actions.openExpense(u.expense_id!)}>
            <HStack foregroundStyle="label">
              <VStack alignment="leading" spacing={2}>
                <Text>{useText(perk, u.used)}</Text>
                <Text font="caption" foregroundStyle="secondaryLabel">{e ? [fmtDate(e.ts) + " 的费用", `实付 ${yuan(e.amount)}`].join(" · ") : fmtDate(u.ts)}</Text>
              </VStack>
              <Spacer />
            </HStack>
          </Button>
        }) : <Text foregroundStyle="secondaryLabel">还没有使用</Text>}
      </Section>

      {active ? <Section key="actions" footer={<Text>用于记费用：打开记费用，勾上这一项。记一次使用：记下不花钱的使用，不另记费用。</Text>}>
        <Button title="用于记费用" systemImage="yensign.circle" action={() => actions.useInExpense(perk.id)} />
        <Button title="记一次使用" systemImage="checkmark.circle" action={() => actions.useOnce(perk.id, null)} />
      </Section> : null}

      <Section key="delete">
        <Button title="删除这项权益" role="destructive" action={() => { void remove() }} />
      </Section>
    </List>
  }}</EnvironmentValuesReader>
}
