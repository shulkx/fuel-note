// 设置 › 车辆：名称、默认标号、车型、购车日期、导出到小熊的哪辆车（2.0）、车辆数据、隐藏、删除（连带删除记录、保险、权益）
import {
  Button, DatePicker, EnvironmentValuesReader, HStack, List, Navigation, Picker, Section, Spacer, Text, TextField, useEffect, useState,
} from "scripting"
import {
  AppData, CarSpec, catalogSpec, deleteVehicle, fmtDate, gradeOf, GRADES, gradeText, newExportCarUuid, profileFromSpec, providerById, setVehicleHidden,
  snapshotCars, updateVehicle, vehicleById, vehicleDeletionCounts, vehicleProfile, vehicleRecords,
} from "../common/model"
import { ModelPicker } from "./model_picker"
import { AppActions, showError } from "./components"

const dayMs = (d: string) => {
  const [y, m, day] = d.split("-").map(Number)
  return new Date(y, m - 1, day).getTime()
}

/** 「导出到小熊的车」的选项值：不导出、新建一辆，或小熊里某辆车的 uuid */
const NO_EXPORT = "none"
const NEW_CAR = "new"

export function VehicleEdit({ data, app, vehicleId }: { data: AppData; app: AppActions; vehicleId: string }) {
  const vehicle = vehicleById(data, vehicleId)
  const [name, setName] = useState(vehicle?.name || "")
  const profile = vehicle ? vehicleProfile(data, vehicle) : null
  // 从小熊导入的车只有车型 id，名称去车型库查（有缓存）
  const [lookedUp, setLookedUp] = useState<string | null>(null)
  useEffect(() => {
    if (!profile || profile.model_name || !profile.model) return
    let alive = true
    catalogSpec(profile.model).then(s => { if (alive && s) setLookedUp(s.name) }, () => undefined)
    return () => { alive = false }
  }, [profile?.model])
  if (!vehicle) return <List navigationTitle="车辆"><Text>车辆已删除</Text></List>

  const modelName = profile?.model_name || lookedUp || (profile?.model ? `车型 ${profile.model}` : null)

  /** 重新选车型；没改过默认标号时按车型更新 */
  async function chooseModel() {
    const spec = await Navigation.present<CarSpec | null>({ element: <ModelPicker /> })
    const v = vehicleById(app.getData(), vehicleId)
    if (!spec || !v) return
    const g = gradeOf(spec.gas_type, spec.fuel_type)
    app.setData(updateVehicle(app.getData(), { ...v, profile: profileFromSpec(spec, v.profile?.buy_date ?? null), ...(g != null ? { default_grade: g } : {}) }))
  }

  function setBuyDate(ts: number | null) {
    const v = vehicleById(app.getData(), vehicleId)
    if (!v) return
    const base = v.profile ?? profileFromSpec(null, null)
    app.setData(updateVehicle(app.getData(), { ...v, profile: { ...base, buy_date: ts == null ? null : fmtDate(ts) } }))
  }

  async function toggleHidden() {
    try {
      app.setData(setVehicleHidden(app.getData(), vehicleId, !vehicle!.hidden))
    } catch (e) {
      await showError(vehicle!.hidden ? "不能取消隐藏" : "不能隐藏", e)
    }
  }

  const saveName = () => {
    const v = vehicleById(app.getData(), vehicleId)
    if (v && name.trim() && name.trim() !== v.name) app.setData(updateVehicle(app.getData(), { ...v, name: name.trim() }))
  }

  // 导出到小熊的车：最近一份快照里的车（不联网）；别的车辆已经选了的不列
  const cars = snapshotCars().filter(c => c.uuid === vehicle.xxyh_car || !data.ledger.vehicles.some(v => v.id !== vehicleId && v.xxyh_car === c.uuid))
  const target = vehicle.xxyh_car ? cars.find(c => c.uuid === vehicle.xxyh_car) ?? null : null
  const exportValue = !vehicle.xxyh_car ? NO_EXPORT : target ? vehicle.xxyh_car : NEW_CAR
  function setExport(value: string) {
    const v = vehicleById(app.getData(), vehicleId)
    if (!v) return
    const uuid = value === NO_EXPORT ? null : value === NEW_CAR ? (v.xxyh_car && !target ? v.xxyh_car : newExportCarUuid(app.getData())) : value
    app.setData(updateVehicle(app.getData(), { ...v, xxyh_car: uuid }))
  }

  /**
   * goBack 来自 EnvironmentValuesReader 的 dismiss：只返回上一页。
   * 不能用 Navigation.useDismiss()，它关闭的是最外层 present 的页面，也就是整个油记。
   */
  async function remove(goBack: () => void) {
    const n = vehicleDeletionCounts(app.getData(), vehicleId)
    const parts = [`${n.records} 条记录`, ...(n.insurance ? [`${n.insurance} 年保险（含保单原件）`] : []), ...(n.perks ? [`${n.perks} 项权益`] : [])]
    const choice = await Dialog.actionSheet({
      title: `删除「${vehicle!.name}」？`,
      message: `同时删除 ${parts.join("、")}，不能撤销。`,
      actions: [{ label: "删除车辆", destructive: true }],
    })
    if (choice !== 0) return
    try {
      app.setData(deleteVehicle(app.getData(), vehicleId))
      goBack()
    } catch (e) {
      await showError("不能删除", e)
    }
  }

  const provider = vehicle.provider ? providerById(vehicle.provider.id) : null

  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <List navigationTitle={vehicle.name} navigationBarTitleDisplayMode="inline">
    <Section title="基本信息">
      <HStack>
        <Text>名称</Text>
        <Spacer />
        <TextField title="名称" value={name} onChanged={setName} onBlur={saveName} onSubmit={saveName} multilineTextAlignment="trailing" />
      </HStack>
      <Picker title="默认标号" value={vehicle.default_grade ?? 95} onChanged={(g: number) => app.setData(updateVehicle(app.getData(), { ...vehicle, default_grade: g }))} pickerStyle="menu">
        {GRADES.map(g => <Text key={g} tag={g}>{gradeText(g)}</Text>)}
      </Picker>
      <HStack><Text>记录</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${vehicleRecords(data, vehicle).length} 条`}</Text></HStack>
    </Section>

    <Section header={<Text>车辆资料</Text>} footer={<Text>车型与小熊油耗相同：品牌 → 车系 → 车型。</Text>}>
      <Button action={chooseModel}>
        <HStack>
          <Text foregroundStyle="label">车型</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="trailing">{modelName || "选择车型"}</Text>
        </HStack>
      </Button>
      {profile?.buy_date
        ? <DatePicker title="购车日期" value={dayMs(profile.buy_date)} onChanged={(ts: number) => setBuyDate(ts)} displayedComponents={["date"]} />
        : <Button title="填写购车日期" action={() => setBuyDate(Date.now())} />}
    </Section>

    <Section header={<Text>导出到小熊油耗</Text>} footer={<Text>{cars.length || vehicle.xxyh_car
      ? "导出到小熊油耗时，这辆车的记录写进选的这辆车；「新建一辆」时在小熊里新建。"
      : "连接小熊油耗后，可以选这辆车导出到小熊的哪辆车。"}</Text>}>
      <Picker title="导出到" value={exportValue} onChanged={setExport} pickerStyle="menu">
        <Text tag={NO_EXPORT}>不导出</Text>
        {cars.map(c => <Text key={c.uuid} tag={c.uuid}>{c.name}</Text>)}
        <Text tag={NEW_CAR}>在小熊新建一辆</Text>
      </Picker>
    </Section>

    <Section header={<Text>车辆数据</Text>} footer={<Text>在「设置 › 车辆数据」中连接并选择要关联的车辆。</Text>}>
      {vehicle.provider
        ? <>
          <HStack><Text>{provider ? provider.name : vehicle.provider.id}</Text><Spacer /><Text foregroundStyle="secondaryLabel">{vehicle.provider.name}</Text></HStack>
          <Button title="解除关联" role="destructive" action={() => app.setData(updateVehicle(app.getData(), { ...vehicle, provider: null }))} />
        </>
        : <Text foregroundStyle="secondaryLabel">未关联</Text>}
    </Section>

    <Section footer={<Text>{vehicle.hidden ? "取消隐藏后，这辆车重新出现在车辆菜单、统计和小组件里。" : "隐藏后不出现在车辆菜单、统计和小组件里，记录照常保留；在「设置 › 车辆 › 已隐藏」里恢复。"}</Text>}>
      <Button title={vehicle.hidden ? "取消隐藏" : "隐藏这辆车"} action={toggleHidden} />
    </Section>

    <Section>
      <Button title="删除车辆" role="destructive" action={() => remove(env.dismiss)} />
    </Section>
  </List>}</EnvironmentValuesReader>
}
