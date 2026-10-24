// 设置 › 备份与恢复 › 从备份恢复（2.0 设计第 6 节）：「油记备份」里的全部备份，自动备份按最近 7 天、再往前 4 周、再往前 12 个月分组，
// 立即备份（左滑删除）、恢复前各一组；也可以从其他位置选一个 zip。点一份先看内容（只读出 backup.json），再用它恢复。
import {
  Button, EnvironmentValuesReader, HStack, List, Navigation, NavigationLink, NavigationStack, ProgressView, SecureField, Section, Spacer, Text, useEffect,
  useState, VStack,
} from "scripting"
import {
  AppData, autoBackupInfo, BackupEntry, backupTime, deleteBackup, discardPickedBackup, listBackups, openBackup, PickedBackup, pickBackupFile, restoreBackup,
  summarizeBackup,
} from "../common/model"
import { AppActions, errorMessage, FieldRow, showError, swipeToDelete } from "./components"

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"]
const pad = (n: number) => String(n).padStart(2, "0")

/** 「10月25日 周日 11:00」；不是今年的写上年份 */
function when(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear() !== new Date().getFullYear() ? `${d.getFullYear()}年` : ""
  return `${y}${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const KIND_TITLES: Record<BackupEntry["kind"], string> = { auto: "自动备份", manual: "立即备份", restore: "恢复前" }
const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)

function Info({ title, value, color }: { title: string; value: string; color?: "systemOrange" }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle={color ?? "secondaryLabel"} multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

function GroupHeader({ title, count }: { title: string; count: number }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    {count ? <Text>{`${count} 份`}</Text> : null}
  </HStack>
}

function BackupRow({ entry, sub, app, onDelete }: { entry: BackupEntry; sub: string; app: AppActions; onDelete?: () => void }) {
  const note = [sub, entry.downloaded ? "" : "未下载"].filter(Boolean).join(" · ")
  return <NavigationLink
    destination={<BackupPreviewPage entry={entry} app={app} />}
    {...(onDelete ? { trailingSwipeActions: swipeToDelete(onDelete) } : {})}
  >
    <VStack alignment="leading" spacing={2}>
      <Text>{when(backupTime(entry))}</Text>
      {note ? <Text font="caption" foregroundStyle="secondaryLabel">{note}</Text> : null}
    </VStack>
  </NavigationLink>
}

const muted = (text: string) => <Text font="subheadline" foregroundStyle="secondaryLabel">{text}</Text>

export function RestoreList({ app }: { data: AppData; app: AppActions }) {
  const [tick, setTick] = useState(0)
  const g = listBackups()
  const autos = g.daily.length + g.weekly.length + g.monthly.length
  const total = autos + g.manual.length + g.restore.length
  const newest = g.daily[0]

  async function remove(entry: BackupEntry) {
    const i = await Dialog.actionSheet({
      title: "删除这份立即备份？",
      message: `${when(backupTime(entry))} 的这份备份会从「油记备份」文件夹里删掉。`,
      actions: [{ label: "删除", destructive: true }],
    })
    if (i !== 0) return
    deleteBackup(entry)
    setTick(tick + 1)
  }

  async function pickOther() {
    try {
      const picked = await pickBackupFile()
      if (!picked) return
      await Navigation.present({ element: <PickedPreviewSheet picked={picked} app={app} /> })
      discardPickedBackup(picked)
      setTick(tick + 1)
    } catch (e) {
      await showError("无法读取备份", e)
    }
  }

  return <List navigationTitle="从备份恢复" navigationSubtitle={`${autoBackupInfo().icloudOn ? "iCloud 云盘" : "本机"} · 油记备份 · ${total} 份`}>
    <Section key="daily" header={<GroupHeader title="最近 7 天" count={g.daily.length} />}>
      {g.daily.length
        ? g.daily.map(e => <BackupRow key={e.file} entry={e} sub={e === newest ? "最新" : "这一天最后一份"} app={app} />)
        : muted(autos ? "最近 7 天没有改过数据" : "还没有自动备份")}
    </Section>
    {g.weekly.length ? <Section key="weekly" header={<GroupHeader title="再往前 4 周" count={g.weekly.length} />}>
      {g.weekly.map(e => <BackupRow key={e.file} entry={e} sub="这一周最后一份" app={app} />)}
    </Section> : null}
    {g.monthly.length ? <Section key="monthly" header={<GroupHeader title="再往前 12 个月" count={g.monthly.length} />}>
      {g.monthly.map(e => <BackupRow key={e.file} entry={e} sub="这个月最后一份" app={app} />)}
    </Section> : null}
    <Section key="manual" header={<GroupHeader title="立即备份" count={g.manual.length} />}
      {...(g.manual.length ? { footer: <Text>立即备份的那份一直留着，左滑删除。</Text> } : {})}>
      {g.manual.length
        ? g.manual.map(e => <BackupRow key={e.file} entry={e} sub="" app={app} onDelete={() => { void remove(e) }} />)
        : muted("还没有。立即备份的那份一直留着，左滑删除。")}
    </Section>
    <Section key="restore" header={<GroupHeader title="恢复前" count={g.restore.length} />}>
      {g.restore.length
        ? g.restore.map(e => <BackupRow key={e.file} entry={e} sub="" app={app} />)
        : muted("还没有。恢复时另存的那一份，留最近 5 份。")}
    </Section>
    <Section key="other" footer={<Text>选一个油记 2.0 的备份 zip，比如另存到别处的那份。</Text>}>
      <Button title="从其他位置选择…" systemImage="folder" action={pickOther} />
    </Section>
  </List>
}

/** 推入的预览：打开列表里的一份 */
export function BackupPreviewPage({ entry, app }: { entry: BackupEntry; app: AppActions }) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env =>
    <BackupPreview source={{ entry }} app={app} close={() => env.dismiss()} closeButton={false} />
  }</EnvironmentValuesReader>
}

/** 弹出的预览：从其他位置选的 zip */
function PickedPreviewSheet({ picked, app }: { picked: PickedBackup; app: AppActions }) {
  const dismiss = Navigation.useDismiss()
  return <NavigationStack>
    <BackupPreview source={{ picked }} app={app} close={() => dismiss()} closeButton />
  </NavigationStack>
}

/** 看一眼再恢复：备份里有什么、找不到的引用、备份密码（可不填），再用它恢复 */
function BackupPreview({ source, app, close, closeButton }: {
  source: { entry: BackupEntry } | { picked: PickedBackup }
  app: AppActions
  close: () => void
  closeButton: boolean
}) {
  const given = "picked" in source ? source.picked : null
  const entry = "entry" in source ? source.entry : null
  const [picked, setPicked] = useState<PickedBackup | null>(given)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!entry) return
    let alive = true
    let opened: PickedBackup | null = null
    openBackup(entry).then(p => {
      opened = p
      if (alive) setPicked(p)
      else discardPickedBackup(p)
    }).catch(e => {
      if (alive) setError(errorMessage(e))
    })
    return () => {
      alive = false
      if (opened) discardPickedBackup(opened)
    }
  }, [])

  async function restore() {
    if (!picked) return
    const i = await Dialog.actionSheet({
      title: "用这份备份替换本机数据？",
      message: "本机的车辆、记录、保险和保单原件、权益和设置会被替换；原来的先另存一份「恢复前」。",
      actions: [{ label: "恢复", destructive: true }],
    })
    if (i !== 0) return
    setBusy(true)
    try {
      const r = await restoreBackup(picked, { password: picked.backup.secrets && password ? password : null })
      app.setData(r.data)
      await Dialog.alert({
        title: "已恢复",
        message: [
          `原来的数据另存为「${r.safetyName}」，在恢复列表的「恢复前」里。`,
          r.secrets.length ? `凭据也恢复了（${r.secrets.join("、")}），「包含凭据」已打开，之后的备份用这个密码。` : "",
          r.missing.length ? `这几年的保单原件不在备份里：${r.missing.join("、")}。` : "",
        ].filter(Boolean).join("\n"),
      })
      close()
    } catch (e) {
      await showError("恢复失败", e)
    } finally {
      setBusy(false)
    }
  }

  const s = picked ? summarizeBackup(picked.backup) : null
  const title = entry ? when(backupTime(entry)) : s?.created_at != null ? when(s.created_at) : "备份文件"
  const subtitle = [entry ? KIND_TITLES[entry.kind] : picked?.name ?? "", picked?.size != null ? sizeText(picked.size) : ""].filter(Boolean).join(" · ")
  const records = picked ? picked.backup.ledger.records : []
  const count = (kind: string) => records.filter(r => r.kind === kind).length

  return <List
    navigationTitle={title}
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    {...(closeButton ? { toolbar: { cancellationAction: <Button title="关闭" action={close} /> } } : {})}
  >
    {!picked && !error ? <Section key="loading">
      <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">{entry && !entry.downloaded ? "正在从 iCloud 下载…" : "正在读取…"}</Text></HStack>
    </Section> : null}
    {error ? <Section key="error">
      <Text foregroundStyle="systemRed">{error}</Text>
    </Section> : null}
    {picked && s ? <Section key="info">
      {entry ? null : <Info title="备份时间" value={s.created_at != null ? when(s.created_at) : "—"} />}
      <Info title="油记版本" value={s.app_version || "—"} />
      <Info title="车辆" value={`${s.vehicles} 辆`} />
      <Info title="记录" value={`${s.records} 条`} />
      {s.records ? <Info title="" value={`加油 ${count("fuel")} · 费用 ${count("expense")} · 保养 ${count("maintenance")}`} /> : null}
      {s.insurance_years ? <Info title="保险" value={`${s.insurance_years} 年 · 原件 ${picked.policyFiles} 份`} /> : null}
      {s.benefits ? <Info title="权益" value={`${s.benefits} 项`} /> : null}
      <Info title="小熊油耗" value={s.xxyh_account ? `${s.xxyh_account}${s.xxyh_version != null ? ` · v${s.xxyh_version}` : ""}` : "未连接"} />
      <Info title="凭据" value={s.secrets.length ? `已加密（${s.secrets.join("、")}）` : "无"} />
    </Section> : null}
    {picked && s && s.problems.length ? <Section key="problems" header={<Text>备份里找不到的引用</Text>}>
      {s.problems.slice(0, 8).map(p => <Text key={p} font="footnote" foregroundStyle="systemOrange">{p}</Text>)}
    </Section> : null}
    {picked && s && s.secrets.length ? <Section key="password" header={<Text>备份密码</Text>}
      footer={<Text>{`输入密码一起恢复${s.secrets.join("、")}的凭据；不填就只恢复数据和原件，凭据保留手机上现有的。`}</Text>}>
      <FieldRow title="备份密码">
        <SecureField title="备份密码" value={password} onChanged={setPassword} prompt="可不填" multilineTextAlignment="trailing" />
      </FieldRow>
    </Section> : null}
    {picked ? <Section key="restore" footer={<Text>恢复会替换本机的全部数据和保单原件；原来的先另存一份「恢复前」，在恢复列表里能找到。</Text>}>
      {busy
        ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">恢复中…</Text></HStack>
        : <Button title="用这份恢复" systemImage="clock.arrow.circlepath" role="destructive" tint="systemRed" action={restore} />}
    </Section> : null}
  </List>
}
