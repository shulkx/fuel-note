// 车况缓存（设计文档 18.1 节）：与行程相同，10 分钟内直接用；存进文件，冷启动（例如从小组件进入）也能立刻显示上次的结果；
// 同一辆车同一时间只发一个请求。纯逻辑：读写缓存和读取车况由调用方注入，Node 测试可用。
import { VehicleStatus } from "../providers/types"

export const STATUS_TTL_MS = 10 * 60e3

export type StatusSnapshot = { key: string; read_at: number; status: VehicleStatus }

export type StatusSourceDeps = {
  load(key: string): StatusSnapshot | null
  save(snapshot: StatusSnapshot): void
  now(): number
}

export type StatusSource = {
  /** force：不管缓存，重新读取（下拉刷新、点车况行） */
  get(key: string, fetch: () => Promise<VehicleStatus>, opts?: { force?: boolean }): Promise<StatusSnapshot>
  /** 只看缓存，不发请求；过期的也返回 */
  peek(key: string): StatusSnapshot | null
  /** 同 peek，但会看一下文件：小组件可能写进了更新的结果 */
  latest(key: string): StatusSnapshot | null
}

export function createStatusSource(deps: StatusSourceDeps, ttlMs = STATUS_TTL_MS): StatusSource {
  const memory = new Map<string, StatusSnapshot>()
  const inflight = new Map<string, Promise<StatusSnapshot>>()

  function peek(key: string): StatusSnapshot | null {
    const m = memory.get(key)
    if (m) return m
    let s: StatusSnapshot | null = null
    try { s = deps.load(key) } catch { s = null }
    if (s && s.key === key && s.status && typeof s.read_at === "number") {
      memory.set(key, s)
      return s
    }
    return null
  }

  /** 文件里的比内存里的新（小组件自己读过）就用文件里的 */
  function newest(key: string): StatusSnapshot | null {
    const m = peek(key)
    let f: StatusSnapshot | null = null
    try { f = deps.load(key) } catch { f = null }
    if (f && f.key === key && f.status && typeof f.read_at === "number" && (!m || f.read_at > m.read_at)) {
      memory.set(key, f)
      return f
    }
    return m
  }

  function get(key: string, fetch: () => Promise<VehicleStatus>, opts: { force?: boolean } = {}): Promise<StatusSnapshot> {
    const now = deps.now()
    const cached = newest(key)
    if (!opts.force && cached && now - cached.read_at < ttlMs) return Promise.resolve(cached)
    const running = inflight.get(key)
    if (running) return running
    const p = fetch().then(status => {
      const snap: StatusSnapshot = { key, read_at: now, status }
      memory.set(key, snap)
      try { deps.save(snap) } catch { /* 缓存写不进去不影响使用 */ }
      return snap
    })
    inflight.set(key, p)
    const done = () => { if (inflight.get(key) === p) inflight.delete(key) }
    p.then(done, done)
    return p
  }

  return { get, peek, latest: newest }
}
