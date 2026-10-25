// 设置 › 小熊油耗 › 导出到小熊油耗（2.0 设计第 7 节，画布第十二轮）：下载云端最新版本、核对账号，按车列出加油、费用、保养的新增 · 修改 · 删除，
// 改动逐条列出；小熊里在上次之后有改动时标橙、列出会被覆盖的；检查通过才能导出，确认后上传。
import { Button, EnvironmentValuesReader, HStack, Image, List, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import {
  AppData, CarExport, changeCount, CloudEdit, EXPORT_KINDS, ExportItem, ExportKind, fmtDate, KindChange, PreparedExport, prepareExport, runExport,
} from "../common/model"
import { AppActions, errorMessage, money, showError } from "./components"

const KIND_TITLES: Record<ExportKind, string> = { fuel: "加油", expense: "费用", maintenance: "保养" }
const UNITS: Record<ExportKind, string> = { fuel: "条", expense: "笔", maintenance: "条" }
const ROW_LIMIT = 20

function changeText(c: KindChange): string {
  const parts = [c.added.length ? `新增 ${c.added.length}` : "", c.modified.length ? `修改 ${c.modified.length}` : "", c.deleted.length ? `删除 ${c.deleted.length}` : ""].filter(Boolean)
  return `${c.count} 条 · ${parts.length ? parts.join(" · ") : "没有变化"}`
}

const changed = (c: KindChange) => c.added.length + c.modified.length + c.deleted.length > 0

/** 确认框里的一句：「沃尔沃S90 删除 5 笔费用」 */
function carSummary(car: CarExport): string {
  const parts = EXPORT_KINDS.flatMap(k => {
    const c = car.changes[k]
    return [
      c.added.length ? `新增 ${c.added.length} ${UNITS[k]}${KIND_TITLES[k]}` : "",
      c.modified.length ? `修改 ${c.modified.length} ${UNITS[k]}${KIND_TITLES[k]}` : "",
      c.deleted.length ? `删除 ${c.deleted.length} ${UNITS[k]}${KIND_TITLES[k]}` : "",
    ]
  }).filter(Boolean)
  return parts.length ? `${car.vehicle_name}${car.created ? "（在小熊新建）" : ""} ${parts.join("、")}` : ""
}

function ItemRow({ item, note }: { item: ExportItem; note?: string }) {
  return <HStack>
    <VStack alignment="leading" spacing={2}>
      <Text>{item.title}</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={1}>{[fmtDate(item.ts), note ?? item.detail].filter(Boolean).join(" · ")}</Text>
    </VStack>
    <Spacer />
    <Text>{money(item.amount)}</Text>
  </HStack>
}

function Info({ title, value, strong }: { title: string; value: string; strong?: boolean }) {
  return <HStack>
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle={strong ? "label" : "secondaryLabel"}>{value}</Text>
  </HStack>
}

const editNote = (e: CloudEdit) => (e.change === "added" ? "小熊里新记的" : e.change === "deleted" ? "小熊里删掉的，导出后恢复" : e.ours ? `油记是 ${money(e.ours.amount)}` : "油记里已删掉")

/** 一辆车：三种记录的变化，改动逐条列出 */
function CarSections({ car }: { car: CarExport }) {
  const target = car.created ? `→ 在小熊新建「${car.car_name}」` : `→ 小熊「${car.car_name}」`
  const lists: Array<{ key: string; title: string; items: ExportItem[]; footer?: string }> = []
  for (const k of EXPORT_KINDS) {
    const c = car.changes[k]
    if (c.deleted.length) lists.push({ key: `${k}-del`, title: `删除的 ${c.deleted.length} ${UNITS[k]}${KIND_TITLES[k]}`, items: c.deleted, footer: "这些在小熊里还有，在油记里已经删掉；导出后小熊里也删掉。" })
    if (c.modified.length) lists.push({ key: `${k}-mod`, title: `修改的 ${c.modified.length} ${UNITS[k]}${KIND_TITLES[k]}`, items: c.modified })
    if (c.added.length) lists.push({ key: `${k}-add`, title: `新增的 ${c.added.length} ${UNITS[k]}${KIND_TITLES[k]}`, items: c.added })
  }
  return <>
    <Section key={`car-${car.vehicle_id}`} header={<HStack><Text>{car.vehicle_name}</Text><Spacer /><Text>{target}</Text></HStack>}
      {...(car.replaces ? { footer: <Text foregroundStyle="systemOrange">{`小熊「${car.car_name}」原有的 ${car.replaces} 条记录一条也对不上油记的，导出后换成油记这辆车的记录。`}</Text> } : {})}>
      {EXPORT_KINDS.map(k => <Info key={k} title={KIND_TITLES[k]} value={changeText(car.changes[k])} strong={changed(car.changes[k])} />)}
    </Section>
    {lists.map(l => <Section key={`${car.vehicle_id}-${l.key}`} header={<Text>{l.title}</Text>} {...(l.footer ? { footer: <Text>{l.footer}</Text> } : {})}>
      {l.items.slice(0, ROW_LIMIT).map((it, i) => <ItemRow key={i} item={it} />)}
      {l.items.length > ROW_LIMIT ? <Text foregroundStyle="secondaryLabel">{`还有 ${l.items.length - ROW_LIMIT} 条`}</Text> : null}
    </Section>)}
  </>
}

/** 计划的内容（预览页和 FuelNote Check 的截图共用） */
export function ExportPlanView({ prepared, exported, busy, onExport }: { prepared: PreparedExport; exported: boolean; busy: boolean; onExport: () => void }) {
  const { plan, version } = prepared
  const cc = plan.cloud_changed
  const n = changeCount(plan)
  const ok = !plan.problems.length
  const last = exported ? "导出" : "导入"
  return <List navigationTitle="导出到小熊油耗" navigationSubtitle={cc ? `云端 v${version} · 上次${last} v${cc.from ?? "—"}` : `云端 v${version} · 和上次${last}时相同`}>
    {cc ? <Section key="changed">
      <HStack alignment="top">
        <Image systemName="exclamationmark.triangle.fill" foregroundStyle="systemOrange" />
        <VStack alignment="leading" spacing={4}>
          <Text font="headline" foregroundStyle="systemOrange">{`小熊里在上次${last}后有改动`}</Text>
          <Text font="footnote">{cc.items
            ? `上次${last}是 v${cc.from ?? "—"}，云端现在是 v${cc.to}。导出会用油记的记录覆盖小熊里的这 ${cc.items.length} 处改动；要留下它们，先在油记里照着记上再导出。`
            : `上次${last}是 v${cc.from ?? "—"}，云端现在是 v${cc.to}；上次的快照不在了，看不出小熊里改了什么。导出会用油记的记录覆盖。`}</Text>
        </VStack>
      </HStack>
    </Section> : null}
    {cc?.items?.length ? <Section key="edits" header={<Text>{`会被覆盖的 ${cc.items.length} 处`}</Text>}>
      {cc.items.slice(0, ROW_LIMIT).map((e, i) => <ItemRow key={i} item={e.item} note={editNote(e)} />)}
    </Section> : null}
    {plan.cars.map(car => <CarSections key={car.vehicle_id} car={car} />)}
    <Section key="stations" header={<Text>油站和类别</Text>}>
      <Info title="油站" value={`${plan.stations.total} 个 · ${plan.stations.added ? `补上 ${plan.stations.added} 个` : "都在小熊里"}`} />
      <Info title="费用类别" value={`${plan.categories} 个 · 都在小熊里`} />
    </Section>
    <Section key="check" {...(ok ? {} : { header: <Text>检查没有通过</Text>, footer: <Text>这些问题解决以前不能导出。</Text> })}>
      {ok
        ? <HStack alignment="top">
          <Image systemName="checkmark.circle" foregroundStyle="systemGreen" />
          <VStack alignment="leading" spacing={2}>
            <Text>检查通过</Text>
            <Text font="footnote" foregroundStyle="secondaryLabel">每种记录的条数、编号、油站引用都对；小熊里的充电、收入、提醒记录和其他字段照原样保留。</Text>
          </VStack>
        </HStack>
        : plan.problems.map((p, i) => <Text key={i} foregroundStyle="systemRed">{p}</Text>)}
    </Section>
    <Section key="export" footer={<Text>{n
      ? `上传后小熊云端变成 v${version + 1}，小熊 App 下次打开时读到这个版本。上传前再读一次云端，和预览时不一样就停下重新预览。`
      : "油记和小熊云端一致，不用导出。"}</Text>}>
      {busy
        ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">正在上传…</Text></HStack>
        : <Button title={cc ? "仍然导出" : "导出到小熊油耗"} systemImage="icloud.and.arrow.up" action={onExport} disabled={!ok || !n}
          {...(cc ? { tint: "systemOrange" as const } : {})} />}
    </Section>
  </List>
}

/** 推入的一页：打开时下载云端、生成预览 */
export function ExportPage({ app }: { data: AppData; app: AppActions }) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <ExportLoader app={app} close={() => env.dismiss()} />}</EnvironmentValuesReader>
}

function ExportLoader({ app, close }: { app: AppActions; close: () => void }) {
  const [prepared, setPrepared] = useState<PreparedExport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setPrepared(null)
    setError(null)
    prepareExport(app.getData()).then(p => { if (alive) setPrepared(p) }).catch(e => { if (alive) setError(errorMessage(e)) })
    return () => { alive = false }
  }, [tick])

  async function exportNow() {
    if (!prepared) return
    const summary = prepared.plan.cars.map(carSummary).filter(Boolean).join("；")
    const i = await Dialog.actionSheet({
      title: "导出到小熊油耗？",
      message: `上传后小熊云端变成 v${prepared.version + 1}${summary ? `：${summary}` : ""}。`,
      actions: [{ label: "导出" }],
    })
    if (i !== 0) return
    setBusy(true)
    try {
      const r = await runExport(app.getData(), prepared)
      app.setData(r.data)
      await Dialog.alert({
        title: "已导出到小熊油耗",
        message: [`小熊云端现在是 v${r.version}。请在小熊 App 里看一眼记录和导出前一致。`, ...r.warnings].join("\n"),
      })
      close()
    } catch (e) {
      setBusy(false)
      await showError("导出失败", e)
    }
  }

  if (prepared) return <ExportPlanView prepared={prepared} exported={!!app.getData().xxyh.last_export_ts} busy={busy} onExport={exportNow} />
  return <List navigationTitle="导出到小熊油耗">
    {error
      ? <Section footer={<Text>没有上传任何内容。</Text>}>
        <Text foregroundStyle="systemRed">{error}</Text>
        <Button title="重试" systemImage="arrow.clockwise" action={() => setTick(tick + 1)} />
      </Section>
      : <Section>
        <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">正在读取小熊云端…</Text></HStack>
      </Section>}
  </List>
}
