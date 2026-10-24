// 设置 › 备份与恢复（2.0 设计第 6 节，画布第十一轮 A，app/backup.ts）：只有一种备份，都放在「油记备份」。
// 自动备份的开关和状态；「包含凭据」（设一个备份密码，自动和立即备份共用）；立即备份、另存一份；从备份恢复推入一页。
import { Button, HStack, Image, List, Navigation, NavigationLink, ProgressView, Section, Spacer, Text, Toggle, useState } from "scripting"
import {
  AppData, autoBackupInfo, backupNow, clearBackupPassword, credentialsIncluded, fmtDateTime, fmtTime, listBackups, shareLatestBackup, storedSecretLabels,
  updateSettings, yearFiles,
} from "../common/model"
import { BackupPasswordSheet } from "./backup_password"
import { RestoreList } from "./backup_restore"
import { AppActions, errorMessage, showError } from "./components"

/** 设置首页那一行的说明：上次时间；自动备份失败时标橙；关掉时写明 */
export function backupRowStatus(data: AppData): { text: string; failed: boolean } {
  if (!data.ledger.settings.auto_backup) return { text: "自动备份已关", failed: false }
  const auto = autoBackupInfo()
  if (auto.last_error) return { text: "备份失败", failed: true }
  if (!auto.last_ts) return { text: "", failed: false }
  const d = new Date(auto.last_ts)
  return { text: `上次 ${d.getMonth() + 1}/${d.getDate()} ${fmtTime(auto.last_ts)}`, failed: false }
}

/** 设置首页的「备份与恢复」 */
export function BackupRowLabel({ data }: { data: AppData }) {
  const s = backupRowStatus(data)
  return <HStack foregroundStyle="label">
    <Text>备份与恢复</Text>
    <Spacer />
    {s.failed ? <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemOrange" /> : null}
    <Text foregroundStyle={s.failed ? "systemOrange" : "secondaryLabel"} lineLimit={1}>{s.text}</Text>
  </HStack>
}

function Info({ title, value, color }: { title: string; value: string; color?: "systemOrange" }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle={color ?? "secondaryLabel"} multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function BackupSettings({ data, app }: { data: AppData; app: AppActions }) {
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const auto = autoBackupInfo()
  const autoOn = data.ledger.settings.auto_backup
  const included = credentialsIncluded()
  const labels = storedSecretLabels()
  const g = listBackups()
  const total = g.daily.length + g.weekly.length + g.monthly.length + g.manual.length + g.restore.length
  const canShare = g.daily.length + g.weekly.length + g.monthly.length + g.manual.length > 0
  const policyFiles = data.ledger.insurance.flatMap(yearFiles).length
  const place = auto.icloudOn ? "iCloud 云盘 › Scripting ›「油记备份」" : "本机的「油记备份」文件夹"

  async function setIncluded(on: boolean) {
    if (on) {
      const ok = await Navigation.present<boolean | null>({ element: <BackupPasswordSheet change={false} /> })
      if (ok) setStatus({ ok: true, text: "已设好备份密码，从下一份备份开始带凭据；现在就要一份可以点「立即备份」。" })
    } else {
      const i = await Dialog.actionSheet({
        title: "不再包含凭据？",
        message: "之后的备份不带凭据，这台手机上的备份密码会删掉。已有的备份照样能用原来的密码恢复凭据。",
        actions: [{ label: "不再包含", destructive: true }],
      })
      if (i === 0) {
        clearBackupPassword()
        setStatus(null)
      }
    }
    setTick(tick + 1)
  }

  async function changePassword() {
    const ok = await Navigation.present<boolean | null>({ element: <BackupPasswordSheet change /> })
    if (ok) setStatus({ ok: true, text: "备份密码已修改。之前的备份恢复凭据时还要用旧密码。" })
    setTick(tick + 1)
  }

  async function now() {
    setBusy(true)
    setStatus(null)
    try {
      const name = await backupNow(app.getData())
      setStatus({ ok: true, text: `已备份「${name}」${credentialsIncluded() ? "，含凭据" : "，不含凭据"}。` })
    } catch (e) {
      setStatus({ ok: false, text: `备份失败：${errorMessage(e)}` })
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    try {
      await shareLatestBackup()
    } catch (e) {
      await showError("无法另存", e)
    }
  }

  const autoFooter = `改了数据就备份：保存后 1 分钟内没有新的修改、或离开油记时，写一份到${place}。`
    + "最近 7 天每天留一份，再往前每周留一份、留 4 周，每月留一份、留 12 个月。"
  const credFooter = labels.length
    ? `${labels.join("、")}的凭据用备份密码加密后放进每一份备份，自动和立即备份都一样。密码只存在这台手机上；恢复时输入它，忘了就只恢复数据，凭据重新填写。`
    : "手机上还没有保存凭据。打开后，以后填的凭据会用备份密码加密后放进每一份备份。"

  return <List navigationTitle="备份与恢复" navigationSubtitle={policyFiles ? `数据、保单原件 ${policyFiles} 份` : "车辆、记录和设置"}>
    <Section key="auto" header={<Text>自动备份</Text>} footer={<Text>{autoFooter}</Text>}>
      <Toggle title="自动备份" value={autoOn} onChanged={v => app.setData(updateSettings(app.getData(), { auto_backup: v }))} />
      {autoOn ? <>
        <Info title="上次" value={auto.last_ts ? fmtDateTime(auto.last_ts) : "还没有备份过"} />
        <Info title="位置" value={auto.place} {...(auto.icloudOn ? {} : { color: "systemOrange" as const })} />
        {auto.icloudOn ? null : <Text font="footnote" foregroundStyle="systemOrange">没有开 iCloud，备份只在这台手机上。</Text>}
        {auto.last_error ? <Text font="footnote" foregroundStyle="systemOrange">{`上次失败（${auto.error_ts ? fmtDateTime(auto.error_ts) : ""}）：${auto.last_error}。下一次改了数据或离开油记时会再试。`}</Text> : null}
      </> : null}
    </Section>

    <Section key="cred" header={<Text>凭据</Text>} footer={<Text>{credFooter}</Text>}>
      <Toggle title="包含凭据" value={included} onChanged={v => { void setIncluded(v) }} />
      {included ? <Button title="修改备份密码" action={changePassword} /> : null}
    </Section>

    <Section key="now" footer={<Text>立即备份的那份一直留着，在恢复列表里左滑删除。另存一份：把最新的一份存到「文件」别处或隔空投送。</Text>}>
      <Button title={busy ? "备份中…" : "立即备份"} systemImage="arrow.down.doc" action={now} disabled={busy} />
      <Button title="另存一份…" systemImage="square.and.arrow.up" action={share} disabled={busy || !canShare} />
      {busy ? <ProgressView /> : null}
      {status ? <Text font="footnote" foregroundStyle={status.ok ? "secondaryLabel" : "systemRed"}>{status.text}</Text> : null}
    </Section>

    <Section key="restore" footer={<Text>备份里的保单原件、保单号、车架号不加密；建议在 iPhone 设置里打开 iCloud 的「高级数据保护」。</Text>}>
      <NavigationLink destination={<RestoreList data={data} app={app} />}>
        <HStack foregroundStyle="label">
          <Text>从备份恢复</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel">{`${total} 份`}</Text>
        </HStack>
      </NavigationLink>
    </Section>
  </List>
}
