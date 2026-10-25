// 设置 › 小熊油耗（2.0 设计第 8 节）：凭据、从小熊导入（勾选还没导入的车）、断开。数据都存在油记里，不再自动同步；导出在 2.0.0-beta.6
import { Button, HStack, Image, List, ProgressView, Section, Spacer, Text, TextField, useState, VStack } from "scripting"
import {
  AppData, connectXxyh, disconnectXxyh, errorText, fetchXxyhCloud, fmtDateTime, importXxyhCars, maskSecret, XxyhCloud, xxyhConnected, xxyhToken,
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
  const [busy, setBusy] = useState<"connect" | "load" | "import" | null>(null)
  const [cloud, setCloud] = useState<XxyhCloud | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const connected = xxyhConnected()
  const x = data.xxyh

  async function paste() {
    const t = await Pasteboard.getString()
    if (t) setInput(t)
  }

  function showCloud(c: XxyhCloud) {
    setCloud(c)
    // 油记里还没有车辆时（第一次连接）默认全选
    setPicked(app.getData().ledger.vehicles.length ? [] : c.cars.map(car => car.uuid))
  }

  async function connect() {
    setBusy("connect")
    try {
      const r = await connectXxyh(app.getData(), input)
      app.setData(r.data)
      setInput("")
      showCloud(r.cloud)
      if (!r.cloud.cars.length) await Dialog.alert({ title: "已连接", message: `小熊云端 v${r.cloud.version} 里的车都已经在油记里了。` })
    } catch (e) {
      await Dialog.alert({ title: "连接失败", message: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  async function load() {
    setBusy("load")
    try {
      showCloud(await fetchXxyhCloud(app.getData()))
    } catch (e) {
      await Dialog.alert({ title: "读取失败", message: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  async function importPicked() {
    if (!cloud || !picked.length) return
    setBusy("import")
    try {
      const r = importXxyhCars(app.getData(), cloud, picked)
      app.setData(r.data)
      setCloud({ ...cloud, cars: cloud.cars.filter(c => !picked.includes(c.uuid)) })
      setPicked([])
      await Dialog.alert({ title: "已导入", message: r.added.map(a => `「${a.name}」${a.records} 条记录`).join("\n") || "没有要导入的车" })
    } catch (e) {
      await showError("导入失败", e)
    } finally {
      setBusy(null)
    }
  }

  async function disconnect() {
    const choice = await Dialog.actionSheet({
      title: "断开小熊油耗？",
      message: "删除凭据。数据都在油记里，不受影响；小熊云端也不变。",
      actions: [{ label: "断开", destructive: true }],
    })
    if (choice !== 0) return
    try {
      app.setData(disconnectXxyh(app.getData()))
      setCloud(null)
    } catch (e) {
      await showError("断开失败", e)
    }
  }

  const toggle = (uuid: string) => setPicked(picked.includes(uuid) ? picked.filter(u => u !== uuid) : [...picked, uuid])

  const credential = <Section header={<Text>{connected ? "更换凭据" : "凭据"}</Text>} footer={<Text>粘贴 BoxJS 中的 xxyh_auth（由「小熊油耗 · 凭据抓取」在 App 会员页抓取），或单独的 authToken。凭据只保存在本机钥匙串。</Text>}>
    <TextField title="凭据" value={input} onChanged={setInput} prompt="xxyh_auth 或 authToken" axis="vertical" lineLimit={{ min: 1, max: 4 }} autocorrectionDisabled textInputAutocapitalization="never" />
    <Button title="从剪贴板粘贴" systemImage="doc.on.clipboard" action={paste} />
    <Button title={connected ? "使用新凭据" : "连接"} systemImage="link" action={connect} disabled={!input.trim() || busy != null} />
    {busy === "connect" ? <HStack><Spacer /><ProgressView /><Spacer /></HStack> : null}
  </Section>

  const cars = cloud ? <Section key="cars" header={<Text>{`小熊里还没导入的车 · 云端 v${cloud.version}`}</Text>}
    footer={<Text>导入后记录都存在油记里，小熊里的数据不动。已经导入的车不再导入；要重来，先在油记里删掉这辆车。</Text>}>
    {cloud.cars.length ? cloud.cars.map(car => <Button key={car.uuid} action={() => toggle(car.uuid)}>
      <HStack foregroundStyle="label">
        <Image systemName={picked.includes(car.uuid) ? "checkmark.circle.fill" : "circle"} foregroundStyle={picked.includes(car.uuid) ? "systemBlue" : "tertiaryLabel"} />
        <VStack alignment="leading" spacing={2}>
          <Text>{car.name}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{`${car.fuel_count} 次加油 · ${car.expense_count} 笔费用`}</Text>
        </VStack>
        <Spacer />
      </HStack>
    </Button>) : <Text foregroundStyle="secondaryLabel">都已经导入了</Text>}
    {cloud.cars.length ? <Button title={busy === "import" ? "导入中…" : `导入选中的 ${picked.length} 辆`} systemImage="square.and.arrow.down" action={importPicked} disabled={!picked.length || busy != null} /> : null}
  </Section> : null

  if (!connected) {
    return <List navigationTitle="小熊油耗" navigationBarTitleDisplayMode="inline">
      <Section footer={<Text>连接后选择要导入的车，小熊里的记录会复制到油记，以后都存在油记里；需要时再手动导出到小熊。</Text>}>
        <Text>未连接</Text>
      </Section>
      {cars}
      {credential}
    </List>
  }

  return <List navigationTitle="小熊油耗" navigationBarTitleDisplayMode="inline">
    <Section title="账号">
      <Info title="账号" value={[x.nickname, x.account_id && `ID ${x.account_id}`].filter(Boolean).join(" · ") || "—"} />
      <Info title="凭据" value={maskSecret(xxyhToken())} />
      <Info title="上次导入或导出" value={x.last_version != null ? `云端 v${x.last_version}` : "—"} />
      <Info title="上次导出" value={x.last_export_ts ? fmtDateTime(x.last_export_ts) : "还没有导出过"} />
      {x.last_error ? <Info title="上次错误" value={x.last_error} color="systemRed" /> : null}
    </Section>
    {cars ?? <Section key="import" footer={<Text>读取小熊云端最新的版本，列出还没导入的车。</Text>}>
      <Button title={busy === "load" ? "读取中…" : "从小熊油耗导入…"} systemImage="square.and.arrow.down" action={load} disabled={busy != null} />
    </Section>}
    {credential}
    <Section>
      <Button title="断开小熊油耗" role="destructive" action={disconnect} />
    </Section>
  </List>
}
