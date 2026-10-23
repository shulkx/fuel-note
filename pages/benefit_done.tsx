// 已用完和已过期（权益设计第 6 节）：用完的，和过了有效期还有剩余的（过期未用），按来自分组。
// 组名可以点，推入这一批（全部用完或过期的批从这里进）；点开一张是权益详情；左滑删除。
import { ContentUnavailableView, List, NavigationLink, Section, Text, VirtualNode } from "scripting"
import { AppData, currentVehicle, doneGroups, perkBook } from "../common/model"
import { PerkDetail } from "./benefit_detail"
import { BenefitActions, GroupHeader, groupSubtitle, PerkRow, stateText } from "./benefit_parts"
import { swipeToDelete } from "./components"

export function DonePage({ data, actions, batchPage }: { data: AppData; actions: BenefitActions; batchPage: (key: string) => VirtualNode }) {
  const vehicle = currentVehicle(data)
  const book = perkBook(data.ledger)
  const now = Date.now()
  const groups = vehicle ? doneGroups(book, vehicle.id, now) : []
  return <List navigationTitle="已用完和已过期" {...(groups.length ? {} : { overlay: <ContentUnavailableView title="没有用完或过期的权益" systemImage="ticket" /> })}>
    {groups.map((g, i) => <Section key={g.key} {...(i === groups.length - 1 ? { footer: <Text>轻点组名查看这一批；左滑一项可以删除。</Text> } : {})}>
      <NavigationLink destination={batchPage(g.key)}>
        <GroupHeader title={g.title} note={null} subtitle={groupSubtitle(g)} />
      </NavigationLink>
      {g.items.map(it => {
        const right = stateText(it.perk, it.left, now)
        return <NavigationLink key={it.perk.id} destination={<PerkDetail data={data} perkId={it.perk.id} actions={actions} batchPage={batchPage} />}
          trailingSwipeActions={swipeToDelete(() => { void actions.removePerk(it.perk.id) })}>
          <PerkRow perk={it.perk} left={it.left} {...(right ? { right } : {})} />
        </NavigationLink>
      })}
    </Section>)}
  </List>
}
