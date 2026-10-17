// 设置 › 车辆数据（按提供方的定义生成，不认识具体品牌）
import { Button, HStack, List, Menu, ProgressView, Section, Spacer, Text, TextField, VStack, useEffect, useState } from "scripting"
import {
  AppData, connectProvider, disconnectProvider, providerCredential, providerVehicles, RemoteVehicle, updateVehicle, VehicleDataProvider,
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
      // 只有一辆远端车、一辆车账本车辆且都没关联时，直接关联
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
    const t = await Clipboard.getText()
    if (t) setInput({ ...input, [key]: t })
  }

  async function disconnect() {
    const ok = await Dialog.confirm({ title: `断开${provider.name}`, message: "删除凭据，并解除所有车辆的关联。记录不受影响。", confirmLabel: "断开" })
    if (!ok) return
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
            {data.ledger.vehicles.map(v => <Button title={v.name} systemImage={owner?.id === v.id ? "checkmark" : undefined} action={() => link(rv, v.id)} />)}
            {owner ? <Button title="解除关联" role="destructive" action={() => link(rv, null)} /> : null}
          </Menu>
        </HStack>
      })}
    </Section> : null}

    {provider.credentialFields.map(f => <Section header={<Text>{connected ? `更换 ${f.label}` : f.label}</Text>} footer={f.hint ? <Text>{f.hint}</Text> : undefined}>
      <TextField title={f.label} value={input[f.key] || ""} onChanged={v => setInput({ ...input, [f.key]: v })} prompt={f.placeholder} axis={f.multiline ? "vertical" : undefined} autocorrectionDisabled textInputAutocapitalization="never" />
      <Button title="从剪贴板粘贴" systemImage="doc.on.clipboard" action={() => paste(f.key)} />
    </Section>)}
    <Section>
      <Button title={busy ? "验证中…" : "验证并读取车辆"} systemImage="checkmark.shield" action={connect} disabled={busy || provider.credentialFields.some(f => !(input[f.key] || "").trim())} />
      {connected ? <Button title={`断开${provider.name}`} role="destructive" action={disconnect} /> : null}
    </Section>
  </List>
}
