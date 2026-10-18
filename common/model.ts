// 应用层：读写文件、调度同步与提供方。也是入口文件（index.tsx、widget.tsx）唯一导入的模块，
// 入口需要的东西都从这里再导出（scripting-cli 打包器的限制）。
import { LngLat, metres } from "./geo"
import { newId } from "./ids"
import {
  AppData, categoriesFor, currentVehicle, fuelRecords, linkLocalVehicle, makeAppData, materializeAll, putExpense, putFuel,
  removeRecord, stationsFor, vehiclesForCars, vehicleRecords,
} from "./ledger"
import { rankStops, findStops, Stop } from "./stops"
import { ExpenseData, FuelData, LedgerFile, LedgerRecord, ProviderId, Settings, Station, StationCandidate, Vehicle } from "./types"
import { monthCost, summarize, Summary } from "./stats"
import { fmtDate, fmtTime } from "./time"
import { scriptingHttp } from "../platform/scripting_http"
import {
  getJsonSecret, getSecret, providerSecretKey, removeSecret, SECRET_AMAP_KEY, SECRET_XXYH_TOKEN, setJsonSecret, setSecret,
} from "../platform/secrets"
import { readLedger, readXxyhState, saveLedger, saveSnapshot, saveXxyhState, writeExport } from "../platform/storage"
import { providerById } from "../providers/registry"
import { Credential, RemoteVehicle } from "../providers/types"
import { amapSearcher, StationSearcher, xxyhSearcher } from "../stations/search"
import { candidateFromPoi, stationPoint } from "../stations/match"
import { accountInfo, parseXxyhToken, XxyhError } from "../sync/xxyh/api"
import { describeOp } from "../sync/xxyh/ops"
import { pull, push, Snapshot } from "../sync/xxyh/sync"
import { emptyXxyhState, XxyhState } from "../sync/xxyh/types"

export type { AppData } from "./ledger"
export type { Stop } from "./stops"
export type { Summary } from "./stats"
export * from "./types"
export {
  categoriesFor, categoryName, currentVehicle, fuelRecords, pendingCount, stationsFor, toExpenseData, toFuelData, usualGrade,
  vehicleById, vehicleRecords,
} from "./ledger"
export { consumptionById } from "./fuel"
export { checkExpense, checkFuel, completeTriple, numText, parseNum } from "./form"
export type { Triple, TripleField } from "./form"
export { consumptionSeries, monthlyCosts, RANGE_TITLES, summarize } from "./stats"
export type { StatsRange } from "./stats"
export { daysAgoText, durationText, fmtDate, fmtDateTime, fmtDay, fmtShort, fmtTime, monthKey, monthTitle } from "./time"
export { distanceText } from "./geo"
export { PROVIDERS, providerById } from "../providers/registry"
export type { RemoteVehicle, VehicleDataProvider } from "../providers/types"
export { maskSecret } from "../platform/secrets"

// ---------- 读写 ----------

export function loadData(): { data: AppData; warnings: string[] } {
  const l = readLedger()
  const x = readXxyhState()
  return { data: makeAppData(l.ledger, x.state), warnings: [l.warning, x.warning].filter((w): w is string => !!w) }
}

function commit(ledger: LedgerFile, xxyh: XxyhState): AppData {
  saveLedger(ledger)
  saveXxyhState(xxyh)
  return makeAppData(ledger, xxyh)
}

function saveSnapshots(list: Snapshot[]): void {
  for (const s of list) {
    try { saveSnapshot(s.version, s.doc) } catch { /* 快照失败不影响同步 */ }
  }
}

export function updateSettings(data: AppData, patch: Partial<Settings>): AppData {
  const ledger = { ...data.ledger, settings: { ...data.ledger.settings, ...patch } }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

// ---------- 车辆 ----------

export function addVehicle(data: AppData, name: string, grade: number | null): AppData {
  const v: Vehicle = { id: newId("v"), name: name.trim() || "我的车", default_grade: grade, created_ts: Date.now(), xxyh_car: null, provider: null }
  const ledger = { ...data.ledger, vehicles: [...data.ledger.vehicles, v], settings: { ...data.ledger.settings, current_vehicle_id: v.id } }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

export function updateVehicle(data: AppData, v: Vehicle): AppData {
  const ledger = { ...data.ledger, vehicles: data.ledger.vehicles.map(x => (x.id === v.id ? v : x)) }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

/** 只能删本机车辆（连同它的本机记录） */
export function deleteVehicle(data: AppData, id: string): AppData {
  const v = data.ledger.vehicles.find(x => x.id === id)
  if (!v) return data
  if (v.xxyh_car) throw new Error("关联了小熊油耗的车辆不能删除，请先断开小熊油耗")
  const vehicles = data.ledger.vehicles.filter(x => x.id !== id)
  const ledger: LedgerFile = {
    ...data.ledger, vehicles, records: data.ledger.records.filter(r => r.vehicle_id !== id),
    settings: { ...data.ledger.settings, current_vehicle_id: vehicles[0]?.id ?? null },
  }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

// ---------- 记录 ----------

export function saveFuel(data: AppData, vehicle: Vehicle, recordId: string | null, fuel: FuelData, newStation: Station | null): { data: AppData; linked: boolean } {
  const c = putFuel(data, vehicle, recordId, fuel, newStation)
  return { data: commit(c.ledger, c.xxyh), linked: c.linked }
}

export function saveExpense(data: AppData, vehicle: Vehicle, recordId: string | null, expense: ExpenseData): { data: AppData; linked: boolean } {
  const c = putExpense(data, vehicle, recordId, expense)
  return { data: commit(c.ledger, c.xxyh), linked: c.linked }
}

export function deleteRecord(data: AppData, vehicle: Vehicle, record: LedgerRecord): { data: AppData; linked: boolean } {
  const c = removeRecord(data, vehicle, record)
  return { data: commit(c.ledger, c.xxyh), linked: c.linked }
}

// ---------- 小熊油耗 ----------

export const xxyhToken = () => getSecret(SECRET_XXYH_TOKEN)
export const xxyhConnected = (data: AppData) => !!(xxyhToken() && data.xxyh.base)

export function errorText(error: unknown): string {
  if (error instanceof XxyhError && error.kind === "auth") return `${error.message}。请在「设置 › 小熊油耗」重新粘贴凭据。`
  return error instanceof Error ? error.message : String(error)
}

/** 连接小熊：校验凭据、下载最新版本、为还没关联的车辆新建油记车辆 */
export async function connectXxyh(data: AppData, text: string): Promise<{ data: AppData; message: string }> {
  const token = parseXxyhToken(text)
  if (!token) throw new Error("没有识别出小熊油耗的凭据")
  const acct = await accountInfo(scriptingHttp, token)
  if (data.xxyh.account_id && acct.account_id && data.xxyh.account_id !== acct.account_id) {
    throw new Error("这是另一个小熊账号。请先断开当前账号（数据会保留在本机），再连接新账号。")
  }
  const r = await pull(scriptingHttp, token, data.xxyh)
  const state = r.state
  if (!state.base) throw new Error("这个小熊账号还没有云备份，请先在小熊油耗 App 或网页版里记一条并备份")
  saveSnapshots(r.snapshot ? [r.snapshot] : [])
  setSecret(SECRET_XXYH_TOKEN, token)
  const ledger = vehiclesForCars(data.ledger, makeAppData(data.ledger, state).mirror.cars)
  const next = commit(ledger, state)
  const cars = next.mirror.cars
  return { data: next, message: `已连接小熊油耗（云端 v${state.base_version ?? "—"}，${cars.length} 辆车，${cars.reduce((s, c) => s + c.fuel_count, 0)} 条加油）` }
}

/** 断开：当前显示的数据转成本机数据；清除凭据和同步状态 */
export function disconnectXxyh(data: AppData): AppData {
  const ledger = materializeAll(data)
  removeSecret(SECRET_XXYH_TOKEN)
  return commit(ledger, emptyXxyhState())
}

export function linkVehicleToXxyh(data: AppData, vehicleId: string, car: string): { data: AppData; added: number; skipped: number } {
  const c = linkLocalVehicle(data, vehicleId, car)
  return { data: commit(c.ledger, c.xxyh), added: c.added, skipped: c.skipped }
}

export type SyncResult = { data: AppData; message: string | null; error: string | null }

let lastAutoSync = 0

/** 拉取；需要时上传。失败时保留修改并记下错误 */
export async function syncXxyh(data: AppData, opts: { upload: boolean }): Promise<SyncResult> {
  const token = xxyhToken()
  if (!token || !data.xxyh.base) return { data, message: null, error: null }
  try {
    if (opts.upload && data.xxyh.ops.length) {
      const r = await push(scriptingHttp, token, data.xxyh)
      saveSnapshots(r.snapshots)
      const next = commit(data.ledger, r.state)
      const parts: string[] = []
      if (r.uploaded) parts.push(`已上传到小熊油耗（v${r.version}）`)
      if (r.conflicts.length) parts.push(`${r.conflicts.length} 条修改与云端冲突，已放弃：${r.conflicts.map(c => describeOp(c.op)).join("、")}`)
      if (r.notes.length) parts.push(r.notes.join("；"))
      if (r.warnings.length) parts.push(`小熊提示：${r.warnings.join("；")}`)
      return { data: next, message: parts.join("。") || null, error: null }
    }
    const r = await pull(scriptingHttp, token, data.xxyh)
    saveSnapshots(r.snapshot ? [r.snapshot] : [])
    const ledger = r.changed ? vehiclesForCars(data.ledger, makeAppData(data.ledger, r.state).mirror.cars) : data.ledger
    const next = commit(ledger, r.state)
    return { data: next, message: r.changed ? `已更新为云端 v${r.state.base_version}` : null, error: null }
  } catch (error) {
    const msg = errorText(error)
    const xxyh = { ...data.xxyh, last_error: msg }
    saveXxyhState(xxyh)
    return { data: makeAppData(data.ledger, xxyh), message: null, error: msg }
  }
}

/** 打开 App、回到前台：2 分钟内只同步一次 */
export async function autoSync(data: AppData): Promise<SyncResult | null> {
  if (Date.now() - lastAutoSync < 120e3 || !xxyhConnected(data)) return null
  lastAutoSync = Date.now()
  return syncXxyh(data, { upload: data.ledger.settings.xxyh_auto_upload })
}

/** 保存修改后：开了自动上传就立即上传 */
export async function afterChange(data: AppData, linked: boolean): Promise<SyncResult | null> {
  if (!linked || !data.ledger.settings.xxyh_auto_upload || !xxyhConnected(data)) return null
  return syncXxyh(data, { upload: true })
}

// ---------- 车辆数据提供方 ----------

export const providerCredential = (id: ProviderId): Credential | null => getJsonSecret(providerSecretKey(id))

const providerCtx = () => ({ http: scriptingHttp, now: () => Date.now() })

/** 校验并保存凭据，返回账号下的车辆 */
export async function connectProvider(id: ProviderId, input: Credential): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  if (!p) throw new Error("未知的车辆数据提供方")
  const cred = p.normalizeCredential(input)
  const vehicles = await p.listVehicles(providerCtx(), cred)
  setJsonSecret(providerSecretKey(id), cred)
  return vehicles
}

export async function providerVehicles(id: ProviderId): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred) return []
  return p.listVehicles(providerCtx(), cred)
}

/** 断开提供方：删除凭据，并解除所有车辆的关联 */
export function disconnectProvider(data: AppData, id: ProviderId): AppData {
  removeSecret(providerSecretKey(id))
  const ledger = { ...data.ledger, vehicles: data.ledger.vehicles.map(v => (v.provider?.id === id ? { ...v, provider: null } : v)) }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

// ---------- 油站搜索 ----------

export const amapKey = () => getSecret(SECRET_AMAP_KEY)
export const setAmapKey = (key: string) => setSecret(SECRET_AMAP_KEY, key)

function searcher(data: AppData): StationSearcher | null {
  const mode = data.ledger.settings.station_search
  const amap = amapKey()
  const token = xxyhToken()
  if (mode === "off") return null
  if ((mode === "amap" || mode === "auto") && amap) return amapSearcher(scriptingHttp, amap)
  if ((mode === "xxyh" || mode === "auto") && token) return xxyhSearcher(scriptingHttp, token)
  return null
}

export function searcherName(data: AppData): string {
  return searcher(data)?.name || "不搜索，只用我的油站"
}

/** 最近几天的停车，加油停车在前 */
export async function recentStops(data: AppData, vehicle: Vehicle, days = 7): Promise<Stop[]> {
  if (!vehicle.provider) throw new Error("这辆车没有关联车辆数据")
  const p = providerById(vehicle.provider.id)
  const cred = providerCredential(vehicle.provider.id)
  if (!p || !cred) throw new Error(`未连接${p ? p.name : "车辆数据"}，请在设置中连接`)
  const now = Date.now()
  const trips = await p.fetchTrips(providerCtx(), cred, vehicle.provider.vehicle_id, { from: now - days * 86400e3, to: now })
  const s = searcher(data)
  const stops = await findStops(trips, { stations: stationsFor(data, vehicle), fuel: fuelRecords(data, vehicle), nearby: s ? (pt, r) => s.nearby(pt, r) : null, now })
  return rankStops(stops)
}

/** 选油站：附近（以 center 为中心）或关键字；都没有时按最近使用排序 */
export async function stationCandidates(data: AppData, vehicle: Vehicle | null, center: LngLat | null, keyword: string): Promise<{ list: StationCandidate[]; error: string | null }> {
  const mine = stationsFor(data, vehicle)
  const now = Date.now()
  const out: StationCandidate[] = []
  const seen = new Set<string>()
  const add = (c: StationCandidate) => {
    if (seen.has(c.station.id)) return
    seen.add(c.station.id)
    out.push(c)
  }
  const s = searcher(data)
  let error: string | null = null
  const kw = keyword.trim()
  if (kw) {
    for (const st of mine.filter(x => x.name.includes(kw) || x.address.includes(kw)).slice(0, 8)) add({ kind: "mine", station: st, dist: center ? metres(stationPoint(st), center) : null })
    if (s && s.keyword) {
      const city = center ? (mine.slice().sort((a, b) => metres(stationPoint(a), center) - metres(stationPoint(b), center))[0]?.city || "") : ""
      try { for (const poi of await s.keyword(kw, city)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    }
    return { list: out, error }
  }
  if (center) {
    mine.map(st => ({ st, d: metres(stationPoint(st), center) })).filter(x => x.d <= 3000).sort((a, b) => a.d - b.d).slice(0, 5)
      .forEach(x => add({ kind: "mine", station: x.st, dist: x.d }))
    if (s) {
      try { for (const poi of await s.nearby(center, 2000)) add(candidateFromPoi(poi, mine, center, now)) } catch (e) { error = errorText(e) }
    }
    return { list: out.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)).slice(0, 12), error }
  }
  mine.slice().sort((a, b) => b.last_used_ts - a.last_used_ts).slice(0, 30).forEach(st => add({ kind: "mine", station: st, dist: null }))
  return { list: out, error }
}

// ---------- 导出与小组件 ----------

export function exportData(data: AppData): string {
  const vehicles = data.ledger.vehicles.map(v => ({ ...v, records: vehicleRecords(data, v) }))
  const payload = {
    app: "fuelnote", schema_version: 1, exported_at: new Date().toISOString(), vehicles,
    stations: { local: data.ledger.stations, xxyh: data.mirror.stations },
    expense_categories: categoriesFor(data),
  }
  const d = new Date()
  const name = `fuelnote-${fmtDate(d.getTime()).replace(/-/g, "")}-${fmtTime(d.getTime()).replace(":", "")}.json`
  return writeExport(name, JSON.stringify(payload, null, 1))
}

export type WidgetSnapshot = {
  vehicle: string | null
  summary: Summary | null
  month_cost: number
  pending: number
}

export function widgetSnapshot(): WidgetSnapshot {
  const { data } = loadData()
  const v = currentVehicle(data)
  if (!v) return { vehicle: null, summary: null, month_cost: 0, pending: 0 }
  const records = vehicleRecords(data, v)
  return { vehicle: v.name, summary: summarize(records, "all"), month_cost: monthCost(records), pending: data.xxyh.ops.length }
}
