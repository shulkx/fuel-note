// 设置 › 车辆数据（按提供方的定义生成，不认识具体品牌）
import { Button, HStack, List, Menu, ProgressView, Section, Spacer, Text, TextField, VStack, useEffect, useState } from "scripting"
import {
  AppData, connectProvider, diagnoseVehicleStatus, disconnectProvider, fmtDateTime, providerCredential, providerVehicles, providerVehicleStatus, RemoteVehicle,
  updateVehicle,
  VehicleDataProvider, VehicleStatus,
} from "../common/model"
import { AppActions, errorMessage } from "./components"

export function ProviderSettings({ data, app, provider }: { data: AppData; app: AppActions; provider: VehicleDataProvider }) {
  const [input, setInput] = useState<Record<string, string>>({})
  const [remote, setRemote] = useState<RemoteVehicle[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connected, setConnected] = useState(() => !!providerCredential(provider.id))

  useEffect(() => {
    if (!connected) return
    setBusy(true)
    providerVehicles(provider.id).then(setRemote, e => setError(errorMessage(e))).finally(() => setBusy(false))
  }, [connected])

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const list = await connectProvider(provider.id, input)
      setRemote(list)
      setConnected(true)
      setInput({})
      // 只有一辆远端车、一辆油记车辆且都没关联时，直接关联
      const d = app.getData()
      if (list.length === 1 && d.ledger.vehicles.length === 1 && !d.ledger.vehicles[0].provider) {
        app.setData(updateVehicle(d, { ...d.ledger.vehicles[0], provider: { id: provider.id, vehicle_id: list[0].id, name: list[0].name } }))
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function paste(key: string) {
    const t = await Pasteboard.getString()
    if (t) setInput({ ...input, [key]: t })
  }

  async function disconnect() {
    const choice = await Dialog.actionSheet({
      title: `断开${provider.name}？`,
      message: "删除凭据，并解除所有车辆的关联。记录不受影响。",
      actions: [{ label: "断开", destructive: true }],
    })
    if (choice !== 0) return
    app.setData(disconnectProvider(app.getData(), provider.id))
    setConnected(false)
    setRemote(null)
  }

  function link(rv: RemoteVehicle, vehicleId: string | null) {
    const d = app.getData()
    let next = d
    for (const v of d.ledger.vehicles) {
      const isTarget = v.id === vehicleId
      const linkedHere = v.provider?.id === provider.id && v.provider.vehicle_id === rv.id
      if (isTarget) next = updateVehicle(next, { ...v, provider: { id: provider.id, vehicle_id: rv.id, name: rv.name } })
      else if (linkedHere) next = updateVehicle(next, { ...v, provider: null })
    }
    app.setData(next)
  }

  // 车况（设计文档 18.1 节）：读出来与沃尔沃 App 的车况页对照
  const [status, setStatus] = useState<{ vin: string; name: string; value: VehicleStatus | null; error: string | null } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  async function readStatus(rv: RemoteVehicle) {
    setStatusBusy(true)
    try {
      setStatus({ vin: rv.id, name: rv.name, value: await providerVehicleStatus(provider.id, rv.id), error: null })
    } catch (e) {
      setStatus({ vin: rv.id, name: rv.name, value: null, error: errorMessage(e) })
    } finally {
      setStatusBusy(false)
    }
  }
  const fmt = (n: number | null, unit: string, d = 1) => (n == null ? "—" : `${n.toFixed(d)} ${unit}`)
  const [probe, setProbe] = useState<string[] | null>(null)
  async function runProbe(vin: string) {
    setStatusBusy(true)
    setProbe(["正在诊断，每种写法最多等 15 秒…"])
    try {
      setProbe(await diagnoseVehicleStatus(provider.id, vin))
    } catch (e) {
      setProbe([`诊断失败：${errorMessage(e)}`])
    } finally {
      setStatusBusy(false)
    }
  }

  return <List navigationTitle={provider.name} navigationBarTitleDisplayMode="inline">
    <Section footer={<Text>{provider.description}</Text>}>
      <Text>{connected ? "已连接" : "未连接"}</Text>
      {error ? <Text font="footnote" foregroundStyle="systemRed">{error}</Text> : null}
    </Section>

    {connected ? <Section header={<Text>车辆</Text>} footer={<Text>关联后，记加油时可以「从行程选择」里程、时间和油站。</Text>}>
      {busy && !remote ? <HStack><Spacer /><ProgressView /><Spacer /></HStack> : null}
      {(remote || []).map(rv => {
        const owner = data.ledger.vehicles.find(v => v.provider?.id === provider.id && v.provider.vehicle_id === rv.id)
        return <HStack>
          <VStack alignment="leading" spacing={3}>
            <Text>{rv.name}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{rv.detail}</Text>
          </VStack>
          <Spacer />
          <Menu title={owner ? owner.name : "关联到…"}>
            {data.ledger.vehicles.map(v => owner?.id === v.id
              ? <Button key={v.id} title={v.name} systemImage="checkmark" action={() => link(rv, v.id)} />
              : <Button key={v.id} title={v.name} action={() => link(rv, v.id)} />)}
            {owner ? <Button title="解除关联" role="destructive" action={() => link(rv, null)} /> : null}
          </Menu>
        </HStack>
      })}
    </Section> : null}

    {connected && provider.vehicleStatus && remote && remote.length ? <Section
      key="status"
      header={<Text>车况</Text>}
      footer={<Text>剩余油量、续航、平均油耗与沃尔沃 App 的车况页对照，确认一致后再接到记录页和小组件。车况在停车熄火时更新。</Text>}
    >
      {remote.map(rv => <Button key={rv.id} title={statusBusy ? "读取中…" : `读取「${rv.name}」的车况`} systemImage="fuelpump" action={() => readStatus(rv)} disabled={statusBusy} />)}
      {status && status.error ? <Text font="footnote" foregroundStyle="systemRed">{status.error}</Text> : null}
      {status && status.error ? <Button title="诊断请求方式" systemImage="stethoscope" action={() => runProbe(status.vin)} disabled={statusBusy} /> : null}
      {probe ? <Text font="caption2" foregroundStyle="secondaryLabel">{probe.join("\n")}</Text> : null}
      {status && status.value ? <>
        <HStack><Text>剩余油量</Text><Spacer /><Text foregroundStyle="secondaryLabel" monospacedDigit>{fmt(status.value.fuel_l, "L")}</Text></HStack>
        <HStack><Text>续航</Text><Spacer /><Text foregroundStyle="secondaryLabel" monospacedDigit>{fmt(status.value.range_km, "km", 0)}</Text></HStack>
        <HStack><Text>车机平均油耗</Text><Spacer /><Text foregroundStyle="secondaryLabel" monospacedDigit>{fmt(status.value.avg_consumption, "L/100km")}</Text></HStack>
        <HStack><Text>里程表</Text><Spacer /><Text foregroundStyle="secondaryLabel" monospacedDigit>{fmt(status.value.odometer_km, "km")}</Text></HStack>
        <HStack><Text>车况时间</Text><Spacer /><Text foregroundStyle="secondaryLabel" monospacedDigit>{status.value.ts ? fmtDateTime(status.value.ts) : "—"}</Text></HStack>
        <Text font="caption2" foregroundStyle="secondaryLabel" monospacedDigit>{status.value.raw.join("\n")}</Text>
      </> : null}
    </Section> : null}

    {provider.credentialFields.map(f => <Section
      key={f.key}
      header={<Text>{connected ? `更换 ${f.label}` : f.label}</Text>}
      {...(f.hint ? { footer: <Text>{f.hint}</Text> } : {})}
    >
      <TextField
        title={f.label}
        value={input[f.key] || ""}
        onChanged={v => setInput({ ...input, [f.key]: v })}
        prompt={f.placeholder}
        {...(f.multiline ? { axis: "vertical" as const, lineLimit: { min: 1, max: 4 } } : {})}
        autocorrectionDisabled
        textInputAutocapitalization="never"
      />
      <Button title="从剪贴板粘贴" systemImage="doc.on.clipboard" action={() => paste(f.key)} />
    </Section>)}
    <Section>
      <Button title={busy ? "验证中…" : "验证并读取车辆"} systemImage="checkmark.shield" action={connect} disabled={busy || provider.credentialFields.some(f => !(input[f.key] || "").trim())} />
      {connected ? <Button title={`断开${provider.name}`} role="destructive" action={disconnect} /> : null}
    </Section>
  </List>
}
