// 备份密码（2.0 设计第 6 节）：打开「包含凭据」或修改备份密码时弹出。密码只存在这台手机的钥匙串，之后的每一份备份都用它加密凭据。
// 保存成功时 dismiss(true)，取消时 dismiss(null)。
import { Button, Form, Navigation, NavigationStack, SecureField, Section, Text, useState } from "scripting"
import { passwordProblem, setBackupPassword } from "../common/model"
import { FieldRow, showError } from "./components"

export function BackupPasswordSheet({ change }: { change: boolean }) {
  const dismiss = Navigation.useDismiss()
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const problem = passwordProblem(password, again)

  async function save() {
    try {
      setBackupPassword(password)
      dismiss(true)
    } catch (e) {
      await showError("没能保存备份密码", e)
    }
  }

  return <NavigationStack presentationDragIndicator="visible">
    <Form
      navigationTitle={change ? "修改备份密码" : "备份密码"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="完成" action={save} disabled={problem != null} />,
      }}
    >
      <Section key="password" footer={<Text>{`至少 6 位。之后的每一份备份都用它加密凭据${change ? "；之前的备份还要用旧密码恢复凭据" : ""}。

密码只存在这台手机上，不会放进备份。换手机恢复时要输入它；忘了密码，数据照样能恢复，凭据需要重新填写。`}</Text>}>
        <FieldRow title="备份密码">
          <SecureField title="备份密码" value={password} onChanged={setPassword} prompt="至少 6 位" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="再输入一次">
          <SecureField title="再输入一次" value={again} onChanged={setAgain} prompt="确认密码" multilineTextAlignment="trailing" />
        </FieldRow>
        {password && again && problem ? <Text font="footnote" foregroundStyle="systemRed">{problem}</Text> : null}
      </Section>
    </Form>
  </NavigationStack>
}
