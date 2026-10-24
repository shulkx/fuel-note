// 记录、统计两页左上角的车辆菜单（设计文档 17.3 节）：切换车辆（当前的打勾，不含隐藏的车辆）、添加车辆、管理车辆
import { Button, Menu, Section } from "scripting"
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
  // 不需要的属性整个不传（systemImage 传 undefined 也会留出空位）
  const item = (v: Vehicle) => v.id === current?.id
    ? <Button key={v.id} title={v.name} systemImage="checkmark" action={() => actions.switchVehicle(v)} />
    : <Button key={v.id} title={v.name} action={() => actions.switchVehicle(v)} />
  return <Menu title="车辆" systemImage="car">
    {vehicles.length ? <Section key="vehicles">{vehicles.map(item)}</Section> : null}
    <Section key="actions">
      <Button title="添加车辆…" systemImage="plus" action={actions.addVehicle} />
      <Button title="管理车辆" systemImage="list.bullet" action={actions.manageVehicles} />
    </Section>
  </Menu>
}
