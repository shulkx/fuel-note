// 「费用」标签（设计文档 21.2、21.4 节）：记录页左上角车辆菜单，右上角统计图标和「+」；统计图标打开「费用统计」一页，
// 「+」轻点记费用、长按选记费用或记保险（与「邮件」的撰写按钮相同：轻点新建，长按看其他选项）。
// 只放费用、保养和保险：加油在「油耗」标签（pages/fuel_tab.tsx），两边互不读对方的记录。
import { Button, Menu, NavigationStack } from "scripting"
import { AppData, currentVehicle } from "../common/model"
import { StatsLink, TabNav } from "./components"
import { ExpenseRecords, ExpenseRecordsActions } from "./expense_records"
import { ExpenseStats, ExpenseStatsActions } from "./expense_stats"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type ExpenseTabActions = ExpenseRecordsActions & ExpenseStatsActions & VehicleMenuActions & { addExpense: () => void }

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
          <StatsLink key="stats" page={<ExpenseStats data={data} nav={EXPENSE_STATS_NAV} actions={actions} />} />,
          <Menu key="add" title="新增" systemImage="plus" primaryAction={actions.addExpense}>
            <Button title="记费用" systemImage="yensign.circle" action={actions.addExpense} />
            <Button title="记保险" systemImage="checkmark.shield" action={() => actions.addInsurance(null)} />
          </Menu>,
        ],
      } : {}),
    },
  }
  return <NavigationStack>
    <ExpenseRecords data={data} nav={nav} subtitle={subtitle} actions={actions} />
  </NavigationStack>
}
