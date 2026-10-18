// 设置 › 识别：本机识别读不全时用的 Azure OpenAI（设计文档 16.9 节）。凭据存钥匙串，界面上不显示 key 的明文
import { Button, HStack, List, ProgressView, SecureField, Section, Spacer, Text, TextField, useState } from "scripting"
import { AzureConfig, azureConfig, errorText, maskSecret, setAzureConfig, testAzure } from "../common/model"
import { FieldRow, showError } from "./components"

export function RecognizeSettings() {
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

  return <List navigationTitle="识别" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>本机识别</Text>}>
      <HStack><Text>iOS 文字识别</Text><Spacer /><Text foregroundStyle="secondaryLabel">始终先用</Text></HStack>
    </Section>
    <Section header={<Text>备用：Azure OpenAI</Text>}>
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
    <Section>
      <Button title="保存" systemImage="checkmark" action={save} disabled={!changed} />
      <Button title={busy ? "测试中…" : "测试连接"} systemImage="bolt.horizontal" action={test} disabled={!ready || busy} />
      {busy ? <ProgressView /> : null}
      {status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null}
      {saved ? <Button title="删除 Azure OpenAI 设置" role="destructive" action={remove} /> : null}
    </Section>
  </List>
}
