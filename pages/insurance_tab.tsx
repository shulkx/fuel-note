// 「保险」标签（设计文档 22.7 节，画布「第七轮 · 1.6」，1.6.0-beta.4）：车险的保单和每年保费。
// 左上角车辆菜单，右上角只有「+」（记保险，没有统计图标：历年保单本身就是保费的统计）；从上到下是续保提醒、历年保单、只有金额。
// 轻点一年推入保单详情（navigationDestination：卡片里还有徽章、报案、保单原件几个按钮，不能整行做成 NavigationLink）。
import { Button, ContentUnavailableView, List, NavigationStack, Section, Text, useState, VirtualNode } from "scripting"
import { AppData, currentVehicle, insuranceYears, InsuranceYear, perkBook, renewalDue, renewalGifts } from "../common/model"
import { InsuranceDetail, InsuranceDetailActions } from "./insurance_detail"
import { insuranceHistorySections, InsuranceHistoryActions } from "./insurance_history"
import { RenewalRow } from "./insurance_parts"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type InsuranceTabActions = Omit<InsuranceHistoryActions, "openInsurance"> & VehicleMenuActions & {
  getData: () => AppData
  /** 保单详情里的编辑、删除、重新记一笔费用 */
  detail: InsuranceDetailActions
  /** 保单详情「赠送」一行推入的这一批（1.7） */
  giftPage: (key: string) => VirtualNode
  /** 保单详情里还没有赠送时「添加」：打开添加权益并预选这一年 */
  addGift: (yearId: string) => Promise<void>
  /** 续保提醒里的「记保险」 */
  renew: () => void
  dismissRenewal: (y: InsuranceYear) => void
}

export function InsuranceTab({ data, subtitle, actions }: {
  data: AppData
  /** 副标题：车辆名，或保存后的临时提示 */
  subtitle: string | null
  actions: InsuranceTabActions
}) {
  const vehicle = currentVehicle(data)
  // 推入的保单详情：哪一年（id）
  const [openId, setOpenId] = useState<string | null>(null)
  const now = Date.now()
  const years = vehicle ? insuranceYears(data.ledger.insurance, vehicle.id) : []
  const renewal = renewalDue(years, now, data.ledger.settings.dismissed_renewals ?? [])
  const sections = insuranceHistorySections(data, { ...actions, openInsurance: y => setOpenId(y.id) }, now)

  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !sections.length
      ? <ContentUnavailableView title="还没有保险记录" systemImage="checkmark.shield" description="点右上角的「+」记保险：选择保单 PDF 或图片，读出保费和险种。" />
      : null

  return <NavigationStack>
    <List
      navigationTitle="保险"
      {...(subtitle ? { navigationSubtitle: subtitle } : {})}
      toolbar={{
        topBarLeading: <VehicleMenu data={data} actions={actions} />,
        ...(vehicle ? { topBarTrailing: <Button title="记保险" systemImage="plus" action={() => actions.addInsurance(null)} /> } : {}),
      }}
      navigationDestination={{
        isPresented: openId != null,
        onChanged: shown => { if (!shown) setOpenId(null) },
        content: openId ? <InsuranceDetail get={actions.getData} yearId={openId} actions={actions.detail} giftPage={actions.giftPage} addGift={actions.addGift} /> : <Text>保单</Text>,
      }}
      {...(empty ? { overlay: empty } : {})}
    >
      {renewal ? <Section key="renewal">
        <RenewalRow year={renewal.year} left={renewal.daysLeft} gifts={renewalGifts(perkBook(data.ledger), renewal.year, now)}
          onRecord={actions.renew} onDismiss={() => actions.dismissRenewal(renewal.year)} />
      </Section> : null}
      {sections}
    </List>
  </NavigationStack>
}
