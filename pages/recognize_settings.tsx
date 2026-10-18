// 设置 › 识别（设计文档 16.9 节）：识别方式只选一种——本机，或大模型（Azure OpenAI、Scripting 助手）；以后可能加小熊识别。
// 选 Azure 时才显示 Azure 的设置，凭据存钥匙串，界面上不显示 key 的明文。
// 选 Scripting 助手时用 Scripting 里配置的模型账号，油记只记账号编号和模型名。
import { Button, HStack, List, Picker, ProgressView, SecureField, Section, Spacer, Text, TextField, useEffect, useState } from "scripting"
import {
  AppData, assistantAvailable, assistantModelInfo, AssistantModel, AzureConfig, azureConfig, errorText, maskSecret, OCR_ENGINE_TITLES, OcrEngine,
  pickAssistantModel, setAzureConfig, testAssistant, testAzure, updateSettings,
} from "../common/model"
import { AppActions, FieldRow, showError } from "./components"

const ENGINES: OcrEngine[] = ["local", "azure", "assistant"]

const FOOTERS: Record<OcrEngine, string> = {
  local: "iOS 文字识别：在手机上完成，不需要网络，图片不离开手机。",
  azure: "每张图片都会发给 Azure OpenAI 识别，需要网络。",
  assistant: "每张图片都会发给在 Scripting 中设置的模型账号（如 OpenAI）识别，需要网络。油记不保存它的凭据。",
}

export function RecognizeSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [saved, setSaved] = useState<AzureConfig | null>(() => azureConfig())
  const [endpoint, setEndpoint] = useState(saved?.endpoint ?? "")
  const [deployment, setDeployment] = useState(saved?.deployment ?? "")
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)
  /** 选中的模型能不能看图；null：不知道（没选、账号已删除或还在读取） */
  const [supportsImages, setSupportsImages] = useState<boolean | null>(null)

  const engine = data.ledger.settings.ocr_engine
  const model = data.ledger.settings.ocr_assistant

  useEffect(() => {
    setSupportsImages(null)
    if (engine !== "assistant" || !model) return
    assistantModelInfo(model).then(info => setSupportsImages(info ? info.supportsImages : null)).catch(() => setSupportsImages(null))
  }, [engine, model?.providerID, model?.modelId])

  const current = (): AzureConfig => ({ endpoint, deployment, key: key.trim() || saved?.key || "" })
  const changed = endpoint !== (saved?.endpoint ?? "") || deployment !== (saved?.deployment ?? "") || !!key.trim()

  function setEngine(v: string) {
    setStatus(null)
    app.setData(updateSettings(app.getData(), { ocr_engine: v as OcrEngine }))
  }

  function setModel(m: AssistantModel | null) {
    setStatus(null)
    app.setData(updateSettings(app.getData(), { ocr_assistant: m }))
  }

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

  async function run(test: () => Promise<string>) {
    setBusy(true)
    setStatus(null)
    try {
      setStatus({ ok: true, text: `连接成功：${await test()}` })
    } catch (e) {
      setStatus({ ok: false, text: `连接失败：${errorText(e)}` })
    } finally {
      setBusy(false)
    }
  }

  async function chooseModel() {
    try {
      const m = await pickAssistantModel(model)
      if (m) setModel(m)
    } catch (e) {
      await showError("无法选择模型", e)
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
  const footer = engine === "azure" && !saved ? "需要填写下面的 Azure OpenAI 设置。" : FOOTERS[engine]
  const statusText = status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null

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
      <Button title={busy ? "测试中…" : "测试连接"} systemImage="bolt.horizontal" action={() => run(() => testAzure(current()))} disabled={!ready || busy} />
      {busy ? <ProgressView /> : null}
      {statusText}
      {saved ? <Button title="删除 Azure OpenAI 设置" role="destructive" action={remove} /> : null}
    </Section>
  </>

  const available = assistantAvailable()
  const assistantFields = <>
    <Section
      key="assistant"
      header={<Text>Scripting 助手</Text>}
      footer={<Text>{available ? "账号和模型在 Scripting 的设置中管理。没有选择时用 Scripting 的默认模型。" : "Scripting 助手不可用：请先在 Scripting 的设置中添加模型账号。"}</Text>}
    >
      <Button action={chooseModel} disabled={!available}>
        <HStack>
          <Text foregroundStyle="label">模型</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel" lineLimit={1}>{model ? `${model.name} · ${model.modelId}` : "Scripting 默认"}</Text>
        </HStack>
      </Button>
      {supportsImages === false ? <Text font="footnote" foregroundStyle="systemRed">这个模型不支持图片，请换一个。</Text> : null}
      {model ? <Button title="改用 Scripting 默认模型" action={() => setModel(null)} /> : null}
    </Section>
    <Section key="assistant-actions">
      <Button title={busy ? "测试中…" : "测试连接"} systemImage="bolt.horizontal" action={() => run(() => testAssistant(model))} disabled={!available || busy} />
      {busy ? <ProgressView /> : null}
      {statusText}
    </Section>
  </>

  return <List navigationTitle="识别" navigationBarTitleDisplayMode="inline">
    <Section key="engine" header={<Text>识别方式</Text>} footer={<Text>{footer}</Text>}>
      <Picker title="识别方式" value={engine} onChanged={setEngine} pickerStyle="inline" labelsHidden>
        {ENGINES.map(e => <Text key={e} tag={e}>{OCR_ENGINE_TITLES[e]}</Text>)}
      </Picker>
    </Section>
    {engine === "azure" ? azureFields : null}
    {engine === "assistant" ? assistantFields : null}
  </List>
}
