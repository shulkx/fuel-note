// 设置 › 车辆
import {
  Button, DatePicker, EnvironmentValuesReader, HStack, List, Navigation, Picker, Section, Spacer, Text, TextField, useEffect, useState,
} from "scripting"
import {
  AppData, CarSpec, catalogSpec, convertVehicleToLocal, convertVehicleToXxyh, deleteVehicle, fmtDate, gradeOf, GRADES, gradeText, pendingForVehicle,
  profileFromSpec, providerById, setVehicleHidden, updateVehicle, vehicleById, vehicleProfile, vehicleRecords, xxyhConnected,
} from "../common/model"
import { ModelPicker } from "./model_picker"
import { AppActions, showError } from "./components"

const dayMs = (d: string) => {
  const [y, m, day] = d.split("-").map(Number)
  return new Date(y, m - 1, day).getTime()
}

export function VehicleEdit({ data, app, vehicleId }: { data: AppData; app: AppActions; vehicleId: string }) {
  const vehicle = vehicleById(data, vehicleId)
  const [name, setName] = useState(vehicle?.name || "")
  const profile = vehicle ? vehicleProfile(data, vehicle) : null
  // 小熊车辆只有车型 id，名称去车型库查（有缓存）
  const [lookedUp, setLookedUp] = useState<string | null>(null)
  useEffect(() => {
    if (!profile || profile.model_name || !profile.model) return
    let alive = true
    catalogSpec(profile.model).then(s => { if (alive && s) setLookedUp(s.name) }, () => undefined)
    return () => { alive = false }
  }, [profile?.model])
  if (!vehicle) return <List navigationTitle="车辆"><Text>车辆已删除</Text></List>

  const modelName = profile?.model_name || lookedUp || (profile?.model ? `车型 ${profile.model}` : null)
  const local = !vehicle.xxyh_car

  /** 本机车辆：重新选车型；没改过默认标号时按车型更新 */
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
  const linkedCar = data.mirror.cars.find(c => c.uuid === vehicle.xxyh_car)
  const localCount = vehicle.xxyh_car ? 0 : vehicleRecords(data, vehicle).length

  /** 本机 → 小熊（设计文档 17.5 节）：在小熊新建这辆车并上传它的全部记录。不做合并 */
  async function toXxyh() {
    const restore = !!vehicle!.former_xxyh_car
    const i = await Dialog.actionSheet({
      title: restore ? `把「${vehicle!.name}」恢复到小熊油耗` : `把「${vehicle!.name}」转为小熊车辆`,
      message: restore
        ? `在小熊重新建这辆车（云端还没有时用原来的车辆编号），并上传 ${localCount} 条记录。官方 App 和网页版里会重新出现，之后和其他小熊车辆一样同步。`
        : `在小熊新建这辆车，名称、车型、购车日期一起带过去，并上传 ${localCount} 条记录。官方 App 和网页版里都会出现，之后和其他小熊车辆一样同步。`,
      actions: [{ label: restore ? "恢复到小熊油耗" : "转为小熊车辆" }],
    })
    if (i !== 0) return
    try {
      app.setData(convertVehicleToXxyh(app.getData(), vehicleId))
      await app.sync(true)
    } catch (e) {
      await showError("转换失败", e)
    }
  }

  /** 小熊 → 本机（设计文档 17.6 节）：记录和资料复制到本机，云端不动 */
  async function toLocal() {
    const pendingNow = () => {
      const v = vehicleById(app.getData(), vehicleId)
      return v ? pendingForVehicle(app.getData(), v) : 0
    }
    if (pendingNow()) {
      const i = await Dialog.actionSheet({ title: "这辆车还有没上传的修改", message: "转为本机车辆前需要先上传。", actions: [{ label: "立即上传" }] })
      if (i !== 0) return
      await app.sync(true)
      if (pendingNow()) return
    }
    const i = await Dialog.actionSheet({
      title: `把「${vehicle!.name}」转为本机车辆`,
      message: "记录和车辆资料复制到本机，之后只在本机保存。小熊云端的这辆车不变，以后不再出现在油记里；再转回小熊时会在小熊新建一辆。",
      actions: [{ label: "转为本机车辆" }],
    })
    if (i !== 0) return
    try {
      app.setData(convertVehicleToLocal(app.getData(), vehicleId))
    } catch (e) {
      await showError("转换失败", e)
    }
  }

  /**
   * goBack 来自 EnvironmentValuesReader 的 dismiss：只返回上一页。
   * 不能用 Navigation.useDismiss()，它关闭的是最外层 present 的页面，也就是整个油记。
   */
  async function remove(goBack: () => void) {
    const choice = await Dialog.actionSheet({
      title: `删除「${vehicle!.name}」？`,
      message: `连同本机的 ${localCount} 条记录一起删除，不能撤销。`,
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
    </Section>

    <Section header={<Text>车辆资料</Text>} footer={<Text>{local ? "车型与小熊油耗相同：品牌 → 车系 → 车型。" : "车型和购车日期取自小熊。"}</Text>}>
      {local
        ? <Button action={chooseModel}>
          <HStack>
            <Text foregroundStyle="label">车型</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="trailing">{modelName || "选择车型"}</Text>
          </HStack>
        </Button>
        : <HStack><Text>车型</Text><Spacer /><Text foregroundStyle="secondaryLabel" lineLimit={2} multilineTextAlignment="trailing">{modelName || "未设置"}</Text></HStack>}
      {local && profile?.buy_date
        ? <DatePicker title="购车日期" value={dayMs(profile.buy_date)} onChanged={(ts: number) => setBuyDate(ts)} displayedComponents={["date"]} />
        : local
          ? <Button title="填写购车日期" action={() => setBuyDate(Date.now())} />
          : <HStack><Text>购车日期</Text><Spacer /><Text foregroundStyle="secondaryLabel">{profile?.buy_date || "未设置"}</Text></HStack>}
    </Section>

    <Section
      header={<Text>保存位置</Text>}
      footer={<Text>{vehicle.xxyh_car
        ? "记录保存在小熊云端，与官方 App、网页版共用。"
        : vehicle.former_xxyh_car
          ? "这辆车已从小熊云端删除，记录都在本机。需要时可以重新上传，恢复到小熊。"
          : xxyhConnected(data) ? "转为小熊车辆后，记录保存在小熊云端，与官方 App、网页版共用。" : "连接小熊油耗后，可以转为小熊车辆。"}</Text>}
    >
      {vehicle.xxyh_car
        ? <HStack><Text>小熊油耗</Text><Spacer /><Text foregroundStyle="secondaryLabel">{linkedCar ? `${linkedCar.fuel_count} 次加油 · ${linkedCar.expense_count} 条费用` : "等待上传"}</Text></HStack>
        : <HStack><Text>只在本机</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${localCount} 条记录`}</Text></HStack>}
      {vehicle.xxyh_car
        ? <Button title="转为本机车辆…" action={toLocal} />
        : xxyhConnected(data) ? <Button title={vehicle.former_xxyh_car ? "恢复到小熊油耗…" : "转为小熊车辆…"} action={toXxyh} /> : null}
    </Section>

    <Section header={<Text>车辆数据</Text>} footer={<Text>在「设置 › 车辆数据」中连接并选择要关联的车辆。</Text>}>
      {vehicle.provider
        ? <>
          <HStack><Text>{provider ? provider.name : vehicle.provider.id}</Text><Spacer /><Text foregroundStyle="secondaryLabel">{vehicle.provider.name}</Text></HStack>
          <Button title="解除关联" role="destructive" action={() => app.setData(updateVehicle(app.getData(), { ...vehicle, provider: null }))} />
        </>
        : <Text foregroundStyle="secondaryLabel">未关联</Text>}
    </Section>

    <Section footer={<Text>{vehicle.hidden ? "取消隐藏后，这辆车重新出现在车辆菜单、统计和小组件里。" : "隐藏后不出现在车辆菜单、统计和小组件里，记录照常保留和同步；在「设置 › 车辆 › 已隐藏」里恢复。"}</Text>}>
      <Button title={vehicle.hidden ? "取消隐藏" : "隐藏这辆车"} action={toggleHidden} />
    </Section>

    {!vehicle.xxyh_car ? <Section>
      <Button title="删除车辆" role="destructive" action={() => remove(env.dismiss)} />
    </Section> : null}
  </List>}</EnvironmentValuesReader>
}
