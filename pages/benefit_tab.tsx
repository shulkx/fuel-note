// 「权益」标签（权益设计第 6 节，画布第九轮 R9Wallet）：有剩余、没过期的卡，按来自分组、按到期排，每张写剩余；30 天内到期的组头标橙。
// 最后一行「已用完和已过期」。左上角车辆菜单，右上角「+」添加一批；下拉同步。轻点组头推入这一批，轻点一张推入权益详情；
// 任何一张都能左滑删除（先确认，记过的费用不动）。
import { Button, ContentUnavailableView, HStack, List, NavigationLink, NavigationStack, Section, Spacer, Text, VirtualNode } from "scripting"
import { AppData, currentVehicle, doneGroups, InsuranceYear, perkBook, perkGroups } from "../common/model"
import { BatchPage } from "./benefit_batch"
import { PerkDetail } from "./benefit_detail"
import { DonePage } from "./benefit_done"
import { BenefitActions, GroupHeader, groupSubtitle, PerkRow } from "./benefit_parts"
import { swipeToDelete } from "./components"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type BenefitTabActions = BenefitActions & VehicleMenuActions & {
  sync: () => Promise<void>
  /** 一批里「来自」一行推入保单详情 */
  policyPage: (y: InsuranceYear) => VirtualNode
}

export function BenefitTab({ data, subtitle, actions }: { data: AppData; subtitle: string | null; actions: BenefitTabActions }) {
  const vehicle = currentVehicle(data)
  const now = Date.now()
  const book = perkBook(data.ledger)
  const groups = vehicle ? perkGroups(book, vehicle.id, now) : []
  const doneCount = vehicle ? doneGroups(book, vehicle.id, now).reduce((t, g) => t + g.items.length, 0) : 0
  const batchPage = (key: string) => <BatchPage data={data} batchKey={key} actions={actions} policyPage={actions.policyPage} />

  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !groups.length && !doneCount
      ? <ContentUnavailableView title="还没有权益" systemImage="ticket" description="点右上角的「+」添加车险赠送、保养套餐或其他权益，可以粘贴文字或选截图识别。" />
      : null

  return <NavigationStack>
    <List
      navigationTitle="权益"
      {...(subtitle ? { navigationSubtitle: subtitle } : {})}
      refreshable={actions.sync}
      toolbar={{
        topBarLeading: <VehicleMenu data={data} actions={actions} />,
        ...(vehicle ? { topBarTrailing: <Button title="添加权益" systemImage="plus" action={() => actions.addPerks(null)} /> } : {}),
      }}
      {...(empty ? { overlay: empty } : {})}
    >
      {groups.map(g => <Section key={g.key}>
        <NavigationLink destination={batchPage(g.key)}>
          <GroupHeader title={g.title} note={g.note} subtitle={groupSubtitle(g)} />
        </NavigationLink>
        {g.items.map(i => <NavigationLink
          key={i.perk.id}
          destination={<PerkDetail data={data} perkId={i.perk.id} actions={actions} batchPage={batchPage} />}
          trailingSwipeActions={swipeToDelete(() => { void actions.removePerk(i.perk.id) })}
        >
          <PerkRow perk={i.perk} left={i.left} />
        </NavigationLink>)}
      </Section>)}

      {vehicle && (groups.length || doneCount) ? <Section key="more" footer={<Text>按到期日排列，到期前 30 天起组头标橙。轻点组名查看这一批，左滑一项可以删除。</Text>}>
        <NavigationLink destination={<DonePage data={data} actions={actions} batchPage={batchPage} />}>
          <HStack>
            <Text>已用完和已过期</Text>
            <Spacer />
            {doneCount ? <Text font="subheadline" foregroundStyle="secondaryLabel">{`${doneCount} 项`}</Text> : null}
          </HStack>
        </NavigationLink>
      </Section> : null}
    </List>
  </NavigationStack>
}
