// 设置 › 备份与恢复（2.0 设计第 6 节，app/backup.ts）：自动备份的开关和状态、备份到「文件」（一个 zip，含保单原件；凭据用密码加密）、
// 从备份恢复（替换本机数据和保单原件）。
import { Button, HStack, List, ProgressView, SecureField, Section, Spacer, Text, Toggle, useState } from "scripting"
import {
  AppData, autoBackupInfo, discardPickedBackup, fmtDateTime, passwordProblem, PickedBackup, pickBackupFile, restoreBackup, saveBackupToFiles,
  storedSecretLabels, summarizeBackup, updateSettings,
} from "../common/model"
import { AppActions, FieldRow, showError } from "./components"

function Info({ title, value, color }: { title: string; value: string; color?: "systemOrange" | "systemRed" }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle={color ?? "secondaryLabel"} multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function BackupSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [labels] = useState(() => storedSecretLabels())
  const [withSecrets, setWithSecrets] = useState(labels.length > 0)
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [picked, setPicked] = useState<PickedBackup | null>(null)
  const [restorePassword, setRestorePassword] = useState("")
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const secretsOn = withSecrets && labels.length > 0
  const problem = secretsOn ? passwordProblem(password, again) : null
  const auto = autoBackupInfo()
  const autoOn = app.getData().ledger.settings.auto_backup

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

  async function pick() {
    setStatus(null)
    try {
      const r = await pickBackupFile()
      if (!r) return
      if (picked) discardPickedBackup(picked)
      setPicked(r)
      setRestorePassword("")
    } catch (e) {
      await showError("无法读取备份", e)
    }
  }

  async function restore() {
    if (!picked) return
    const i = await Dialog.actionSheet({
      title: "用这个备份替换本机数据？",
      message: "本机的车辆、记录、保险和保单原件、权益和设置会被替换，原来的会先另存一份到「油记备份」文件夹。",
      actions: [{ label: "恢复", destructive: true }],
    })
    if (i !== 0) return
    setBusy("restore")
    setStatus(null)
    try {
      const r = await restoreBackup(picked, { password: picked.backup.secrets && restorePassword ? restorePassword : null })
      app.setData(r.data)
      setPicked(null)
      setRestorePassword("")
      setStatus({
        ok: r.missing.length === 0,
        text: [
          `已恢复${r.secrets.length ? `，包括凭据（${r.secrets.join("、")}）` : ""}。原来的数据另存为「油记备份」文件夹里的 ${r.safetyName}。`,
          r.missing.length ? `这几年的保单原件不在备份里：${r.missing.join("、")}。` : "",
        ].filter(Boolean).join("\n"),
      })
    } catch (e) {
      setStatus({ ok: false, text: `恢复失败：${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(null)
    }
  }

  const backupFooter = "车辆、记录、保险明细和保单原件、权益、门店和设置打包成一个 zip，保存到「文件」。zip 里的保单原件、保单号、车架号不加密；建议在 iPhone 设置里打开 iCloud 的「高级数据保护」。"
    + (secretsOn ? `

${labels.join("、")} 的凭据用备份密码加密（AES-256-GCM）后放进备份。恢复时需要输入这个密码；忘记密码只能恢复记录，凭据需要重新填写。` : "")
  const s = picked ? summarizeBackup(picked.backup) : null
  const statusText = status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null

  return <List navigationTitle="备份与恢复" navigationBarTitleDisplayMode="inline">
    <Section key="auto" header={<Text>自动备份</Text>}
      footer={<Text>改了数据就自动备份：保存后 1 分钟内没有新的修改、或离开油记时，写一份到「油记备份」文件夹。每天留最新的一份，留最近 10 天；不含凭据。</Text>}>
      <Toggle title="自动备份" value={autoOn} onChanged={v => app.setData(updateSettings(app.getData(), { auto_backup: v }))} />
      {autoOn ? <>
        <Info title="上次" value={auto.last_ts ? fmtDateTime(auto.last_ts) : "还没有备份过"} />
        <Info title="位置" value={auto.place} {...(auto.place.startsWith("本机") ? { color: "systemOrange" as const } : {})} />
        {auto.place.startsWith("本机") ? <Text font="footnote" foregroundStyle="systemOrange">没有开 iCloud，备份只在这台手机上。</Text> : null}
        {auto.last_error ? <Text font="footnote" foregroundStyle="systemRed">{`上次失败（${auto.error_ts ? fmtDateTime(auto.error_ts) : ""}）：${auto.last_error}`}</Text> : null}
      </> : null}
    </Section>

    <Section key="backup" header={<Text>备份到文件</Text>} footer={<Text>{backupFooter}</Text>}>
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

    <Section key="restore" header={<Text>恢复</Text>} footer={<Text>恢复会替换本机的全部数据和保单原件，原来的会先另存一份「恢复前-…zip」。2.0 以前的备份不能恢复。</Text>}>
      <Button title={picked ? "换一个备份文件" : "选择备份文件"} systemImage="doc" action={pick} disabled={busy != null} />
      {picked && s ? <>
        <Info title="文件" value={picked.name} />
        <Info title="备份时间" value={s.created_at != null ? fmtDateTime(s.created_at) : "—"} />
        <Info title="油记版本" value={s.app_version || "—"} />
        <Info title="车辆" value={`${s.vehicles} 辆`} />
        <Info title="记录" value={`${s.records} 条`} />
        {s.insurance_years ? <Info title="保险" value={`${s.insurance_years} 年 · 原件 ${picked.policyFiles} 份`} /> : null}
        {s.benefits ? <Info title="权益" value={`${s.benefits} 项`} /> : null}
        <Info title="小熊油耗" value={s.xxyh_account ? `${s.xxyh_account}${s.xxyh_version != null ? ` · v${s.xxyh_version}` : ""}` : "未连接"} />
        <Info title="凭据" value={s.secrets.length ? `已加密（${s.secrets.join("、")}）` : "无"} />
      </> : null}
    </Section>
    {picked && s && s.secrets.length ? <Section key="restore-secrets" footer={<Text>不填密码则不恢复凭据，保留本机现有的凭据。</Text>}>
      <FieldRow title="备份密码">
        <SecureField title="备份密码" value={restorePassword} onChanged={setRestorePassword} prompt="可不填" multilineTextAlignment="trailing" />
      </FieldRow>
    </Section> : null}
    {picked && s && s.problems.length ? <Section key="restore-problems" header={<Text>备份里找不到的引用</Text>}>
      {s.problems.slice(0, 8).map(p => <Text key={p} font="footnote" foregroundStyle="systemOrange">{p}</Text>)}
    </Section> : null}
    {picked ? <Section key="restore-action">
      <Button title={busy === "restore" ? "恢复中…" : "恢复"} systemImage="arrow.counterclockwise" role="destructive" action={restore} disabled={busy != null} />
    </Section> : null}

    {busy === "backup" || busy === "restore" || status ? <Section key="status">
      {busy === "backup" || busy === "restore" ? <ProgressView /> : null}
      {statusText}
    </Section> : null}
  </List>
}
