// 设置 › 识别（设计文档 16.9 节）：识别方式只选一种——本机或大模型（Azure OpenAI）；以后可能加小熊识别。
// 选大模型时才显示 Azure 的设置。凭据存钥匙串，界面上不显示 key 的明文
import { Button, List, Picker, ProgressView, SecureField, Section, Text, TextField, useState } from "scripting"
import {
  AppData, AzureConfig, azureConfig, errorText, maskSecret, OCR_ENGINE_TITLES, OcrEngine, setAzureConfig, testAzure, updateSettings,
} from "../common/model"
import { AppActions, FieldRow, showError } from "./components"

const ENGINES: OcrEngine[] = ["local", "azure"]

export function RecognizeSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [saved, setSaved] = useState<AzureConfig | null>(() => azureConfig())
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "")
  const [deployment, setDeployment] = useState(saved?.deployment ?? "")
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const current = (): AzureConfig => ({ endpoint, deployment, key: key.trim() || saved?.key || "" })
  const changed = endpoint !== (saved?.endpoint ?? "") || deployment !== (saved?.deployment ?? "") || !!key.trim()

  function save() {
    try {
      setAzureConfig(current())
      setSaved(azureConfig())
      setKey("")
      setStatus({ ok: true, text: "已保存" })
    } catch (e) {
      void showError("保存失败", e)
    }
  }

  async function test() {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ ok: true, text: `连接成功：${await testAzure(current())}` })
    } catch (e) {
      setStatus({ ok: false, text: `连接失败：${errorText(e)}` })
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    const i = await Dialog.actionSheet({ title: "删除 Azure OpenAI 设置？", actions: [{ label: "删除", destructive: true }] })
    if (i !== 0) return
    setAzureConfig(null)
    setSaved(null)
    setEndpoint("")
    setDeployment("")
    setKey("")
    setStatus(null)
  }

  const ready = !!(endpoint.trim() && deployment.trim() && (key.trim() || saved?.key))
  const engine = data.ledger.settings.ocr_engine
  const footer = engine === "local"
    ? "iOS 文字识别：在手机上完成，不需要网络，图片不离开手机。"
    : saved ? "每张图片都会发给 Azure OpenAI 识别，需要网络。" : "需要填写下面的 Azure OpenAI 设置。"

  // 直接用 JSX 片段，不定义成组件：组件在每次渲染时会重新创建，输入框会失去焦点
  const azureFields = <>
    <Section key="azure" header={<Text>Azure OpenAI</Text>}>
      <FieldRow title="终结点">
        <TextField title="终结点" value={endpoint} onChanged={setEndpoint} prompt="https://….openai.azure.com" keyboardType="URL" autocorrectionDisabled textInputAutocapitalization="never" multilineTextAlignment="trailing" />
      </FieldRow>
      <FieldRow title="部署名">
        <TextField title="部署名" value={deployment} onChanged={setDeployment} prompt="gpt-4.1" autocorrectionDisabled textInputAutocapitalization="never" multilineTextAlignment="trailing" />
      </FieldRow>
      <FieldRow title="key">
        <SecureField title="key" value={key} onChanged={setKey} prompt={saved?.key ? maskSecret(saved.key) : "API key"} multilineTextAlignment="trailing" />
      </FieldRow>
    </Section>
    <Section key="azure-actions">
      <Button title="保存" systemImage="checkmark" action={save} disabled={!changed} />
      <Button title={busy ? "测试中…" : "测试连接"} systemImage="bolt.horizontal" action={test} disabled={!ready || busy} />
      {busy ? <ProgressView /> : null}
      {status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null}
      {saved ? <Button title="删除 Azure OpenAI 设置" role="destructive" action={remove} /> : null}
    </Section>
  </>

  return <List navigationTitle="识别" navigationBarTitleDisplayMode="inline">
    <Section key="engine" header={<Text>识别方式</Text>} footer={<Text>{footer}</Text>}>
      <Picker title="识别方式" value={engine} onChanged={(v: string) => app.setData(updateSettings(app.getData(), { ocr_engine: v as OcrEngine }))} pickerStyle="inline" labelsHidden>
        {ENGINES.map(e => <Text key={e} tag={e}>{OCR_ENGINE_TITLES[e]}</Text>)}
      </Picker>
    </Section>
    {engine === "azure" ? azureFields : null}
  </List>
}
