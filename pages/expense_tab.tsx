// 「费用」标签（设计文档 21.2、22.5 节）：记录页左上角车辆菜单，右上角统计图标和「+」；统计图标推入「费用统计」一页，
// 「+」轻点直接记费用（1.6.0-beta.4 起没有长按菜单：车险在「保险」标签记）。
// 只放车险以外的费用和保养：加油在「油耗」标签（pages/fuel_tab.tsx），车险在「保险」标签（pages/insurance_tab.tsx）。
import { Button, NavigationStack } from "scripting"
import { AppData, currentVehicle } from "../common/model"
import { StatsLink, TabNav } from "./components"
import { ExpenseRecords, ExpenseRecordsActions } from "./expense_records"
import { ExpenseStats } from "./expense_stats"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type ExpenseTabActions = ExpenseRecordsActions & VehicleMenuActions & { addExpense: () => void }

/** 统计页是推入的一页：左上角是返回，不放车辆菜单和「+」 */
export const EXPENSE_STATS_NAV: TabNav = { title: "费用统计", toolbar: {} }

export function ExpenseTab({ data, subtitle, actions }: {
  data: AppData
  /** 记录页的副标题：车辆名和同步状态，或保存后的临时提示 */
  subtitle: string | null
  actions: ExpenseTabActions
}) {
  const vehicle = currentVehicle(data)
  const nav: TabNav = {
    title: "费用",
    toolbar: {
      topBarLeading: <VehicleMenu data={data} actions={actions} />,
      ...(vehicle ? {
        topBarTrailing: [
          <StatsLink key="stats" page={<ExpenseStats data={data} nav={EXPENSE_STATS_NAV} />} />,
          <Button key="add" title="记费用" systemImage="plus" action={actions.addExpense} />,
        ],
      } : {}),
    },
  }
  return <NavigationStack>
    <ExpenseRecords data={data} nav={nav} subtitle={subtitle} actions={actions} />
  </NavigationStack>
}
