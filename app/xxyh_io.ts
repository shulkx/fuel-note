// 小熊油耗的导入（2.0 设计第 8 节）：连接时校验凭据，下载最新版本，列出还没导入的车，勾选后导入。不再自动拉取；导出在 2.0.0-beta.6
import { AppData } from "../common/ledger"
import { parseXxyhToken } from "../sync/xxyh/api"
import { carsNotImported, importCars } from "../sync/xxyh/import"
import { carsOf, newCarUuid, XxyhCarInfo } from "../sync/xxyh/mapping"
import { downloadLatest } from "../sync/xxyh/sync"
import { emptyXxyhState, XxyhBackup } from "../sync/xxyh/types"
import { scriptingHttp } from "../platform/scripting_http"
import { getSecret, removeSecret, SECRET_XXYH_TOKEN, setSecret } from "../platform/secrets"
import { readLatestSnapshot, saveSnapshot, saveXxyhState } from "../platform/storage"
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
