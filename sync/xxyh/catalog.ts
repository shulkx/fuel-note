// 小熊油耗的车型库（设计文档 17.4 节）：品牌 → 车系 → 车型 → 车型参数。与官方网页版建车页用的接口相同，不需要登录。
// 纯逻辑，HTTP 注入；缓存在 common/model.ts。
import { formEncode, Http, parseJson } from "../../platform/http"
import { XxyhError } from "./api"

const API = "https://www.xiaoxiongyouhao.com/api"

/** 品牌、车系、车型列表里的一项 */
export type CatalogItem = { id: number; name: string }
/** 品牌：名称去掉首字母前缀（「W 沃尔沃」→「沃尔沃」），letter 用来分组 */
export type CatalogBrand = CatalogItem & { letter: string; logo: string | null }
/** 车型按年款分组：「2026款」→ [「B4 智远运动版」…] */
export type ModelGroup = { year: string; models: CatalogItem[] }

export type CarSpec = {
  id: number
  /** 「沃尔沃S60 2026款 B4 智远运动版」 */
  name: string
  pinpai: number | null
  chexi: number | null
  vehicle_type: number | null
  /** 「汽油」「汽油+48V轻混系统」「纯电动」… */
  fuel_type: string | null
  /** 「95号」 */
  gas_type: string | null
  engine: string | null
  gearbox: string | null
  /** 油箱（升） */
  tank: number | null
}

/** 车型库里标为不支持的车型（与网页版相同的判断：status 23） */
export const UNSUPPORTED_STATUS = 23

async function get(http: Http, path: string, query: Record<string, string>): Promise<any> {
  const url = `${API}/${path}?${formEncode(query)}`
  let res
  try {
    res = await http({ method: "GET", url, timeout: 30 })
  } catch (error) {
    throw new XxyhError("network", error instanceof Error ? error.message : String(error))
  }
  if (res.status !== 200) throw new XxyhError("server", `小熊油耗返回 HTTP ${res.status}`)
  try {
    return parseJson(res, url)
  } catch {
    throw new XxyhError("parse", "小熊油耗返回的不是 JSON")
  }
}

function ok(body: any): any {
  if (Number(body && body.status) !== 0) throw new XxyhError("server", `小熊油耗：${String((body && body.message) || "请求失败")}`)
  return body.data || {}
}

const ids = (data: any): number[] => (Array.isArray(data.idxes) ? data.idxes.map(Number) : [])
const names = (data: any): string[] => (Array.isArray(data.names) ? data.names.map((n: unknown) => String(n ?? "")) : [])

/** 「W 沃尔沃」→ { letter: "W", name: "沃尔沃" }；没有前缀时按第一个字符，非字母归到「#」 */
export function splitBrandName(raw: string): { letter: string; name: string } {
  const m = /^([A-Za-z])\s+(.+)$/.exec(raw.trim())
  if (m) return { letter: m[1].toUpperCase(), name: m[2].trim() }
  const first = raw.trim().charAt(0).toUpperCase()
  return { letter: /[A-Z]/.test(first) ? first : "#", name: raw.trim() }
}

export function parseBrands(data: any): CatalogBrand[] {
  const n = names(data)
  const logos: unknown[] = Array.isArray(data.logos) ? data.logos : []
  return ids(data).map((id, i) => {
    const { letter, name } = splitBrandName(n[i] || "")
    const logo = typeof logos[i] === "string" && logos[i] ? String(logos[i]) : null
    return { id, name, letter, logo }
  }).filter(b => Number.isFinite(b.id) && b.name)
}

export function parseItems(data: any): CatalogItem[] {
  const n = names(data)
  return ids(data).map((id, i) => ({ id, name: (n[i] || "").trim() })).filter(x => Number.isFinite(x.id) && x.name)
}

/** 车型按年款分组，保持接口给的顺序（新的在前）；名称去掉年款前缀 */
export function groupModels(models: CatalogItem[]): ModelGroup[] {
  const out: ModelGroup[] = []
  for (const m of models) {
    const match = /^(\d{4}款)\s*(.*)$/.exec(m.name)
    const year = match ? match[1] : "其他"
    const name = match && match[2] ? match[2] : m.name
    let g = out.find(x => x.year === year)
    if (!g) { g = { year, models: [] }; out.push(g) }
    g.models.push({ id: m.id, name })
  }
  return out
}

/** 品牌按首字母分组（A–Z，最后是 #），组内保持接口顺序 */
export function groupBrands(brands: CatalogBrand[]): Array<{ letter: string; brands: CatalogBrand[] }> {
  const map = new Map<string, CatalogBrand[]>()
  for (const b of brands) map.set(b.letter, [...(map.get(b.letter) || []), b])
  return Array.from(map.keys()).sort((a, b) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b))).map(letter => ({ letter, brands: map.get(letter)! }))
}

const posInt = (v: unknown): number | null => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** 车型参数；不支持的车型返回 null */
export function parseSpec(body: any): CarSpec | null {
  if (Number(body && body.status) === UNSUPPORTED_STATUS) return null
  if (Number(body && body.status) !== 0) throw new XxyhError("server", `小熊油耗：${String((body && body.message) || "请求失败")}`)
  const id = posInt(body.id)
  if (!id) return null
  const tank = Number(body.tank)
  return {
    id,
    name: str(body.name) || "",
    pinpai: posInt(body.pinpai),
    chexi: posInt(body.chexi),
    vehicle_type: posInt(body.vehicle_type),
    fuel_type: str(body.fuelType),
    gas_type: str(body.gasType),
    engine: str(body.engine),
    gearbox: str(body.gearbox),
    tank: Number.isFinite(tank) && tank > 0 ? tank : null,
  }
}

/** 补能方式，与网页版 getReplenishMode 相同：含「纯电动」2，含「插电式混合动力」或「增程式」3，其余 1 */
export function replenishModeOf(fuelType: string | null): number {
  const f = fuelType || ""
  if (f.includes("纯电动")) return 2
  if (f.includes("插电式混合动力") || f.includes("增程式")) return 3
  return 1
}

/** 车型的标号 → 油记的标号：「95号」→ 95，「0号」或柴油 → 0；认不出（含纯电动）时 null */
export function gradeOf(gasType: string | null, fuelType: string | null = null): number | null {
  const g = gasType || ""
  if (/柴油/.test(g) || /柴油/.test(fuelType || "")) return 0
  const m = /(\d{1,2})\s*(号|#)/.exec(g)
  if (!m) return null
  const n = Number(m[1])
  return [92, 95, 98, 0].includes(n) ? n : null
}

/** 品牌：汽车、摩托车、货车三份合在一起（与网页版相同） */
export async function fetchBrands(http: Http): Promise<CatalogBrand[]> {
  const lists = await Promise.all(["pinpai", "moto", "truck"].map(c => get(http, "", { a: "q", c })))
  return lists.flatMap(b => parseBrands(ok(b)))
}

export async function fetchSeries(http: Http, brand: number): Promise<CatalogItem[]> {
  return parseItems(ok(await get(http, "", { a: "q", c: "chexi", pinpai: String(brand) })))
}

export async function fetchModels(http: Http, brand: number, series: number): Promise<CatalogItem[]> {
  return parseItems(ok(await get(http, "", { a: "q", c: "chexing", pinpai: String(brand), chexi: String(series) })))
}

export async function fetchSpec(http: Http, model: number): Promise<CarSpec | null> {
  return parseSpec(await get(http, "index.php", { a: "q", c: "chexingspecification", chexing: String(model) }))
}
