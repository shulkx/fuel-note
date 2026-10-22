// 「费用」标签（设计文档 21.2、21.4 节）：导航栏中间切换「记录 | 统计」，左上角车辆菜单，
// 右上角「+」轻点记费用、长按选记费用或记保险（与「邮件」的撰写按钮相同：轻点新建，长按看其他选项）。
// 只放费用、保养和保险：加油在「油耗」标签（pages/fuel_tab.tsx），两边互不读对方的记录。
import { Button, Menu, NavigationStack, useState } from "scripting"
import { AppData, currentVehicle } from "../common/model"
import { PageView, TabNav, ViewPicker } from "./components"
import { ExpenseRecords, ExpenseRecordsActions } from "./expense_records"
import { ExpenseStats, ExpenseStatsActions } from "./expense_stats"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type ExpenseTabActions = ExpenseRecordsActions & ExpenseStatsActions & VehicleMenuActions & { addExpense: () => void }

export function ExpenseTab({ data, subtitle, actions, initialView = "records" }: {
  data: AppData
  /** 记录页的副标题：车辆名和同步状态，或保存后的临时提示 */
  subtitle: string | null
  actions: ExpenseTabActions
  /** 打开时显示哪一页（手机上的自动检查截统计页用；平时是记录） */
  initialView?: PageView
}) {
  const [view, setView] = useState<PageView>(initialView)
  const vehicle = currentVehicle(data)
  const nav: TabNav = {
    title: "费用",
    toolbar: {
      topBarLeading: <VehicleMenu data={data} actions={actions} />,
      ...(vehicle ? {
        principal: <ViewPicker value={view} onChanged={setView} />,
        topBarTrailing: <Menu title="新增" systemImage="plus" primaryAction={actions.addExpense}>
          <Button title="记费用" systemImage="yensign.circle" action={actions.addExpense} />
          <Button title="记保险" systemImage="checkmark.shield" action={() => actions.addInsurance(null)} />
        </Menu>,
      } : {}),
    },
  }
  return <NavigationStack>
    {view === "stats" && vehicle
      ? <ExpenseStats data={data} nav={nav} actions={actions} />
      : <ExpenseRecords data={data} nav={nav} subtitle={subtitle} actions={actions} />}
  </NavigationStack>
}
