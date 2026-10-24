// 设置 › 油站搜索：要不要搜附近的油站、高德 Web 服务 key（保存前先实际查一次附近加油站）。key 存钥匙串，界面上不显示明文
import { Button, HStack, List, ProgressView, SecureField, Section, Spacer, Text, Toggle, useState } from "scripting"
import { amapKey, AppData, errorText, maskSecret, searcherName, setAmapKey, testAmapKey, updateSettings } from "../common/model"
import { AppActions, FieldRow, showError } from "./components"

export function StationSearchSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [saved, setSaved] = useState<string | null>(() => amapKey())
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  function store(key: string) {
    try {
      setAmapKey(key)
      setSaved(amapKey())
      setInput("")
      app.setData(app.getData()) // 刷新设置首页的显示
    } catch (e) {
      void showError("保存失败", e)
    }
  }

  async function verifyAndSave() {
    const key = input.trim()
    if (!key) return
    setBusy(true)
    setStatus(null)
    try {
      const msg = await testAmapKey(key)
      store(key)
      setStatus({ ok: true, text: `已保存：${msg}` })
    } catch (e) {
      const reason = errorText(e)
      setStatus({ ok: false, text: `无法使用：${reason}` })
      const i = await Dialog.actionSheet({ title: "高德 key 无法使用", message: reason, actions: [{ label: "仍然保存" }] })
      if (i === 0) store(key)
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    if (!saved) return
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ ok: true, text: `可用：${await testAmapKey(saved)}` })
    } catch (e) {
      setStatus({ ok: false, text: `无法使用：${errorText(e)}` })
    } finally {
      setBusy(false)
    }
  }

  async function paste() {
    const t = await Pasteboard.getString()
    if (t) setInput(t.trim())
  }

  async function remove() {
    const i = await Dialog.actionSheet({ title: "删除高德 key？", actions: [{ label: "删除", destructive: true }] })
    if (i !== 0) return
    store("")
    setStatus(null)
  }

  return <List navigationTitle="油站搜索" navigationBarTitleDisplayMode="inline">
    <Section key="mode" header={<Text>附近油站</Text>} footer={<Text>{`当前：${searcherName(data)}。有高德 key 时用高德，否则用小熊油耗的附近油站；关掉后只用我的油站。`}</Text>}>
      <Toggle title="搜索附近的油站" value={data.ledger.settings.station_search !== "off"} onChanged={v => app.setData(updateSettings(app.getData(), { station_search: v ? "auto" : "off" }))} />
    </Section>
    <Section key="amap" header={<Text>高德 Web 服务 key</Text>} footer={<Text>用于查找附近的新油站。</Text>}>
      {saved ? <HStack><Text>当前</Text><Spacer /><Text foregroundStyle="secondaryLabel">{maskSecret(saved)}</Text></HStack> : null}
      <FieldRow title={saved ? "新 key" : "key"}>
        <SecureField title="key" value={input} onChanged={setInput} prompt="粘贴高德 key" multilineTextAlignment="trailing" />
      </FieldRow>
      <Button title="从剪贴板粘贴" systemImage="doc.on.clipboard" action={paste} />
    </Section>
    <Section key="actions">
      <Button title={busy && input.trim() ? "验证中…" : "验证并保存"} systemImage="checkmark" action={verifyAndSave} disabled={!input.trim() || busy} />
      {saved ? <Button title={busy && !input.trim() ? "测试中…" : "测试高德 key"} systemImage="bolt.horizontal" action={test} disabled={busy} /> : null}
      {busy ? <ProgressView /> : null}
      {status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null}
      {saved ? <Button title="删除高德 key" role="destructive" action={remove} /> : null}
    </Section>
  </List>
}
