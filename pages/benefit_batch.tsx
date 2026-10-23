// 一批（权益设计第 6 节，画布第九轮 R9Batch）：同一来自的全部卡（含用完、过期的）、来自、有效期、门店、原文。
// 一批不是要维护的对象：右上角「编辑」一次改这一批的来自名称、有效期、门店、原文，改完写进每一张卡；「添加一项」；最下面「删除这一批」
// （卡和使用记录一起删，记过的费用不动）。车险赠送的「来自」一行推入保单详情；从保单详情进来时不传 policyPage，这一行不能点。
import { Button, ContentUnavailableView, EnvironmentValuesReader, HStack, List, NavigationLink, Section, Spacer, Text, VirtualNode } from "scripting"
import { AppData, batchInfo, batchPerks, currentVehicle, InsuranceYear, perkBook, policyDate, remaining, yearInsurer, yearPeriod } from "../common/model"
import { PerkDetail } from "./benefit_detail"
import { BenefitActions, periodLine, PerkRow, stateText } from "./benefit_parts"
import { swipeToDelete } from "./components"

export function BatchPage({ data, batchKey, actions, policyPage }: {
  data: AppData
  batchKey: string
  actions: BenefitActions
  policyPage?: (y: InsuranceYear) => VirtualNode
}) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env => {
    const vehicle = currentVehicle(data)
    const book = perkBook(data.ledger)
    const info = vehicle ? batchInfo(book, vehicle.id, batchKey) : null
    if (!vehicle || !info) return <List navigationTitle="权益" overlay={<ContentUnavailableView title="这一批已删除" systemImage="ticket" />}></List>
    const perks = batchPerks(book, vehicle.id, batchKey)
    const now = Date.now()
    const year = info.year
    const fromText = year ? `${info.title} · ${yearInsurer(year)}` : info.title
    const stores = new Set(perks.map(p => p.store.trim()).filter(Boolean))
    const subtitle = [year ? yearInsurer(year) : info.store, info.end != null ? `至 ${policyDate(info.end)}` : ""].filter(Boolean).join(" · ")

    async function remove() {
      if (await actions.removeBatch(batchKey)) env.dismiss()
    }

    return <List
      navigationTitle={info.title}
      {...(subtitle ? { navigationSubtitle: subtitle } : {})}
      toolbar={{ primaryAction: <Button title="编辑" action={() => actions.editBatch(batchKey)} /> }}
    >
      <Section key="info">
        {year && policyPage
          ? <NavigationLink destination={policyPage(year)}>
            <HStack><Text>来自</Text><Spacer /><Text foregroundStyle="secondaryLabel">{fromText}</Text></HStack>
          </NavigationLink>
          : <HStack><Text>来自</Text><Spacer /><Text foregroundStyle="secondaryLabel">{fromText}</Text></HStack>}
        <HStack><Text>有效期</Text><Spacer /><Text foregroundStyle="secondaryLabel">{periodLine(info.end, year ? yearPeriod(year) : null, now)}</Text></HStack>
        <HStack><Text>门店</Text><Spacer /><Text foregroundStyle="secondaryLabel">{info.store || (stores.size > 1 ? "各不相同" : "不填")}</Text></HStack>
      </Section>

      <Section key="items" header={<HStack><Text>权益</Text><Spacer /><Text>{`${perks.length} 项`}</Text></HStack>}
        footer={<Text>轻点一项查看和编辑，左滑删除。</Text>}>
        {perks.map(p => {
          const left = remaining(book, p)
          const right = stateText(p, left, now)
          return <NavigationLink key={p.id} destination={<PerkDetail data={data} perkId={p.id} actions={actions} />}
            trailingSwipeActions={swipeToDelete(() => { void actions.removePerk(p.id) })}>
            <PerkRow perk={p} left={left} {...(right ? { right } : {})} />
          </NavigationLink>
        })}
        <Button title="添加一项" systemImage="plus.circle" action={() => actions.addToBatch(batchKey)} />
      </Section>

      {info.raw ? <Section key="raw" header={<Text>原文</Text>}>
        <Text font="subheadline">{info.raw}</Text>
      </Section> : null}

      <Section key="delete" footer={<Text>{`这一批的 ${perks.length} 项和它们的使用记录一起删除；记过的费用不变。`}</Text>}>
        <Button title="删除这一批" role="destructive" action={() => { void remove() }} />
      </Section>
    </List>
  }}</EnvironmentValuesReader>
}
