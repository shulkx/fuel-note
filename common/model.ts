// 应用层：读写文件、调度同步与提供方。也是入口文件（index.tsx、widget.tsx）唯一导入的模块，
// 入口需要的东西都从这里再导出（scripting-cli 打包器的限制）。
import { Script } from "scripting"
import { LngLat, metres } from "./geo"
import { newId } from "./ids"
import {
  addCarVehicle, AppData, carUuidFor, categoriesFor, convertDeletedCars, convertToLocal, convertToXxyh, currentVehicle, deletedCarsNotice, EMPTY_PROFILE,
  fuelRecords, makeAppData, materializeAll, newCars,
  putExpense, putFuel, removeRecord, setCarIgnored, setHidden, stationsFor, vehiclesForCars, vehicleRecords,
} from "./ledger"
import { findStops, openRefuelStop, rankStops, refreshStops, Stop } from "./stops"
import { createStopSource, paymentStopsRange, StopGetOptions, StopsSnapshot } from "./stop_source"
import { createStatusSource, StatusSnapshot } from "./status_source"
import {
  AssistantModel, ExpenseData, FuelData, FuelRecord, LedgerFile, LedgerRecord, OcrEngine, ProviderId, ProviderLink, Settings, Station, StationCandidate, Vehicle,
  VehicleProfile,
} from "./types"
import { CarSpec, CatalogBrand, CatalogItem, fetchBrands, fetchModels, fetchSeries, fetchSpec, replenishModeOf } from "../sync/xxyh/catalog"
import { DEFAULT_RANGE, isStatsRange, monthCost, StatsRange, summarize, yearSummaries } from "./stats"
import { consumptionById } from "./fuel"
import { fmtDate, fmtShort, fmtTime } from "./time"
import { probeBinaryPost, scriptingHttp } from "../platform/scripting_http"
import { volvoStatusRequest } from "../providers/volvo_cn"
import {
  getJsonSecret, getSecret, providerSecretKey, providerSessionKey, removeSecret, SECRET_AMAP_KEY, SECRET_AZURE, SECRET_XXYH_TOKEN, setJsonSecret,
  setSecret,
} from "../platform/secrets"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { jpegForUpload, recognizeLocal } from "../platform/vision"
import { assistantAvailable, pingAssistant, recognizeAssistant } from "../platform/assistant"
import { AzureConfig, azureReady, pingAzure, recognizeAzure } from "../readers/azure"
import { CityPrices, PriceRef, priceRefAt, ReceiptResult, receiptScore, receiptUsable } from "./receipt"
import { localUsable } from "./receipt_rules"
import { BackupFile, decryptSecrets, encryptSecrets, makeBackup, parseBackup, restoredXxyh } from "./backup"
import {
  readCache, readLedger, readStatusCache, readXxyhState, saveLedger, saveSnapshot, saveStatusSnapshot, saveWidgetFile, saveXxyhState, writeCache,
  writeExport,
} from "../platform/storage"
import { WidgetSnapshot } from "./widget_data"
import { providerById, PROVIDERS } from "../providers/registry"
import { Credential, RemoteVehicle, VehicleStatus } from "../providers/types"
import { createPoiCache, PoiCacheEntries } from "../stations/poi_cache"
import { amapSearcher, StationSearcher, xxyhSearcher } from "../stations/search"
import { candidateFromPoi, stationPoint } from "../stations/match"
import { accountInfo, cityPrices, parseXxyhToken, price92History, XxyhError } from "../sync/xxyh/api"
import { describeOp } from "../sync/xxyh/ops"
import { pull, push, Snapshot } from "../sync/xxyh/sync"
import { newCarUuid, XxyhCarInfo } from "../sync/xxyh/mapping"
import { emptyXxyhState, XxyhState } from "../sync/xxyh/types"

export type { AppData } from "./ledger"
export type { Stop } from "./stops"
export { rankStops } from "./stops"
export type { Summary } from "./stats"
export * from "./types"
// 打包器只认单行、末尾没有逗号的 export … from
export { categoriesFor, categoryName, currentVehicle, fuelRecords, pendingCount, stationsFor, visibleVehicles } from "./ledger"
export { toExpenseData, toFuelData, usualGrade, vehicleById, vehicleRecords } from "./ledger"
export { consumptionById } from "./fuel"
export { currentTank, fuelLow, fuelRatio, statusWhen } from "./widget_data"
export type { CurrentTank, FuelTone } from "./widget_data"
export type { StatusSnapshot } from "./status_source"
export { checkExpense, checkFuel, completeTriple, keptNumber, numText, parseNum } from "./form"
export type { Triple, TripleField } from "./form"
export { consumptionSeries, monthlyCosts, priceSeries, RANGE_TITLES, RANGES, summarize, yearOverYear, yearSummaries } from "./stats"

const STATS_RANGE_KEY = "fuelnote.stats_range"

/** 统计页上次选的范围：只是这台手机上的界面偏好，存在 Storage，不进账本和备份 */
export function savedStatsRange(): StatsRange {
  try {
    const v = Storage.get(STATS_RANGE_KEY)
    return isStatsRange(v) ? v : DEFAULT_RANGE
  } catch {
    return DEFAULT_RANGE
  }
}

export function saveStatsRange(range: StatsRange): void {
  try { Storage.set(STATS_RANGE_KEY, range) } catch { /* 下次用默认范围 */ }
}
export type { MonthCost, PricePoint, StatsRange, YearOverYear, YearSummary } from "./stats"
export { monthCategories, niceDomain, timeCategories, YEAR_MONTHS } from "./chart_axis"
export { daysAgoText, durationText, fmtDate, fmtDateTime, fmtDay, fmtShort, fmtTime, monthKey, monthTitle } from "./time"
export { distanceText } from "./geo"
export { PROVIDERS, providerById } from "../providers/registry"
export type { RemoteVehicle, VehicleDataProvider, VehicleStatus } from "../providers/types"
export { maskSecret } from "../platform/secrets"
export type { ReceiptResult } from "./receipt"
export type { AzureConfig } from "../readers/azure"
export type { CarSpec, CatalogBrand, CatalogItem, ModelGroup } from "../sync/xxyh/catalog"
export { gradeOf, groupBrands, groupModels, UNSUPPORTED_STATUS } from "../sync/xxyh/catalog"
export { amountFixes, decideGrade, derivedEvidence, fillFromReceipt, fillWarnings, findDuplicate, gradeEvidence, isInferred, SOURCE_TITLES, stopForPayment } from "./draft"
export type { FieldSource, GradeDecision, ImageOrigin, MoneyField, ReceiptFill, StopChoice } from "./draft"

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

export type NewVehicle = {
  name: string
  grade: number | null
  profile: VehicleProfile | null
  provider: ProviderLink | null
  /** 保存位置：小熊时在云端新建这辆车（add_car，之后由调用方上传） */
  location: "local" | "xxyh"
}

/** 添加车辆并切换到它（设计文档 17.4 节）。关联车辆数据时，原来关联这辆远端车的车辆解除关联 */
export function addVehicle(data: AppData, input: NewVehicle): AppData {
  const name = input.name.trim() || "我的车"
  const inXxyh = input.location === "xxyh"
  if (inXxyh && !xxyhConnected(data)) throw new Error("没有连接小熊油耗")
  const uuid = inXxyh ? newCarUuid(takenCarUuids(data)) : null
  const v: Vehicle = {
    id: newId("v"), name, default_grade: input.grade, created_ts: Date.now(), xxyh_car: uuid, provider: input.provider,
    ...(input.profile && !inXxyh ? { profile: input.profile } : {}),
  }
  const others = input.provider
    ? data.ledger.vehicles.map(x => (x.provider && x.provider.id === input.provider!.id && x.provider.vehicle_id === input.provider!.vehicle_id ? { ...x, provider: null } : x))
    : data.ledger.vehicles
  const ledger = { ...data.ledger, vehicles: [...others, v], settings: { ...data.ledger.settings, current_vehicle_id: v.id } }
  if (!uuid) {
    saveLedger(ledger)
    return makeAppData(ledger, data.xxyh)
  }
  const xxyh = { ...data.xxyh, ops: [...data.xxyh.ops, { type: "add_car" as const, car: uuid, name, profile: input.profile ?? EMPTY_PROFILE, at: Date.now() }] }
  return commit(ledger, xxyh)
}

export function setVehicleHidden(data: AppData, id: string, hidden: boolean): AppData {
  const ledger = setHidden(data.ledger, id, hidden)
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

/** 车辆资料：小熊车辆取云端的车（车型名称按需查车型库），本机车辆取添加时填的 */
export function vehicleProfile(data: AppData, v: Vehicle): VehicleProfile | null {
  if (v.xxyh_car) return data.mirror.cars.find(c => c.uuid === v.xxyh_car)?.profile ?? null
  return v.profile ?? null
}

// ---------- 小熊车型库（sync/xxyh/catalog.ts） ----------

const CATALOG_FILE = "catalog_cache.json"
const CATALOG_TTL = 30 * 86400e3
type CatalogFile = { schema_version: 1; brands?: { at: number; list: CatalogBrand[] }; specs?: Record<string, CarSpec> }

let brandsPromise: Promise<CatalogBrand[]> | null = null
const seriesCache = new Map<number, Promise<CatalogItem[]>>()
const modelsCache = new Map<string, Promise<CatalogItem[]>>()
const specCache = new Map<number, Promise<CarSpec | null>>()

const readCatalog = (): CatalogFile => readCache<CatalogFile>(CATALOG_FILE) || { schema_version: 1 }

/** 品牌列表：文件缓存 30 天 */
export function catalogBrands(): Promise<CatalogBrand[]> {
  if (!brandsPromise) {
    const cached = readCatalog().brands
    brandsPromise = cached && Date.now() - cached.at < CATALOG_TTL && cached.list.length
      ? Promise.resolve(cached.list)
      : fetchBrands(scriptingHttp).then(list => {
        try { writeCache(CATALOG_FILE, { ...readCatalog(), brands: { at: Date.now(), list } }) } catch { /* 下次再缓存 */ }
        return list
      })
    brandsPromise.catch(() => { brandsPromise = null })
  }
  return brandsPromise
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, load: () => Promise<V>): Promise<V> {
  let p = map.get(key)
  if (!p) {
    p = load()
    map.set(key, p)
    p.catch(() => map.delete(key))
  }
  return p
}

export const catalogSeries = (brand: number) => memo(seriesCache, brand, () => fetchSeries(scriptingHttp, brand))
export const catalogModels = (brand: number, series: number) => memo(modelsCache, `${brand}/${series}`, () => fetchModels(scriptingHttp, brand, series))

/** 车型参数：文件里有就不再请求（车型参数不会变） */
export function catalogSpec(model: number): Promise<CarSpec | null> {
  return memo(specCache, model, async () => {
    const cached = readCatalog().specs?.[String(model)]
    if (cached) return cached
    const spec = await fetchSpec(scriptingHttp, model)
    if (spec) {
      try { const f = readCatalog(); writeCache(CATALOG_FILE, { ...f, specs: { ...(f.specs || {}), [String(model)]: spec } }) } catch { /* 下次再缓存 */ }
    }
    return spec
  })
}

/** 选好的车型 → 车辆资料 */
export function profileFromSpec(spec: CarSpec | null, buyDate: string | null): VehicleProfile {
  return {
    model: spec ? spec.id : null,
    model_name: spec ? spec.name : null,
    pinpai: spec ? spec.pinpai : null,
    chexi: spec ? spec.chexi : null,
    vehicle_type: spec ? spec.vehicle_type : null,
    replenish_mode: spec ? replenishModeOf(spec.fuel_type) : null,
    gas_type: spec ? spec.gas_type : null,
    buy_date: buyDate,
  }
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
  let vehicles = data.ledger.vehicles.filter(x => x.id !== id)
  // 至少保留一辆没有隐藏的车辆
  if (vehicles.length && vehicles.every(x => x.hidden)) vehicles = vehicles.map((x, i) => (i === 0 ? { ...x, hidden: false } : x))
  const current = data.ledger.settings.current_vehicle_id
  const ledger: LedgerFile = {
    ...data.ledger, vehicles, records: data.ledger.records.filter(r => r.vehicle_id !== id),
    settings: { ...data.ledger.settings, current_vehicle_id: current !== id && vehicles.some(x => x.id === current) ? current : vehicles.find(x => !x.hidden)?.id ?? null },
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
  if (!r.state.base) throw new Error("这个小熊账号还没有云备份，请先在小熊油耗 App 或网页版里记一条并备份")
  saveSnapshots(r.snapshot ? [r.snapshot] : [])
  setSecret(SECRET_XXYH_TOKEN, token)
  // 重新连接同一个账号时，期间在云端删除的车转为本机车辆
  const del = convertDeletedCars(data, r.state)
  const state = del.xxyh
  const ledger = vehiclesForCars(del.ledger, makeAppData(del.ledger, state).mirror.cars)
  const next = commit(ledger, state)
  const deleted = deletedCarsNotice(del.converted)
  const cars = next.mirror.cars
  const fresh = newCars(next.ledger, cars).length
  return {
    data: next,
    message: `已连接小熊油耗（云端 v${state.base_version ?? "—"}，${cars.length} 辆车，${cars.reduce((s, c) => s + c.fuel_count, 0)} 条加油）`
      + (fresh ? `。其中 ${fresh} 辆还没有加到油记，请在下面的「小熊里的车辆」里添加或忽略。` : "")
      + (deleted ? `\n\n${deleted}` : ""),
  }
}

/** 断开：当前显示的数据转成本机数据；清除凭据和同步状态 */
export function disconnectXxyh(data: AppData): AppData {
  const ledger = materializeAll(data)
  removeSecret(SECRET_XXYH_TOKEN)
  return commit(ledger, emptyXxyhState())
}

// ---------- 本机与小熊互相转换（设计文档 17.5、17.6、17.8 节）。不做合并 ----------

/** 已用的车辆 uuid：云端的车和待上传的 add_car */
function takenCarUuids(data: AppData): Set<string> {
  return new Set([
    ...(data.xxyh.base?.cars || []).map(c => String(c.uuid)),
    ...data.xxyh.ops.map(op => op.car),
  ])
}

/** 本机车辆 → 小熊：在小熊新建这辆车并上传它的全部记录（之后由调用方上传） */
export function convertVehicleToXxyh(data: AppData, vehicleId: string): AppData {
  const v = data.ledger.vehicles.find(x => x.id === vehicleId)
  if (!v) throw new Error("找不到车辆")
  const c = convertToXxyh(data, vehicleId, carUuidFor(v, takenCarUuids(data)))
  return commit(c.ledger, c.xxyh)
}

/** 小熊车辆 → 本机：复制记录和资料，云端不动 */
export function convertVehicleToLocal(data: AppData, vehicleId: string): AppData {
  return commit(convertToLocal(data, vehicleId), data.xxyh)
}

/** 这辆车还没上传的修改条数 */
export const pendingForVehicle = (data: AppData, v: Vehicle): number => (v.xxyh_car ? data.xxyh.ops.filter(op => op.car === v.xxyh_car).length : 0)

/** 小熊里还没有加到油记、也没有被忽略的车 */
export const xxyhNewCars = (data: AppData): XxyhCarInfo[] => (xxyhConnected(data) ? newCars(data.ledger, data.mirror.cars) : [])

/** 被忽略的小熊车（含转为本机车辆的） */
export const xxyhIgnoredCars = (data: AppData): XxyhCarInfo[] => {
  const ignored = new Set(data.ledger.xxyh_ignored_cars || [])
  return data.mirror.cars.filter(c => ignored.has(c.uuid) && !data.ledger.vehicles.some(v => v.xxyh_car === c.uuid))
}

export function addXxyhCar(data: AppData, uuid: string): AppData {
  const car = data.mirror.cars.find(c => c.uuid === uuid)
  if (!car) throw new Error("云端没有这辆车")
  const ledger = addCarVehicle(data.ledger, car)
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

export function setXxyhCarIgnored(data: AppData, uuid: string, ignored: boolean): AppData {
  const ledger = setCarIgnored(data.ledger, uuid, ignored)
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

/** message 显示在标题下方；alert 是需要用户留意的内容（冲突、被清掉的油站、小熊的提示），弹窗显示 */
export type SyncResult = { data: AppData; message: string | null; error: string | null; alert: string | null }

let lastAutoSync = 0
let inflight: Promise<unknown> | null = null

/** 关闭油记前调用：等正在进行的同步（尤其是上传）结束，最多等 maxMs */
export async function waitForPendingSync(maxMs = 20000): Promise<void> {
  if (!inflight) return
  await Promise.race([inflight.catch(() => undefined), new Promise<void>(resolve => setTimeout(() => resolve(), maxMs))])
}

/** 拉取；需要时上传。失败时保留修改并记下错误 */
export function syncXxyh(data: AppData, opts: { upload: boolean }): Promise<SyncResult> {
  const p = doSyncXxyh(data, opts)
  inflight = p
  p.finally(() => { if (inflight === p) inflight = null })
  return p
}

async function doSyncXxyh(data: AppData, opts: { upload: boolean }): Promise<SyncResult> {
  const token = xxyhToken()
  if (!token || !data.xxyh.base) return { data, message: null, error: null, alert: null }
  try {
    // 先拉取：云端删除的车要在旧版本被替换之前转为本机车辆（设计文档 17.12 节），它的待上传修改一并保留
    const pulled = await pull(scriptingHttp, token, data.xxyh)
    saveSnapshots(pulled.snapshot ? [pulled.snapshot] : [])
    const del = pulled.changed ? convertDeletedCars(data, pulled.state) : { ledger: data.ledger, xxyh: pulled.state, converted: [] }
    const ledger = pulled.changed ? vehiclesForCars(del.ledger, makeAppData(del.ledger, del.xxyh).mirror.cars) : data.ledger
    const alerts: string[] = []
    const deleted = deletedCarsNotice(del.converted)
    if (deleted) alerts.push(deleted)

    if (opts.upload && del.xxyh.ops.length) {
      // 上传途中切到后台也不要被挂起（只在主界面环境有效）
      const kept = await BackgroundKeeper.keepAlive().catch(() => false)
      let r
      try {
        r = await push(scriptingHttp, token, del.xxyh)
      } finally {
        if (kept) BackgroundKeeper.stopKeepAlive().catch(() => undefined)
      }
      saveSnapshots(r.snapshots)
      const next = commit(ledger, r.state)
      if (r.conflicts.length) alerts.push(`${r.conflicts.length} 条修改与云端冲突，已放弃：\n${r.conflicts.map(c => `· ${describeOp(c.op)}：${c.reason}`).join("\n")}`)
      if (r.notes.length) alerts.push(r.notes.join("\n"))
      if (r.warnings.length) alerts.push(`小熊油耗提示：${r.warnings.join("；")}`)
      return { data: next, message: r.uploaded ? `已上传到小熊油耗 v${r.version}` : null, error: null, alert: alerts.join("\n\n") || null }
    }
    const next = commit(ledger, del.xxyh)
    return { data: next, message: pulled.changed ? `已更新为云端 v${del.xxyh.base_version}` : null, error: null, alert: alerts.join("\n\n") || null }
  } catch (error) {
    const msg = errorText(error)
    const xxyh = { ...data.xxyh, last_error: msg }
    saveXxyhState(xxyh)
    return { data: makeAppData(data.ledger, xxyh), message: null, error: msg, alert: null }
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

/** 记录页标题下方的副标题：同步状态 */
export function syncSubtitle(data: AppData, now = Date.now()): string | null {
  if (!xxyhConnected(data)) return data.ledger.vehicles.length ? "只在本机" : null
  const x = data.xxyh
  const v = x.base_version ? `小熊油耗 v${x.base_version}` : "小熊油耗"
  if (x.ops.length) return `${v} · ${x.ops.length} 条待上传`
  if (x.last_error) return `${v} · 同步失败`
  const t = Math.max(x.last_pull_ts || 0, x.last_push_ts || 0)
  if (!t) return v
  const min = Math.round((now - t) / 60e3)
  return `${v} · ${min < 1 ? "刚刚同步" : min < 60 ? `${min} 分钟前同步` : `${fmtShort(t)} 同步`}`
}

// ---------- 车辆数据提供方 ----------

export { providerCredential } from "../platform/provider_ctx"

/** 校验并保存凭据，返回账号下的车辆 */
export async function connectProvider(id: ProviderId, input: Credential): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  if (!p) throw new Error("未知的车辆数据提供方")
  const cred = p.normalizeCredential(input)
  const vehicles = await p.listVehicles(providerCtx(id), cred)
  setJsonSecret(providerSecretKey(id), cred)
  return vehicles
}

/** 诊断车况请求（只支持沃尔沃）：几种请求体写法各发一次，列出结果 */
export async function diagnoseVehicleStatus(id: ProviderId, vehicleId: string): Promise<string[]> {
  const cred = providerCredential(id)
  if (id !== "volvo_cn" || !cred) return ["这个车辆数据提供方不支持车况"]
  const req = await volvoStatusRequest(providerCtx(id), cred, vehicleId)
  return probeBinaryPost(req.url, req.headers, req.body)
}

/** 读车况（剩余油量等，设计文档 18.1 节）；提供方不支持时返回 null */
export async function providerVehicleStatus(id: ProviderId, vehicleId: string): Promise<VehicleStatus | null> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred || !p.vehicleStatus) return null
  return p.vehicleStatus(providerCtx(id), cred, vehicleId)
}

export async function providerVehicles(id: ProviderId): Promise<RemoteVehicle[]> {
  const p = providerById(id)
  const cred = providerCredential(id)
  if (!p || !cred) return []
  return p.listVehicles(providerCtx(id), cred)
}

/** 断开提供方：删除凭据和会话缓存，并解除所有车辆的关联 */
export function disconnectProvider(data: AppData, id: ProviderId): AppData {
  removeSecret(providerSecretKey(id))
  removeSecret(providerSessionKey(id))
  const ledger = { ...data.ledger, vehicles: data.ledger.vehicles.map(v => (v.provider?.id === id ? { ...v, provider: null } : v)) }
  saveLedger(ledger)
  return makeAppData(ledger, data.xxyh)
}

// ---------- 油站搜索 ----------

export const amapKey = () => getSecret(SECRET_AMAP_KEY)
export const setAmapKey = (key: string) => setSecret(SECRET_AMAP_KEY, key)

/** 用这个 key 实际查一次附近加油站（上海人民广场 2 km）；key 无效、额度用完时抛出高德的错误信息 */
export async function testAmapKey(key: string): Promise<string> {
  const t0 = Date.now()
  const pois = await amapSearcher(scriptingHttp, key).nearby([121.4691, 31.2323], 2000)
  return `查到 ${pois.length} 个加油站，${((Date.now() - t0) / 1000).toFixed(1)} 秒`
}

type PoiCacheFile = { schema_version: 1; entries: PoiCacheEntries }
const POI_CACHE_FILE = "poi_cache.json"

/** 附近搜索的结果按坐标缓存 30 天（poi_cache.json） */
const poiCache = createPoiCache({
  load: () => {
    const f = readCache<PoiCacheFile>(POI_CACHE_FILE)
    return f && f.schema_version === 1 && f.entries ? f.entries : null
  },
  save: entries => writeCache(POI_CACHE_FILE, { schema_version: 1, entries }),
  now: () => Date.now(),
})

function rawSearcher(data: AppData): StationSearcher | null {
  const mode = data.ledger.settings.station_search
  const amap = amapKey()
  const token = xxyhToken()
  if (mode === "off") return null
  if ((mode === "amap" || mode === "auto") && amap) return amapSearcher(scriptingHttp, amap)
  if ((mode === "xxyh" || mode === "auto") && token) return xxyhSearcher(scriptingHttp, token)
  return null
}

function searcher(data: AppData): StationSearcher | null {
  const s = rawSearcher(data)
  return s ? { ...s, nearby: poiCache.wrap(s.name, (p, r) => s.nearby(p, r)) } : null
}

export function searcherName(data: AppData): string {
  return searcher(data)?.name || "不搜索，只用我的油站"
}

// ---------- 行程与加油停车（设计文档 16.6 节） ----------

type TripsCacheFile = { schema_version: 1; entries: Record<string, StopsSnapshot> }
const TRIPS_CACHE_FILE = "trips_cache.json"

function readTripsCache(): Record<string, StopsSnapshot> {
  const f = readCache<TripsCacheFile>(TRIPS_CACHE_FILE)
  return f && f.schema_version === 1 && f.entries ? f.entries : {}
}

/** 最近 7 天的停车：记录页提示、记加油表单、从行程选择共用一份，缓存 10 分钟（trips_cache.json） */
const stopSource = createStopSource({
  load: key => readTripsCache()[key] || null,
  save: snap => writeCache(TRIPS_CACHE_FILE, { schema_version: 1, entries: { ...readTripsCache(), [snap.key]: snap } }),
  now: () => Date.now(),
})

const stopsKey = (v: Vehicle) => `${v.id}|${v.provider?.id}|${v.provider?.vehicle_id}`

/** 这辆车能不能读行程：关联了车辆数据，并且凭据还在 */
export function canReadTrips(vehicle: Vehicle | null): boolean {
  return !!(vehicle && vehicle.provider && providerCredential(vehicle.provider.id))
}

/** 最近 7 天的停车。「已记录」和我的油站按当前数据重新判断 */
export async function vehicleStops(data: AppData, vehicle: Vehicle, opts: StopGetOptions = {}): Promise<Stop[]> {
  if (!canReadTrips(vehicle)) return []
  const snap = await stopSource.get(stopsKey(vehicle), range => fetchStops(data, vehicle, range), opts)
  return refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle))
}

/** 只看缓存（可能已过期），不发请求；没有缓存时为 null */
export function cachedStops(data: AppData, vehicle: Vehicle | null): Stop[] | null {
  if (!vehicle || !vehicle.provider) return null
  const snap = stopSource.peek(stopsKey(vehicle))
  return snap ? refreshStops(snap.stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)) : null
}

/**
 * 按付款时间配对用的停车：付款时间在共用的 7 天内时用共用的（shared 为 true）；
 * 更早时单独读付款前后各 1 天，不进缓存（设计文档 19.2 节）
 */
export async function stopsForPayment(data: AppData, vehicle: Vehicle, payTs: number): Promise<{ stops: Stop[]; shared: boolean }> {
  const range = paymentStopsRange(payTs, Date.now())
  if (!range) return { stops: await vehicleStops(data, vehicle, { needAfter: payTs }), shared: true }
  if (!canReadTrips(vehicle)) return { stops: [], shared: false }
  const stops = await fetchStops(data, vehicle, range)
  return { stops: refreshStops(stops, stationsFor(data, vehicle), fuelRecords(data, vehicle)), shared: false }
}

/** 从行程选择：加油停车在前 */
export async function recentStops(data: AppData, vehicle: Vehicle, force = false): Promise<Stop[]> {
  return rankStops(await vehicleStops(data, vehicle, { force }))
}

/** 最近 2 天里还没记录、没被忽略的加油停车（最新的一次） */
export function openStopIn(data: AppData, vehicle: Vehicle, stops: Stop[]): Stop | null {
  return openRefuelStop(stops, fuelRecords(data, vehicle), data.ledger.settings.dismissed_stops, Date.now())
}

/** 记录页顶部提示。刚保存的记录会让提示立即消失（「已记录」按当前数据判断） */
export async function detectOpenStop(data: AppData, vehicle: Vehicle | null, force = false): Promise<Stop | null> {
  if (!vehicle || !canReadTrips(vehicle)) return null
  return openStopIn(data, vehicle, await vehicleStops(data, vehicle, { force }))
}

/** 不发请求：按缓存判断（启动时立刻显示上次的结果，之后再刷新） */
export function openStopNow(data: AppData, vehicle: Vehicle | null): Stop | null {
  if (!vehicle || !canReadTrips(vehicle)) return null
  const stops = cachedStops(data, vehicle)
  return stops ? openStopIn(data, vehicle, stops) : null
}

export function dismissStop(data: AppData, stop: Stop): AppData {
  const list = [stop.end_ts, ...data.ledger.settings.dismissed_stops.filter(t => t !== stop.end_ts)].slice(0, 20)
  return updateSettings(data, { dismissed_stops: list })
}

async function fetchStops(data: AppData, vehicle: Vehicle, range: { from: number; to: number }): Promise<Stop[]> {
  if (!vehicle.provider) throw new Error("这辆车没有关联车辆数据")
  const p = providerById(vehicle.provider.id)
  const cred = providerCredential(vehicle.provider.id)
  if (!p || !cred) throw new Error(`未连接${p ? p.name : "车辆数据"}，请在设置中连接`)
  const trips = await p.fetchTrips(providerCtx(vehicle.provider.id), cred, vehicle.provider.vehicle_id, range)
  const s = searcher(data)
  return findStops(trips, { stations: stationsFor(data, vehicle), fuel: fuelRecords(data, vehicle), nearby: s ? (pt, r) => s.nearby(pt, r) : null, now: range.to })
}

// ---------- 车况（设计文档第 18 节） ----------

/** 车况：记录页、小组件共用一份，缓存 10 分钟（status_cache.json；小组件也会写） */
const statusSource = createStatusSource({
  load: key => readStatusCache()[key] || null,
  save: saveStatusSnapshot,
  now: () => Date.now(),
})

/** 这辆车关联的车辆数据能读车况（不看凭据） */
export function hasStatusSource(vehicle: Vehicle | null): boolean {
  const p = vehicle && vehicle.provider ? providerById(vehicle.provider.id) : null
  return !!(p && p.vehicleStatus)
}

/** 能读车况：能读车况的车辆数据，并且凭据还在 */
export function canReadStatus(vehicle: Vehicle | null): boolean {
  return hasStatusSource(vehicle) && canReadTrips(vehicle)
}

/** 油箱容量（升）：车型参数里的 tank，只读缓存的车型参数 */
const tankMemo = new Map<number, number | null>()
export function vehicleTank(data: AppData, vehicle: Vehicle): number | null {
  const model = vehicleProfile(data, vehicle)?.model
  if (!model || model <= 0) return null
  if (!tankMemo.has(model)) {
    const spec = readCatalog().specs?.[String(model)]
    if (!spec) return null // 还没查过车型参数，查到后再记
    tankMemo.set(model, spec.tank && spec.tank > 0 ? spec.tank : null)
  }
  return tankMemo.get(model) ?? null
}

/** 上次读到的车况（可能已过期），不发请求 */
export function cachedStatus(vehicle: Vehicle | null): StatusSnapshot | null {
  return vehicle && hasStatusSource(vehicle) ? statusSource.peek(stopsKey(vehicle)) : null
}

/** 读车况（10 分钟内用缓存；force 时重新读）。第一次用到油箱容量时顺便查车型参数 */
export async function readVehicleStatus(data: AppData, vehicle: Vehicle | null, force = false): Promise<StatusSnapshot | null> {
  if (!vehicle || !vehicle.provider || !canReadStatus(vehicle)) return null
  const link = vehicle.provider
  const snap = await statusSource.get(stopsKey(vehicle), async () => {
    const st = await providerVehicleStatus(link.id, link.vehicle_id)
    if (!st) throw new Error("这个车辆数据提供方不支持车况")
    return st
  }, { force })
  const model = vehicleProfile(data, vehicle)?.model
  if (model && model > 0 && vehicleTank(data, vehicle) == null) {
    try { await catalogSpec(model) } catch { /* 没有油箱容量时只显示升数 */ }
  }
  return snap
}

// ---------- 截图识别（设计文档 16.3 节） ----------

export function azureConfig(): AzureConfig | null {
  const v = getJsonSecret(SECRET_AZURE)
  return v ? { endpoint: v.endpoint || "", deployment: v.deployment || "", key: v.key || "", apiVersion: v.apiVersion || undefined } : null
}

export function setAzureConfig(c: AzureConfig | null): void {
  if (!c || !(c.endpoint.trim() || c.deployment.trim() || c.key.trim())) return removeSecret(SECRET_AZURE)
  setJsonSecret(SECRET_AZURE, { endpoint: c.endpoint.trim(), deployment: c.deployment.trim(), key: c.key.trim(), ...(c.apiVersion ? { apiVersion: c.apiVersion } : {}) })
}

export const azureConfigured = () => azureReady(azureConfig())

export async function testAzure(c: AzureConfig): Promise<string> {
  const r = await pingAzure(scriptingHttp, c)
  return `${r.model || "已连接"}，${r.seconds.toFixed(1)} 秒`
}

export { assistantAvailable, assistantModelInfo, pickAssistantModel } from "../platform/assistant"

export async function testAssistant(m: AssistantModel | null): Promise<string> {
  const seconds = await pingAssistant(m)
  return `${m ? m.modelId : "默认模型"}，${seconds.toFixed(1)} 秒`
}

export const OCR_ENGINE_TITLES: Record<OcrEngine, string> = { local: "本机", azure: "大模型（Azure OpenAI）", assistant: "大模型（Scripting 助手）" }

export type RecognizeOutcome = {
  result: ReceiptResult | null
  /** 「本机 0.3 秒」「Azure 4.9 秒」 */
  summary: string
  error: string | null
  /** 读到的数字能不能互相核对上（本机：localUsable；大模型：receiptUsable）。不能时请用户对照图片 */
  checked: boolean
}

/** 大模型（Azure、Scripting 助手）的结果：非加油单据报错；核对用 receiptUsable */
async function recognizeLlm(run: () => Promise<ReceiptResult>, label: (r: ReceiptResult) => string): Promise<RecognizeOutcome> {
  try {
    const r = await run()
    const summary = `${label(r)} ${r.seconds.toFixed(1)} 秒`
    if (r.doc_type === "other") return { result: null, summary, checked: false, error: r.note || "图片里没有加油信息" }
    return { result: r, summary, checked: receiptUsable(r), error: null }
  } catch (e) {
    return { result: null, summary: "", checked: false, error: `大模型识别失败：${errorText(e)}` }
  }
}

/** 只用设置里选的那一种来源识别（设计文档 16.3 节） */
export async function recognizeImage(image: UIImage, settings: Pick<Settings, "ocr_engine" | "ocr_assistant">): Promise<RecognizeOutcome> {
  if (settings.ocr_engine === "azure") {
    const cfg = azureConfig()
    if (!azureReady(cfg)) return { result: null, summary: "", checked: false, error: "还没有设置 Azure OpenAI。请在「设置 › 截图识别」填写，或改用其他识别方式。" }
    return recognizeLlm(async () => {
      const jpeg = jpegForUpload(image)
      if (!jpeg) throw new Error("图片无法转换")
      return recognizeAzure(scriptingHttp, cfg, jpeg)
    }, () => "Azure")
  }
  if (settings.ocr_engine === "assistant") {
    if (!assistantAvailable()) return { result: null, summary: "", checked: false, error: "Scripting 助手不可用。请先在 Scripting 中添加模型账号，或改用其他识别方式。" }
    return recognizeLlm(() => recognizeAssistant(image, settings.ocr_assistant), r => r.model || "Scripting 助手")
  }
  try {
    const local = await recognizeLocal(image)
    const summary = `本机 ${local.seconds.toFixed(1)} 秒`
    if (localUsable(local)) return { result: local, summary, checked: true, error: null }
    if (receiptScore(local)) return { result: local, summary, checked: false, error: null }
    return { result: null, summary, checked: false, error: "本机没有读到加油信息，请手动填写。" }
  } catch (e) {
    return { result: null, summary: "", checked: false, error: `本机识别失败：${errorText(e)}` }
  }
}

const priceCache = new Map<string, Promise<{ current: CityPrices | null; history: Array<[number, number]> }>>()

/** 某个城市在某个时刻的 92#、95# 油价，用来按单价判断标号。当前油价需要小熊凭据，历史油价不需要 */
export async function priceRefFor(city: string, province: string, atMs: number): Promise<PriceRef | null> {
  if (!city) return null
  const key = `${province}|${city}`
  let entry = priceCache.get(key)
  if (!entry) {
    const token = xxyhToken()
    entry = Promise.all([
      token ? cityPrices(scriptingHttp, token, province || city, city).catch(() => null) : Promise.resolve(null),
      price92History(scriptingHttp, city).catch(() => [] as Array<[number, number]>),
    ]).then(([current, history]) => ({ current, history }))
    priceCache.set(key, entry)
    entry.then(v => { if (!v.current && !v.history.length) priceCache.delete(key) }) // 都失败时下次重试
  }
  const { current, history } = await entry
  return priceRefAt(current, history, atMs, city)
}

const MUNICIPALITY = /^(北京|上海|天津|重庆)市$/

/** 判断标号用哪个城市的油价：油站所在城市 → 停车点所在城市 → 最近一次加油的油站所在城市 */
export function priceCityFor(data: AppData, vehicle: Vehicle, station: Station | null, stop: Stop | null): { city: string; province: string } {
  const pick = (city: string, province: string) => ({ city, province: province || (MUNICIPALITY.test(city) ? city : "") })
  if (station && station.city) return pick(station.city, station.province)
  if (stop && stop.place && stop.place.city) return pick(stop.place.city, "")
  const stations = stationsFor(data, vehicle)
  for (const r of fuelRecords(data, vehicle)) {
    const s = r.station_id ? stations.find(x => x.id === r.station_id) : null
    if (s && s.city) return pick(s.city, s.province)
  }
  return { city: "", province: "" }
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

// ---------- 备份与恢复（common/backup.ts） ----------

export type { BackupFile, BackupSummary } from "./backup"
export { passwordProblem, summarizeBackup } from "./backup"

/** 备份里的凭据：钥匙串里的原文（JSON 凭据也是字符串）。车辆数据的会话只是缓存，不备份 */
function secretItems(): Array<{ key: string; label: string }> {
  return [
    { key: SECRET_XXYH_TOKEN, label: "小熊油耗" },
    ...PROVIDERS.map(p => ({ key: providerSecretKey(p.id), label: p.name })),
    { key: SECRET_AMAP_KEY, label: "高德" },
    { key: SECRET_AZURE, label: "Azure OpenAI" },
  ]
}

/** 本机现在保存了哪些凭据（名称） */
export const storedSecretLabels = (): string[] => secretItems().filter(i => getSecret(i.key)).map(i => i.label)

const stamp = (ms: number) => `${fmtDate(ms).replace(/-/g, "")}-${fmtTime(ms).replace(":", "")}`

/** password 为 null 时不备份凭据 */
function backupText(data: AppData, password: string | null, now: number): string {
  let secrets = null
  if (password) {
    const items = secretItems().map(i => ({ ...i, value: getSecret(i.key) })).filter(i => i.value)
    if (items.length) secrets = encryptSecrets(Object.fromEntries(items.map(i => [i.key, i.value as string])), items.map(i => i.label), password)
  }
  return JSON.stringify(makeBackup(data.ledger, data.xxyh, Script.metadata.version, now, secrets))
}

/** 存到「文件」（用户选位置，建议 iCloud 云盘）；取消时返回 false */
export async function saveBackupToFiles(data: AppData, password: string | null): Promise<boolean> {
  const now = Date.now()
  const file = Data.fromString(backupText(data, password, now))
  if (!file) throw new Error("备份内容无法转换")
  const saved = await DocumentPicker.exportFiles({ files: [{ data: file, name: `fuelnote-backup-${stamp(now)}.json` }] })
  return saved.length > 0
}

/** 让用户选一个备份文件并读取；取消时返回 null */
export async function pickBackupFile(): Promise<{ name: string; backup: BackupFile } | null> {
  const paths = await DocumentPicker.pickFiles({ types: ["public.json"] })
  if (!paths.length) return null
  try {
    const path = paths[0]
    return { name: path.split("/").pop() || path, backup: parseBackup(FileManager.readAsStringSync(path)) }
  } finally {
    DocumentPicker.stopAcessingSecurityScopedResources()
  }
}

/**
 * 用备份替换本机数据。先等正在进行的同步结束；密码不对时什么都不改。
 * 替换前把当前数据另存到文稿目录（「文件」App 能看到），备份不含凭据。
 * password 为 null 时不恢复凭据，保留本机现有的。
 */
export async function restoreBackup(b: BackupFile, opts: { password: string | null; keepOps: boolean }): Promise<{ data: AppData; safetyPath: string; secrets: string[] }> {
  const secrets = b.secrets && opts.password ? decryptSecrets(b.secrets, opts.password) : null
  await waitForPendingSync()
  const now = Date.now()
  const safetyPath = writeExport(`fuelnote-before-restore-${stamp(now)}.json`, backupText(loadData().data, null, now))
  saveLedger(b.ledger)
  saveXxyhState(restoredXxyh(b.xxyh, opts.keepOps))
  const restored: string[] = []
  if (secrets) {
    for (const i of secretItems()) {
      if (!secrets[i.key]) continue
      setSecret(i.key, secrets[i.key])
      restored.push(i.label)
    }
    for (const p of PROVIDERS) removeSecret(providerSessionKey(p.id)) // 会话按新凭据重新换
  }
  return { data: loadData().data, safetyPath, secrets: restored }
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

/** App 每次改动后写小组件摘要（widget.json），小组件只读这个小文件 */
export function saveWidgetSnapshot(data: AppData, now = Date.now()): void {
  const v = currentVehicle(data)
  const records = v ? vehicleRecords(data, v) : []
  const sum = v ? summarize(records, "all", now) : null
  const d = new Date(now)
  // 小组件可能刚写进更新的车况，以文件为准
  const st = v && hasStatusSource(v) ? statusSource.latest(stopsKey(v)) : null
  // 大号「最近加油」：最近 3 次加油的油站名和油耗（设计文档 18.2 节，1.4 起）
  const fills = records.filter((r): r is FuelRecord & LedgerRecord => r.kind === "fuel")
  const consumption = consumptionById(fills)
  const stationNames = new Map((v ? stationsFor(data, v) : []).map(s => [s.id, s.name]))
  const year = yearSummaries(records).find(y => y.year === d.getFullYear())
  const snap: WidgetSnapshot = {
    schema_version: 1,
    updated_at: now,
    vehicle: v ? v.name : null,
    status_source: hasStatusSource(v),
    status: v && st
      ? { ts: st.status.ts, fuel_l: st.status.fuel_l, range_km: st.status.range_km, tank_l: vehicleTank(data, v), odometer_km: st.status.odometer_km, read_at: st.read_at }
      : null,
    // 小组件自己读车况用（设计文档 18.3 节第 2 步）；凭据在钥匙串，不写进文件
    status_link: v && v.provider && hasStatusSource(v)
      ? { key: stopsKey(v), provider: v.provider.id, vehicle_id: v.provider.vehicle_id, tank_l: vehicleTank(data, v) }
      : null,
    latest_consumption: sum ? sum.latest_consumption : null,
    avg_consumption: sum ? sum.avg_consumption : null,
    last_fuel_ts: sum ? sum.last_fuel_ts : null,
    last_odometer: sum ? sum.last_odometer : null,
    last_fuel_odometer: fills.length ? fills[0].odometer : null,
    last_fuel_full: fills.length ? fills[0].full : false,
    month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
    month_cost: monthCost(records, now),
    year: String(d.getFullYear()),
    year_cost: year ? year.cost : 0,
    recent: fills.slice(0, 3).map(r => ({
      ts: r.ts, liters: r.liters, grade: r.grade, station: (r.station_id && stationNames.get(r.station_id)) || null, paid: r.paid,
      consumption: consumption.get(r.id) ?? null,
    })),
    pending: data.xxyh.ops.length,
  }
  try { saveWidgetFile(JSON.stringify(snap)) } catch { /* 小组件下次再更新 */ }
}
