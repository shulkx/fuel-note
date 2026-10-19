// 记录、统计两页左上角的车辆菜单（设计文档 17.3 节）：切换车辆（当前的打勾，按保存位置分组，不含隐藏的车辆）、添加车辆、管理车辆
import { Button, Menu, Section, ToolbarItem, ToolbarSpacer, VirtualNode } from "scripting"
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
 * 记录、统计页左上角：车辆切换；能读车况时右边再放车况按钮。
 * 每个按钮各用一个 ToolbarItem，中间放 ToolbarSpacer(fixed)，两个按钮才会各自一块
 * （Scripting 文档 · Use with Toolbar Component；放在同一个 topBarLeading 数组里会被并成一个胶囊，1.3.1-beta.1 在手机上如此）
 */
export function leadingToolbarItems(data: AppData, actions: VehicleMenuActions, statusItem: VirtualNode | null): VirtualNode[] {
  const menu = <ToolbarItem key="vehicle" placement="topBarLeading"><VehicleMenu data={data} actions={actions} /></ToolbarItem>
  if (!statusItem) return [menu]
  return [
    menu,
    <ToolbarSpacer key="gap" sizing="fixed" placement="topBarLeading" />,
    <ToolbarItem key="status" placement="topBarLeading">{statusItem}</ToolbarItem>,
  ]
}
