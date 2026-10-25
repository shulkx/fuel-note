// 小熊油耗的导入和导出（2.0 设计第 7、8 节）：连接时校验凭据，下载最新版本，列出还没导入的车，勾选后导入；导出时下载最新版本、预览，确认后上传。不再自动同步
import { AppData } from "../common/ledger"
import { accountInfo, downloadBackup, parseXxyhToken, uploadBackup, XxyhError } from "../sync/xxyh/api"
import { buildExport, canon, ExportPlan, pendingChanges } from "../sync/xxyh/export"
import { carsNotImported, importCars } from "../sync/xxyh/import"
import { carsOf, newCarUuid, XxyhCarInfo } from "../sync/xxyh/mapping"
import { downloadLatest } from "../sync/xxyh/sync"
import { emptyXxyhState, XxyhBackup } from "../sync/xxyh/types"
import { scriptingHttp } from "../platform/scripting_http"
import { getSecret, removeSecret, SECRET_XXYH_TOKEN, setSecret } from "../platform/secrets"
import { readLatestSnapshot, readSnapshot, saveSnapshot, saveXxyhState } from "../platform/storage"
import { commit, commitXxyh } from "./store"

export const xxyhToken = () => getSecret(SECRET_XXYH_TOKEN)

/** 存了小熊的凭据（导入、导出、小熊的油站搜索和油价都用它） */
export const xxyhConnected = () => !!xxyhToken()

/** 下载到的云端最新版本，和其中还没导入的车 */
export type XxyhCloud = { version: number; doc: XxyhBackup; cars: XxyhCarInfo[] }

function saveSnapshotQuietly(version: number, doc: XxyhBackup): void {
  try { saveSnapshot(version, doc) } catch { /* 快照写不进去不影响导入 */ }
}

/**
 * 连接小熊：校验凭据、下载最新版本、记下账号。已经连过另一个账号时不换（先断开）。
 * 返回新的数据和云端里还没导入的车，由页面让用户勾选
 */
export async function connectXxyh(data: AppData, text: string): Promise<{ data: AppData; cloud: XxyhCloud }> {
  const token = parseXxyhToken(text)
  if (!token) throw new Error("没有识别出小熊油耗的凭据")
  const r = await downloadLatest(scriptingHttp, token)
  if (data.xxyh.account_id && r.account.account_id && data.xxyh.account_id !== r.account.account_id) {
    throw new Error("这是另一个小熊账号。请先断开当前账号，再连接新账号。")
  }
  setSecret(SECRET_XXYH_TOKEN, token)
  saveSnapshotQuietly(r.version, r.doc)
  const next = commitXxyh(data, { ...data.xxyh, account_id: r.account.account_id || data.xxyh.account_id, nickname: r.account.nickname || data.xxyh.nickname, last_error: null })
  return { data: next, cloud: { version: r.version, doc: r.doc, cars: carsNotImported(next.ledger, r.doc) } }
}

/** 再下载一次最新版本，列出还没导入的车（设置 › 小熊油耗） */
export async function fetchXxyhCloud(data: AppData): Promise<XxyhCloud> {
  const token = xxyhToken()
  if (!token) throw new Error("还没有连接小熊油耗")
  const r = await downloadLatest(scriptingHttp, token)
  saveSnapshotQuietly(r.version, r.doc)
  return { version: r.version, doc: r.doc, cars: carsNotImported(data.ledger, r.doc) }
}

/** 导入勾选的车：车辆、记录（带小熊的原样）、油站、类别；记下这次的云端版本 */
export function importXxyhCars(data: AppData, cloud: XxyhCloud, uuids: string[]): { data: AppData; added: Array<{ name: string; records: number }> } {
  const r = importCars(data.ledger, cloud.doc, uuids, Date.now())
  if (!r.added.length) return { data, added: [] }
  const saved = commit(data, r.ledger)
  return { data: commitXxyh(saved, { ...saved.xxyh, last_version: cloud.version }), added: r.added }
}

/** 最近一份快照里的小熊车（车辆编辑里「导出到小熊的车」的选项，不联网）；没有快照时空数组 */
export function snapshotCars(): XxyhCarInfo[] {
  return carsOf(readLatestSnapshot()?.doc ?? null)
}

/** 导出时在小熊新建一辆车用的 uuid：不和快照里的车、其他车辆的导出目标重复 */
export function newExportCarUuid(data: AppData): string {
  return newCarUuid(new Set([...snapshotCars().map(c => c.uuid), ...data.ledger.vehicles.map(v => v.xxyh_car).filter((u): u is string => !!u)]))
}

/** 断开：删除凭据和小熊状态；数据都在油记里，不动 */
export function disconnectXxyh(data: AppData): AppData {
  removeSecret(SECRET_XXYH_TOKEN)
  saveXxyhState(emptyXxyhState())
  return { ...data, xxyh: emptyXxyhState() }
}

// ---------- 导出到小熊（设计第 7 节） ----------

/** 预览时下载的云端版本和生成的计划；确认后按它上传 */
export type PreparedExport = { version: number; plan: ExportPlan }

/** 下载云端最新版本、核对账号，生成要上传的整份备份和预览（不上传） */
export async function prepareExport(data: AppData): Promise<PreparedExport> {
  const token = xxyhToken()
  if (!token) throw new Error("还没有连接小熊油耗")
  const r = await downloadLatest(scriptingHttp, token)
  if (data.xxyh.account_id && r.account.account_id && r.account.account_id !== data.xxyh.account_id) {
    throw new Error("现在的凭据是另一个小熊账号，不能导出。请换回原来账号的凭据，或断开后重新连接。")
  }
  const last = data.xxyh.last_version
  const plan = buildExport(r.doc, data.ledger, { now: Date.now(), cloudVersion: r.version, lastVersion: last, lastSnapshot: last != null ? readSnapshot(last) : null })
  return { version: r.version, plan }
}

/**
 * 确认后上传：先再读一次云端版本，和预览时不一样就停下（要重新预览）；上传后没收到回应时，读一次云端最新版本，是这次传的就算成功，不再重传。
 * 成功后存快照，写进云端的样子存回每条记录的 xxyh_raw，记下版本和时间
 */
export async function runExport(data: AppData, prepared: PreparedExport): Promise<{ data: AppData; version: number; warnings: string[] }> {
  const token = xxyhToken()
  if (!token) throw new Error("还没有连接小熊油耗")
  if (prepared.plan.problems.length) throw new Error(`检查没有通过：${prepared.plan.problems[0]}`)
  let kept = false
  try { kept = await BackgroundKeeper.keepAlive() } catch { /* 只在主界面能用 */ }
  try {
    const now = await accountInfo(scriptingHttp, token)
    if (now.version !== prepared.version) throw new Error(`小熊云端在预览后又有了新版本（v${now.version}），请返回重新预览。`)
    let result: { version: number; warnings: string[] }
    try {
      result = await uploadBackup(scriptingHttp, token, prepared.plan.doc)
    } catch (e) {
      if (!(e instanceof XxyhError) || e.kind !== "network") throw e
      const after = await accountInfo(scriptingHttp, token)
      if (after.version == null || after.version === prepared.version) throw e
      const doc = await downloadBackup(scriptingHttp, token, after.version)
      if (canon(doc) !== canon(prepared.plan.doc)) throw e
      result = { version: after.version, warnings: [] }
    }
    saveSnapshotQuietly(result.version, prepared.plan.doc)
    const raws = prepared.plan.raws
    const saved = commit(data, { ...data.ledger, records: data.ledger.records.map(r => (raws[r.id] ? { ...r, xxyh_raw: raws[r.id] } : r)) })
    const next = commitXxyh(saved, { ...saved.xxyh, last_version: result.version, last_export_ts: Date.now(), last_error: null })
    return { data: next, version: result.version, warnings: result.warnings }
  } finally {
    if (kept) {
      try { await BackgroundKeeper.stopKeepAlive() } catch { /* 忽略 */ }
    }
  }
}

/** 还没导出的修改条数：用上次导入或导出时的快照离线算；没有导出目标或没有快照时为 null */
export function pendingExport(data: AppData): number | null {
  const last = data.xxyh.last_version
  if (last == null || !data.ledger.vehicles.some(v => v.xxyh_car)) return null
  const snapshot = readSnapshot(last)
  return snapshot ? pendingChanges(snapshot, data.ledger, Date.now()) : null
}
