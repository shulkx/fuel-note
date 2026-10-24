// 读写账本和小熊状态（2.0：数据都在 ledger2.json，xxyh2.json 只有账号和上次导入、导出的信息）
import { AppData, makeAppData } from "../common/ledger"
import { LedgerFile, Settings } from "../common/types"
import { XxyhState } from "../sync/xxyh/types"
import { cleanLegacyCaches, readLedger, readXxyhState, removePolicyFiles, saveLedger, saveXxyhState } from "../platform/storage"

/** 页面读写当前数据的入口：取最新的、保存后放回去 */
export type DataRef = { get: () => AppData; set: (d: AppData) => void }

/** 打开油记时读数据。legacy：只有 1.x 的数据（2.0 设计第 5 节第 6 步），页面只显示说明，什么都不写 */
export function loadData(): { data: AppData; warnings: string[]; legacy: boolean } {
  cleanLegacyCaches()
  const l = readLedger()
  const x = readXxyhState()
  return { data: makeAppData(l.ledger, x.state), warnings: [l.warning, x.warning].filter((w): w is string => !!w), legacy: l.legacy }
}

/** 保存账本（小熊状态不变） */
export function commit(data: AppData, ledger: LedgerFile): AppData {
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

/** 保存小熊状态 */
export function commitXxyh(data: AppData, xxyh: XxyhState): AppData {
  saveXxyhState(xxyh)
  return makeAppData(data.ledger, xxyh)
}

/** 删掉一起删除的保险年度的原件 */
export function dropPolicyFiles(ids: string[] | undefined): void {
  for (const id of ids ?? []) removePolicyFiles(id)
}

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  return commit(data, { ...data.ledger, settings: { ...data.ledger.settings, ...patch } })
}

/** 点了「×」的续保提醒（同一年只记一次） */
export function dismissRenewal(data: AppData, yearId: string): AppData {
  const list = data.ledger.settings.dismissed_renewals ?? []
  return list.includes(yearId) ? data : updateSettings(data, { dismissed_renewals: [...list, yearId].slice(-20) })
}
