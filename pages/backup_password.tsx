// 备份密码（2.0 设计第 6 节）：打开「包含凭据」或修改备份密码时弹出。由密码生成一次密钥（约 1 秒）存在这台手机的钥匙串，之后的每一份备份都用它加密凭据。
// 保存成功时 dismiss(true)，取消时 dismiss(null)。
import { Button, Form, HStack, Navigation, NavigationStack, ProgressView, SecureField, Section, Text, useState } from "scripting"
import { passwordProblem, setBackupPassword } from "../common/model"
import { FieldRow, showError } from "./components"

export function BackupPasswordSheet({ change }: { change: boolean }) {
  const dismiss = Navigation.useDismiss()
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [busy, setBusy] = useState(false)
  const problem = passwordProblem(password, again)

  async function save() {
    setBusy(true)
    try {
      await setBackupPassword(password)
      dismiss(true)
    } catch (e) {
      setBusy(false)
      await showError("没能保存备份密码", e)
    }
  }

  return <NavigationStack presentationDragIndicator="visible">
    <Form
      navigationTitle={change ? "修改备份密码" : "备份密码"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} disabled={busy} />,
        confirmationAction: <Button title="完成" action={save} disabled={problem != null || busy} />,
      }}
    >
      <Section key="password" footer={<Text>{`至少 6 位。之后的每一份备份都用它加密凭据${change ? "；之前的备份还要用旧密码恢复凭据" : ""}。

密码本身不保存，也不放进备份；这台手机只存由它生成的密钥。换手机恢复时要输入密码；忘了密码，数据照样能恢复，凭据需要重新填写。`}</Text>}>
        <FieldRow title="备份密码">
          <SecureField title="备份密码" value={password} onChanged={setPassword} prompt="至少 6 位" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="再输入一次">
          <SecureField title="再输入一次" value={again} onChanged={setAgain} prompt="确认密码" multilineTextAlignment="trailing" />
        </FieldRow>
        {password && again && problem ? <Text font="footnote" foregroundStyle="systemRed">{problem}</Text> : null}
        {busy ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">正在生成密钥…</Text></HStack> : null}
      </Section>
    </Form>
  </NavigationStack>
}
