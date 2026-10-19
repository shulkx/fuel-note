// 记录、统计两页左上角的车辆菜单（设计文档 17.3 节）：切换车辆（当前的打勾，按保存位置分组，不含隐藏的车辆）、添加车辆、管理车辆
import { Button, Menu, Section, ToolbarSpacer, VirtualNode } from "scripting"
import { AppData, currentVehicle, Vehicle, visibleVehicles } from "../common/model"

export type VehicleMenuActions = {
  switchVehicle: (v: Vehicle) => void
  addVehicle: () => void
  /** 到「设置 › 车辆」 */
  manageVehicles: () => void
}

export function VehicleMenu({ data, actions }: { data: AppData; actions: VehicleMenuActions }) {
  const current = currentVehicle(data)
  const vehicles = visibleVehicles(data)
  const synced = vehicles.filter(v => v.xxyh_car)
  const local = vehicles.filter(v => !v.xxyh_car)
  // 不需要的属性整个不传（systemImage 传 undefined 也会留出空位）
  const item = (v: Vehicle) => v.id === current?.id
    ? <Button key={v.id} title={v.name} systemImage="checkmark" action={() => actions.switchVehicle(v)} />
    : <Button key={v.id} title={v.name} action={() => actions.switchVehicle(v)} />
  return <Menu title="车辆" systemImage="car">
    {synced.length ? <Section key="xxyh" title="小熊油耗">{synced.map(item)}</Section> : null}
    {local.length ? <Section key="local" title="只在本机">{local.map(item)}</Section> : null}
    <Section key="actions">
      <Button title="添加车辆…" systemImage="plus" action={actions.addVehicle} />
      <Button title="管理车辆" systemImage="list.bullet" action={actions.manageVehicles} />
    </Section>
  </Menu>
}

/**
 * 记录、统计页左上角：车辆切换；能读车况时右边再放车况按钮，中间留固定间隔，两个按钮各自一块，不并成一个
 * （ToolbarSpacer；Apple HIG · Toolbars：带文字的按钮与图标按钮之间加间隔）
 */
export function leadingItems(data: AppData, actions: VehicleMenuActions, statusItem: VirtualNode | null): VirtualNode | VirtualNode[] {
  const menu = <VehicleMenu key="vehicle" data={data} actions={actions} />
  return statusItem ? [menu, <ToolbarSpacer key="gap" sizing="fixed" placement="topBarLeading" />, statusItem] : menu
}

