// 拉取与上传。状态进、状态出；保存文件由调用方负责。
import { Http } from "../../platform/http"
import { accountInfo, downloadBackup, uploadBackup, XxyhError } from "./api"
import { applyOps, describeOp, OpConflict, validateUpload } from "./ops"
import { XxyhBackup, XxyhState } from "./types"

export type Snapshot = { version: number; doc: XxyhBackup }

export type PullResult = { state: XxyhState; changed: boolean; snapshot: Snapshot | null }

/** 云端版本变了才下载 */
export async function pull(http: Http, token: string, state: XxyhState, now = Date.now()): Promise<PullResult> {
  const acct = await accountInfo(http, token)
  const next: XxyhState = { ...state, account_id: acct.account_id || state.account_id, nickname: acct.nickname || state.nickname, last_pull_ts: now, last_error: null }
  if (acct.version == null) {
    if (state.base) throw new XxyhError("server", "小熊油耗：账号下找不到云备份")
    return { state: next, changed: false, snapshot: null }
  }
  if (acct.version === state.base_version && state.base) return { state: next, changed: false, snapshot: null }
  const doc = await downloadBackup(http, token, acct.version)
  return { state: { ...next, base: doc, base_version: acct.version }, changed: true, snapshot: { version: acct.version, doc } }
}

export type PushResult = {
  state: XxyhState
  uploaded: boolean
  version: number | null
  conflicts: OpConflict[]
  notes: string[]
  warnings: string[]
  snapshots: Snapshot[]
}

/**
 * 在云端最新版本上应用待上传的修改并上传。
 * 检查不通过时抛错、保留修改；有冲突的修改丢弃，并在结果里说明。
 */
export async function push(http: Http, token: string, state: XxyhState, now = Date.now()): Promise<PushResult> {
  if (!state.ops.length) return { state, uploaded: false, version: state.base_version, conflicts: [], notes: [], warnings: [], snapshots: [] }
  const pulled = await pull(http, token, state, now)
  const snapshots = pulled.snapshot ? [pulled.snapshot] : []
  const base = pulled.state.base
  if (!base) throw new XxyhError("server", "小熊账号下还没有云备份，请先在小熊油耗 App 里备份一次")
  const result = applyOps(base, pulled.state.ops)
  const problems = validateUpload(base, result)
  if (problems.length) throw new XxyhError("server", `上传前检查未通过，已取消上传：${problems.slice(0, 3).join("；")}`)
  const conflictText = result.conflicts.map(c => `${describeOp(c.op)}：${c.reason}`)
  if (result.conflicts.length === pulled.state.ops.length) {
    // 全部冲突：不需要上传，丢弃这些修改
    return {
      state: { ...pulled.state, ops: [], last_conflicts: conflictText },
      uploaded: false, version: pulled.state.base_version, conflicts: result.conflicts, notes: result.notes, warnings: [], snapshots,
    }
  }
  const up = await uploadBackup(http, token, result.doc)
  snapshots.push({ version: up.version, doc: result.doc })
  return {
    state: { ...pulled.state, base: result.doc, base_version: up.version, ops: [], last_push_ts: now, last_error: null, last_conflicts: conflictText },
    uploaded: true, version: up.version, conflicts: result.conflicts, notes: result.notes, warnings: up.warnings, snapshots,
  }
}
