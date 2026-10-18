// 设置 › 小熊油耗
import { Button, Capsule, HStack, List, ProgressView, Section, Spacer, Text, TextField, Toggle, useState, VStack } from "scripting"
import {
  addXxyhCar, AppData, connectXxyh, disconnectXxyh, errorText, fmtDateTime, maskSecret, pendingCount, setXxyhCarIgnored, updateSettings, xxyhConnected,
  xxyhIgnoredCars, xxyhNewCars, xxyhToken,
} from "../common/model"
import { AppActions, showError } from "./components"

function Info({ title, value, color }: { title: string; value: string; color?: "systemRed" | "systemOrange" | "secondaryLabel" }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle={color || "secondaryLabel"} multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function XxyhSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null)
  const connected = xxyhConnected(data)
  const x = data.xxyh

  async function paste() {
    const t = await Pasteboard.getString()
    if (t) setInput(t)
  }

  async function connect() {
    setBusy("connect")
    try {
      const r = await connectXxyh(app.getData(), input)
      app.setData(r.data)
      setInput("")
      await Dialog.alert({ title: "已连接", message: r.message })
    } catch (e) {
      await Dialog.alert({ title: "连接失败", message: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  async function syncNow() {
    setBusy("sync")
    try { await app.sync(true) } finally { setBusy(null) }
  }

  async function disconnect() {
    const n = pendingCount(app.getData())
    const choice = await Dialog.actionSheet({
      title: "断开小熊油耗？",
      message: `${n ? `还有 ${n} 条修改没有上传，断开后不会再上传。\n` : ""}当前显示的记录会复制到本机，之后只在本机保存；云端数据不受影响。`,
      actions: [{ label: "断开", destructive: true }],
    })
    if (choice !== 0) return
    try { app.setData(disconnectXxyh(app.getData())) } catch (e) { await showError("断开失败", e) }
  }

  const credential = <Section header={<Text>{connected ? "更换凭据" : "凭据"}</Text>} footer={<Text>粘贴 BoxJS 中的 xxyh_auth（由「小熊油耗 · 凭据抓取」在 App 会员页抓取），或单独的 authToken。凭据只保存在本机钥匙串。</Text>}>
    <TextField title="凭据" value={input} onChanged={setInput} prompt="xxyh_auth 或 authToken" axis="vertical" lineLimit={{ min: 1, max: 4 }} autocorrectionDisabled textInputAutocapitalization="never" />
    <Button title="从剪贴板粘贴" systemImage="doc.on.clipboard" action={paste} />
    <Button title={connected ? "使用新凭据" : "连接"} systemImage="link" action={connect} disabled={!input.trim() || busy != null} />
    {busy === "connect" ? <HStack><Spacer /><ProgressView /><Spacer /></HStack> : null}
  </Section>

  if (!connected) {
    return <List navigationTitle="小熊油耗" navigationBarTitleDisplayMode="inline">
      <Section footer={<Text>连接后，小熊里的车辆和全部历史会显示在油记里；之后的新增、修改、删除会上传为新的云备份版本，官方 App 和网页版都能看到。</Text>}>
        <Text>未连接</Text>
      </Section>
      {credential}
    </List>
  }

  const linked = data.mirror.cars.map(c => ({ car: c, vehicle: data.ledger.vehicles.find(v => v.xxyh_car === c.uuid) }))
  const fresh = xxyhNewCars(data)
  const ignored = xxyhIgnoredCars(data)
  return <List navigationTitle="小熊油耗" navigationBarTitleDisplayMode="inline">
    <Section title="账号">
      <Info title="账号" value={[x.nickname, x.account_id && `ID ${x.account_id}`].filter(Boolean).join(" · ") || "—"} />
      <Info title="凭据" value={maskSecret(xxyhToken())} />
      <Info title="云端版本" value={x.base_version ? `v${x.base_version}` : "—"} />
      <Info title="上次拉取" value={x.last_pull_ts ? fmtDateTime(x.last_pull_ts) : "—"} />
      <Info title="上次上传" value={x.last_push_ts ? fmtDateTime(x.last_push_ts) : "—"} />
      <Info title="待上传" value={`${x.ops.length} 条`} color={x.ops.length ? "systemOrange" : undefined} />
      {x.last_error ? <Info title="上次错误" value={x.last_error} color="systemRed" /> : null}
    </Section>
    {data.mirror.conflicts.length || x.last_conflicts.length ? <Section title="冲突">
      {data.mirror.conflicts.map(c => <Text font="footnote" foregroundStyle="systemOrange">{`待上传：${c.reason}`}</Text>)}
      {x.last_conflicts.map(t => <Text font="footnote" foregroundStyle="secondaryLabel">{`上次上传时已放弃：${t}`}</Text>)}
    </Section> : null}
    <Section footer={<Text>打开 App、回到前台时会自动拉取。官方 App 登录时会上传它本地的整份数据，可能覆盖油记的修改，建议不再在官方 App 里登录。</Text>}>
      <Toggle title="保存后自动上传" value={data.ledger.settings.xxyh_auto_upload} onChanged={v => app.setData(updateSettings(app.getData(), { xxyh_auto_upload: v }))} />
      <Button title={busy === "sync" ? "同步中…" : "立即同步"} systemImage="arrow.triangle.2.circlepath" action={syncNow} disabled={busy != null} />
    </Section>
    <Section key="cars" header={<Text>小熊里的车辆</Text>} footer={<Text>在官方 App 或网页版新建的车不会自动加入油记，由你决定。</Text>}>
      {linked.filter(x => x.vehicle).map(({ car, vehicle }) => <Info key={car.uuid} title={car.name} value={`${car.fuel_count} 次加油 · 油记：${vehicle!.name}`} />)}
      {fresh.map(car => <VStack key={car.uuid} alignment="leading" spacing={8}>
        <HStack spacing={8}>
          <Text>{car.name}</Text>
          <Text font="caption" fontWeight="semibold" foregroundStyle="systemOrange" padding={{ horizontal: 8, vertical: 2 }} background={<Capsule fill="rgba(255,149,0,0.16)" />}>新</Text>
          <Spacer />
          <Text font="footnote" foregroundStyle="secondaryLabel">{`${car.fuel_count} 次加油`}</Text>
        </HStack>
        {/* 行里有多个按钮时每个都要指定 buttonStyle，否则点整行会同时触发 */}
        <HStack spacing={10}>
          <Button title="添加到油记" buttonStyle="borderedProminent" action={() => app.setData(addXxyhCar(app.getData(), car.uuid))} />
          <Button title="忽略" buttonStyle="bordered" action={() => app.setData(setXxyhCarIgnored(app.getData(), car.uuid, true))} />
        </HStack>
      </VStack>)}
    </Section>
    {ignored.length ? <Section key="ignored" header={<Text>已忽略</Text>} footer={<Text>转为本机车辆的小熊车也在这里。恢复后重新列为新车，可以再添加到油记。</Text>}>
      {ignored.map(car => <HStack key={car.uuid}>
        <VStack alignment="leading" spacing={2}>
          <Text foregroundStyle="secondaryLabel">{car.name}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{`${car.fuel_count} 次加油`}</Text>
        </VStack>
        <Spacer />
        <Button title="恢复" buttonStyle="bordered" action={() => app.setData(setXxyhCarIgnored(app.getData(), car.uuid, false))} />
      </HStack>)}
    </Section> : null}
    {credential}
    <Section>
      <Button title="断开小熊油耗" role="destructive" action={disconnect} />
    </Section>
  </List>
}
