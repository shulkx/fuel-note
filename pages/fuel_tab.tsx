// 「油耗」标签（设计文档 21.2、21.3 节）：大标题下面固定一个小号的「记录 | 统计」，左上角车辆菜单，右上角「+」直接记加油。
// 只放加油：费用、保险在「费用」标签（pages/expense_tab.tsx），两边互不读对方的记录。
import { Button, NavigationStack, useState } from "scripting"
import { AppData, currentVehicle, Stop } from "../common/model"
import { PageView, TabNav, ViewBar } from "./components"
import { FuelRecords, FuelRecordsActions } from "./fuel_records"
import { FuelStats } from "./fuel_stats"
import { StatusView } from "./fuel_status"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type FuelTabActions = FuelRecordsActions & VehicleMenuActions & { addFuel: () => void }

export function FuelTab({ data, subtitle, stop, status, openStatus, actions, initialView = "records" }: {
  data: AppData
  /** 记录页的副标题：车辆名和同步状态，或保存后的临时提示 */
  subtitle: string | null
  stop: Stop | null
  status: StatusView | null
  openStatus: () => void
  actions: FuelTabActions
  /** 打开时显示哪一页（手机上的自动检查截统计页用；平时是记录） */
  initialView?: PageView
}) {
  const [view, setView] = useState<PageView>(initialView)
  const vehicle = currentVehicle(data)
  // 没有车辆时只留车辆菜单（用来添加车辆）
  const nav: TabNav = {
    title: "油耗",
    toolbar: {
      topBarLeading: <VehicleMenu data={data} actions={actions} />,
      ...(vehicle ? { topBarTrailing: <Button title="记加油" systemImage="plus" action={actions.addFuel} /> } : {}),
    },
    bar: vehicle ? <ViewBar value={view} onChanged={setView} /> : null,
  }
  return <NavigationStack>
    {view === "stats" && vehicle
      ? <FuelStats data={data} nav={nav} />
      : <FuelRecords data={data} nav={nav} subtitle={subtitle} stop={stop} status={status} openStatus={openStatus} actions={actions} />}
  </NavigationStack>
}
