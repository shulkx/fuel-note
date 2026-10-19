// 小组件自己读车况（设计文档 18.3 节第 2 步）。主要靠油记读完写进 widget.json；小组件发现车况超过 1 小时才自己读一次。
// - 先看车况缓存：油记或别的小组件 1 小时内读过就直接用；
// - 小号、中号、锁屏几个小组件会同时刷新，1 分钟内只让一个去读；
// - 读不到（没联网、超时、凭据失效）就显示上次的车况，不报错。
// 纯逻辑：读写文件、读车况由调用方注入（common/widget_runtime.ts），Node 测试可用。
import { VehicleStatus } from "../providers/types"
import { createStatusSource, StatusSnapshot } from "./status_source"
import { showsFuel, StatusLink, WIDGET_STATUS_MAX_AGE_MS, WidgetSnapshot, WidgetStatus } from "./widget_data"

/** 另一个小组件 1 分钟内开始读过，就不再读 */
export const WIDGET_LOCK_MS = 60e3

export type WidgetRefreshResult = "cache" | "read" | "locked" | "no_credential" | "failed"
/** 小组件上次自己读车况的结果，「诊断」参数里显示 */
export type WidgetRefreshLog = { at: number; result: WidgetRefreshResult; error?: string }

export type WidgetRefreshDeps = {
  now(): number
  /** 用油记的凭据读车况；没有凭据或提供方不支持时为 null */
  reader(link: StatusLink): (() => Promise<VehicleStatus>) | null
  loadStatus(key: string): StatusSnapshot | null
  saveStatus(snap: StatusSnapshot): void
  /** 锁：开始读的时间，没有为 0 */
  readLock(): number
  writeLock(at: number): void
  /** 写回前重读 widget.json：油记可能刚写过 */
  latest(): WidgetSnapshot
  save(s: WidgetSnapshot): void
  log(entry: WidgetRefreshLog): void
}

export function toWidgetStatus(snap: StatusSnapshot, tank: number | null): WidgetStatus {
  return { ts: snap.status.ts, fuel_l: snap.status.fuel_l, range_km: snap.status.range_km, tank_l: tank, odometer_km: snap.status.odometer_km, read_at: snap.read_at }
}

/** 需要的话读一次车况，返回要显示的摘要。不会抛错 */
export async function refreshWidgetStatus(s: WidgetSnapshot, family: string, deps: WidgetRefreshDeps): Promise<WidgetSnapshot> {
  const link = s.status_link
  const now = deps.now()
  if (!link || !showsFuel(family, s)) return s
  if (s.status && now - s.status.read_at < WIDGET_STATUS_MAX_AGE_MS) return s
  const log = (result: WidgetRefreshResult, error?: string) => {
    try { deps.log({ at: now, result, ...(error ? { error } : {}) }) } catch { /* 只用于诊断 */ }
  }

  /** 写回 widget.json；油记在这期间换了车辆时不改它写的摘要 */
  function apply(snap: StatusSnapshot, result: WidgetRefreshResult): WidgetSnapshot {
    let latest = s
    try { latest = deps.latest() } catch { latest = s }
    log(result)
    if (!latest.status_link || latest.status_link.key !== link!.key) return latest
    const next: WidgetSnapshot = { ...latest, status: toWidgetStatus(snap, latest.status_link.tank_l) }
    try { deps.save(next) } catch { /* 下次再写 */ }
    return next
  }

  const source = createStatusSource({ load: deps.loadStatus, save: deps.saveStatus, now: deps.now }, WIDGET_STATUS_MAX_AGE_MS)
  const cached = source.peek(link.key)
  if (cached && now - cached.read_at < WIDGET_STATUS_MAX_AGE_MS) return apply(cached, "cache")

  const read = deps.reader(link)
  if (!read) { log("no_credential"); return s }
  let locked = 0
  try { locked = deps.readLock() } catch { locked = 0 }
  if (locked && now - locked < WIDGET_LOCK_MS) { log("locked"); return s }
  try { deps.writeLock(now) } catch { /* 锁写不进去也照样读 */ }
  try {
    return apply(await source.get(link.key, read, { force: true }), "read")
  } catch (e) {
    log("failed", e instanceof Error ? e.message : String(e))
    return s
  } finally {
    try { deps.writeLock(0) } catch { /* 锁 1 分钟后自动失效 */ }
  }
}
