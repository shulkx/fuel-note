// 设置 › 备份与恢复（common/backup.ts）：备份到「文件」（凭据用密码加密）、从备份恢复（替换本机数据）、导出记录。
// 连接了小熊的车以云端为准：恢复后重新下载云端最新版本，不会用备份覆盖云端。
import { Button, HStack, List, ProgressView, SecureField, Section, Spacer, Text, Toggle, useState } from "scripting"
import {
  AppData, BackupFile, exportData, fmtDateTime, passwordProblem, pickBackupFile, restoreBackup, saveBackupToFiles, storedSecretLabels,
  summarizeBackup,
} from "../common/model"
import { AppActions, FieldRow, showError } from "./components"

function Info({ title, value }: { title: string; value: string }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function BackupSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [labels] = useState(() => storedSecretLabels())
  const [withSecrets, setWithSecrets] = useState(labels.length > 0)
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [picked, setPicked] = useState<{ name: string; backup: BackupFile } | null>(null)
  const [restorePassword, setRestorePassword] = useState("")
  const [keepOps, setKeepOps] = useState(true)
  const [busy, setBusy] = useState<"backup" | "restore" | "upload" | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  // 用最新数据：「立即上传」之后这里要跟着变
  const pending = app.getData().xxyh.ops.length
  const secretsOn = withSecrets && labels.length > 0
  const problem = secretsOn ? passwordProblem(password, again) : null

  async function backup() {
    setBusy("backup")
    setStatus(null)
    try {
      const saved = await saveBackupToFiles(app.getData(), secretsOn ? password : null)
      if (saved) {
        setStatus({ ok: true, text: secretsOn ? `已备份，凭据已加密（${labels.join("、")}）。请记住备份密码。` : "已备份，不含凭据。" })
        setPassword("")
        setAgain("")
      }
    } catch (e) {
      setStatus({ ok: false, text: `备份失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  async function upload() {
    setBusy("upload")
    try {
      await app.sync(true)
    } finally {
      setBusy(null)
    }
  }

  async function pick() {
    setStatus(null)
    try {
      const r = await pickBackupFile()
      if (!r) return
      setPicked(r)
      setRestorePassword("")
      setKeepOps(true)
    } catch (e) {
      setPicked(null)
      await showError("无法读取备份", e)
    }
  }

  async function restore() {
    if (!picked) return
    const i = await Dialog.actionSheet({
      title: "用这个备份替换本机数据？",
      message: "本机的车辆、记录和设置会被替换，当前数据会先另存一份。连接了小熊油耗的车随后会重新下载云端最新版本。",
      actions: [{ label: "恢复", destructive: true }],
    })
    if (i !== 0) return
    setBusy("restore")
    setStatus(null)
    try {
      const r = await restoreBackup(picked.backup, { password: picked.backup.secrets && restorePassword ? restorePassword : null, keepOps })
      app.setData(r.data)
      setPicked(null)
      setRestorePassword("")
      const file = r.safetyPath.split("/").pop()
      setStatus({
        ok: true,
        text: `已恢复${r.secrets.length ? `，包括凭据（${r.secrets.join("、")}）` : ""}。原来的数据另存为「文件」App › Scripting › FuelNote › ${file}。`,
      })
      // 重新下载小熊云端的最新版本；保留了未上传的修改且开了自动上传时一并上传
      await app.sync(keepOps && r.data.xxyh.ops.length > 0 && r.data.ledger.settings.xxyh_auto_upload)
    } catch (e) {
      setStatus({ ok: false, text: `恢复失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  async function doExport() {
    try {
      const path = exportData(app.getData())
      await ShareSheet.present([path])
    } catch (e) {
      await showError("导出失败", e)
    }
  }

  const backupFooter = "备份车辆、记录、油站、保险明细、设置和小熊油耗的同步状态，保存到「文件」。建议存到 iCloud 云盘，删除脚本或换手机后仍然可以恢复。保单原件（PDF）不在备份里，请另外保存。"
    + (secretsOn ? `

${labels.join("、")} 的凭据用备份密码加密（AES-256-GCM）后放进备份，记录不加密。恢复时需要输入这个密码；忘记密码只能恢复记录，凭据需要重新填写。` : "")
  const s = picked ? summarizeBackup(picked.backup) : null
  const statusText = status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null

  return <List navigationTitle="备份与恢复" navigationBarTitleDisplayMode="inline">
    <Section key="backup" header={<Text>备份</Text>} footer={<Text>{backupFooter}</Text>}>
      {pending ? <Text font="footnote" foregroundStyle="systemOrange">{`有 ${pending} 条修改还没上传到小熊油耗，建议先上传再备份。`}</Text> : null}
      {pending ? <Button title={busy === "upload" ? "上传中…" : "立即上传"} systemImage="icloud.and.arrow.up" action={upload} disabled={busy != null} /> : null}
      {labels.length ? <Toggle title="包含凭据" value={withSecrets} onChanged={setWithSecrets} /> : null}
      {secretsOn ? <FieldRow title="备份密码">
        <SecureField title="备份密码" value={password} onChanged={setPassword} prompt="至少 6 位" multilineTextAlignment="trailing" />
      </FieldRow> : null}
      {secretsOn ? <FieldRow title="再输入一次">
        <SecureField title="再输入一次" value={again} onChanged={setAgain} prompt="确认密码" multilineTextAlignment="trailing" />
      </FieldRow> : null}
      {secretsOn && password && again && problem ? <Text font="footnote" foregroundStyle="systemRed">{problem}</Text> : null}
      <Button title={busy === "backup" ? "备份中…" : "备份到文件"} systemImage="square.and.arrow.down" action={backup} disabled={busy != null || problem != null} />
    </Section>

    <Section key="restore" header={<Text>恢复</Text>} footer={<Text>恢复会替换本机的全部车辆、记录和设置。连接了小熊油耗的车以云端为准：恢复后重新下载云端最新版本，不会用备份覆盖云端。</Text>}>
      <Button title={picked ? "换一个备份文件" : "选择备份文件"} systemImage="doc" action={pick} disabled={busy != null} />
      {picked && s ? <>
        <Info title="文件" value={picked.name} />
        <Info title="备份时间" value={s.created_at != null ? fmtDateTime(s.created_at) : "—"} />
        <Info title="油记版本" value={s.app_version || "—"} />
        <Info title="车辆" value={`${s.vehicles} 辆${s.linked_vehicles ? `（${s.linked_vehicles} 辆连接小熊油耗）` : ""}`} />
        <Info title="本机记录" value={`${s.local_records} 条`} />
        {s.insurance_years ? <Info title="保险" value={`${s.insurance_years} 年`} /> : null}
        <Info title="小熊油耗" value={s.xxyh_account ? `${s.xxyh_account}${s.xxyh_version != null ? ` · v${s.xxyh_version}` : ""}` : "未连接"} />
        <Info title="凭据" value={s.secrets.length ? `已加密（${s.secrets.join("、")}）` : "无"} />
      </> : null}
    </Section>
    {picked && s && s.secrets.length ? <Section key="restore-secrets" footer={<Text>不填密码则不恢复凭据，保留本机现有的凭据。</Text>}>
      <FieldRow title="备份密码">
        <SecureField title="备份密码" value={restorePassword} onChanged={setRestorePassword} prompt="可不填" multilineTextAlignment="trailing" />
      </FieldRow>
    </Section> : null}
    {picked && s && s.pending_ops ? <Section key="restore-ops" footer={<Text>{`这 ${s.pending_ops} 条是备份时还没上传到小熊油耗的修改。保留时会在同步时加到云端最新版本上；如果同一条记录之后在别处改过，会被这些修改覆盖。`}</Text>}>
      <Toggle title={`保留未上传的 ${s.pending_ops} 条修改`} value={keepOps} onChanged={setKeepOps} />
    </Section> : null}
    {picked ? <Section key="restore-action">
      <Button title={busy === "restore" ? "恢复中…" : "恢复"} systemImage="arrow.counterclockwise" role="destructive" action={restore} disabled={busy != null} />
    </Section> : null}

    {busy === "backup" || busy === "restore" || status ? <Section key="status">
      {busy === "backup" || busy === "restore" ? <ProgressView /> : null}
      {statusText}
    </Section> : null}

    <Section key="export" header={<Text>导出</Text>} footer={<Text>所有车辆的记录（JSON），便于在其他工具中查看；不能用来恢复。</Text>}>
      <Button title="导出记录" systemImage="square.and.arrow.up" action={doExport} />
    </Section>
  </List>
}
