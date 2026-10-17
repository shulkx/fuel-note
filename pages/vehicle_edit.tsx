// 设置 › 车辆
import { Button, HStack, List, Menu, Navigation, Picker, Section, Spacer, Text, TextField, useState } from "scripting"
import {
  AppData, deleteVehicle, GRADES, gradeText, linkVehicleToXxyh, providerById, updateVehicle, vehicleById, vehicleRecords, xxyhConnected,
} from "../common/model"
import { AppActions, showError } from "./components"

export function VehicleEdit({ data, app, vehicleId }: { data: AppData; app: AppActions; vehicleId: string }) {
  const dismiss = Navigation.useDismiss()
  const vehicle = vehicleById(data, vehicleId)
  const [name, setName] = useState(vehicle?.name || "")
  if (!vehicle) return <List navigationTitle="车辆"><Text>车辆已删除</Text></List>

  const saveName = () => {
    const v = vehicleById(app.getData(), vehicleId)
    if (v && name.trim() && name.trim() !== v.name) app.setData(updateVehicle(app.getData(), { ...v, name: name.trim() }))
  }
  const freeCars = data.mirror.cars.filter(c => !data.ledger.vehicles.some(v => v.xxyh_car === c.uuid))
  const linkedCar = data.mirror.cars.find(c => c.uuid === vehicle.xxyh_car)
  const localCount = vehicle.xxyh_car ? 0 : vehicleRecords(data, vehicle).length

  async function linkCar(uuid: string, carName: string, count: number) {
    const ok = await Dialog.confirm({
      title: `关联到小熊的「${carName}」`,
      message: `这辆车在本机的 ${localCount} 条记录会上传到小熊（云端已有 ${count} 条加油；时间完全相同的记录会跳过）。之后这辆车以小熊的数据为准。`,
      confirmLabel: "关联并上传",
    })
    if (!ok) return
    try {
      const r = linkVehicleToXxyh(app.getData(), vehicleId, uuid)
      app.setData(r.data)
      await app.sync(true)
      await Dialog.alert({ title: "已关联", message: `准备上传 ${r.added} 条，跳过 ${r.skipped} 条重复记录。` })
    } catch (e) {
      await showError("关联失败", e)
    }
  }

  async function remove() {
    const ok = await Dialog.confirm({ title: `删除「${vehicle!.name}」`, message: `连同本机的 ${localCount} 条记录一起删除，不能撤销。`, confirmLabel: "删除" })
    if (!ok) return
    try {
      app.setData(deleteVehicle(app.getData(), vehicleId))
      dismiss()
    } catch (e) {
      await showError("不能删除", e)
    }
  }

  const provider = vehicle.provider ? providerById(vehicle.provider.id) : null

  return <List navigationTitle={vehicle.name} navigationBarTitleDisplayMode="inline">
    <Section title="基本信息">
      <HStack>
        <Text>名称</Text>
        <Spacer />
        <TextField title="名称" value={name} onChanged={setName} onBlur={saveName} onSubmit={saveName} multilineTextAlignment="trailing" />
      </HStack>
      <Picker title="默认标号" value={vehicle.default_grade ?? 95} onChanged={(g: number) => app.setData(updateVehicle(app.getData(), { ...vehicle, default_grade: g }))} pickerStyle="menu">
        {GRADES.map(g => <Text tag={g}>{gradeText(g)}</Text>)}
      </Picker>
    </Section>

    <Section header={<Text>小熊油耗</Text>} footer={<Text>{vehicle.xxyh_car ? "这辆车的记录保存在小熊油耗的云备份里。要改回只在本机，请在「小熊油耗」页断开。" : "关联后，这辆车的记录保存在小熊油耗的云备份里，与官方 App、网页版共用。"}</Text>}>
      {vehicle.xxyh_car
        ? <HStack><Text>已关联</Text><Spacer /><Text foregroundStyle="secondaryLabel">{linkedCar ? linkedCar.name : vehicle.xxyh_car}</Text></HStack>
        : xxyhConnected(data) && freeCars.length
          ? <Menu title="关联到小熊的车辆…">{freeCars.map(c => <Button title={`${c.name}（${c.fuel_count} 条加油）`} action={() => linkCar(c.uuid, c.name, c.fuel_count)} />)}</Menu>
          : <Text foregroundStyle="secondaryLabel">{xxyhConnected(data) ? "小熊里没有未关联的车辆" : "未连接小熊油耗"}</Text>}
    </Section>

    <Section header={<Text>车辆数据</Text>} footer={<Text>在「设置 › 车辆数据」中连接并选择要关联的车辆。</Text>}>
      {vehicle.provider
        ? [
          <HStack><Text>{provider ? provider.name : vehicle.provider.id}</Text><Spacer /><Text foregroundStyle="secondaryLabel">{vehicle.provider.name}</Text></HStack>,
          <Button title="解除关联" role="destructive" action={() => app.setData(updateVehicle(app.getData(), { ...vehicle, provider: null }))} />,
        ]
        : <Text foregroundStyle="secondaryLabel">未关联</Text>}
    </Section>

    {!vehicle.xxyh_car ? <Section>
      <Button title="删除车辆" role="destructive" action={remove} />
    </Section> : null}
  </List>
}
