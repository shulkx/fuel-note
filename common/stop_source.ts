// 共用行程检测（设计文档 16.6 节）：同一辆车最近 7 天的停车，记录页提示、记加油表单、从行程选择共用一份。
// - 缓存 10 分钟内直接用；缓存存进文件，冷启动（例如从小组件进入）也能立刻拿到；
// - 同一辆车同一时间只发一个请求，其他调用等这个请求的结果。
// 纯逻辑：读写缓存和读取停车由调用方注入，Node 测试可用。
import { Stop } from "./stops"

export const STOPS_DAYS = 7
export const STOPS_TTL_MS = 10 * 60e3

export type StopsSnapshot = { key: string; fetched_at: number; from: number; to: number; stops: Stop[] }

export type StopsFetcher = (range: { from: number; to: number }) => Promise<Stop[]>

export type StopSourceDeps = {
  load(key: string): StopsSnapshot | null
  save(snapshot: StopsSnapshot): void
  now(): number
}

export type StopGetOptions = {
  /** 不管缓存，重新读取（下拉刷新） */
  force?: boolean
  /** 缓存必须在这个时间之后读取（例如付款时间晚于缓存时） */
  needAfter?: number
}

export type StopSource = {
  get(key: string, fetch: StopsFetcher, opts?: StopGetOptions): Promise<StopsSnapshot>
  /** 只看缓存，不发请求；过期的也返回 */
  peek(key: string): StopsSnapshot | null
  loading(key: string): boolean
}

export function createStopSource(deps: StopSourceDeps, days = STOPS_DAYS, ttlMs = STOPS_TTL_MS): StopSource {
  const memory = new Map<string, StopsSnapshot>()
  const inflight = new Map<string, Promise<StopsSnapshot>>()

  function peek(key: string): StopsSnapshot | null {
    const m = memory.get(key)
    if (m) return m
    let s: StopsSnapshot | null = null
    try { s = deps.load(key) } catch { s = null }
    if (s && s.key === key && Array.isArray(s.stops)) {
      memory.set(key, s)
      return s
    }
    return null
  }

  function fresh(s: StopsSnapshot | null, now: number, needAfter?: number): s is StopsSnapshot {
    return !!s && now - s.fetched_at < ttlMs && (needAfter == null || s.fetched_at >= needAfter)
  }

  function get(key: string, fetch: StopsFetcher, opts: StopGetOptions = {}): Promise<StopsSnapshot> {
    const now = deps.now()
    const cached = peek(key)
    if (!opts.force && fresh(cached, now, opts.needAfter)) return Promise.resolve(cached)
    const running = inflight.get(key)
    if (running) return running
    const range = { from: now - days * 86400e3, to: now }
    const p = fetch(range).then(stops => {
      const snap: StopsSnapshot = { key, fetched_at: now, from: range.from, to: range.to, stops }
      memory.set(key, snap)
      try { deps.save(snap) } catch { /* 缓存写不进去不影响使用 */ }
      return snap
    })
    inflight.set(key, p)
    const done = () => { if (inflight.get(key) === p) inflight.delete(key) }
    p.then(done, done)
    return p
  }

  return { get, peek, loading: key => inflight.has(key) }
}
