// 门店搜索（2.1 设计第 10 节）：高德 v5 的周边搜索和关键字搜索，只要汽车销售、汽车维修、汽车养护、洗车场，带上电话和营业时间。
// 坐标进出都是 WGS-84（高德是 GCJ-02，在这里换算）。
import { gcj02ToWgs84, LngLat, wgs84ToGcj02 } from "../common/geo"
import { StorePoi } from "../common/types"
import { Http } from "../platform/http"
import { amapGet } from "./search"

/** 汽车销售、汽车维修、汽车养护、洗车场 */
export const STORE_TYPES = "020000|030000|010400|010500"

/** 高德的类型「汽车销售;沃尔沃销售;沃尔沃4S店|汽车维修;沃尔沃维修」→「汽车销售 · 汽车维修」 */
export function poiKind(type: unknown): string {
  return [...new Set(String(type || "").split("|").map(s => s.split(";")[0].trim()).filter(Boolean))].join(" · ")
}

const text = (v: unknown) => (Array.isArray(v) ? v.join(";") : typeof v === "string" ? v : "")

export function storePoi(p: any): StorePoi {
  const [lng, lat] = gcj02ToWgs84(String(p.location).split(",").map(Number) as LngLat)
  const b = p.business || {}
  const d = Number(p.distance)
  return {
    poi_id: String(p.id || ""),
    name: String(p.name || ""),
    address: text(p.address),
    district: text(p.adname),
    city: text(p.cityname),
    kind: poiKind(p.type),
    lng, lat,
    phone: text(b.tel).split(";")[0].trim(),
    hours: text(b.opentime_today) || text(b.opentime_week),
    distance: p.distance != null && p.distance !== "" && Number.isFinite(d) ? d : null,
  }
}

/** 一个点附近的汽车服务，按距离 */
export async function storesNearby(http: Http, key: string, p: LngLat, radiusM = 1500): Promise<StorePoi[]> {
  const g = wgs84ToGcj02(p)
  const body = await amapGet(http, `https://restapi.amap.com/v5/place/around?key=${encodeURIComponent(key)}&location=${g[0].toFixed(6)},${g[1].toFixed(6)}`
    + `&radius=${Math.round(radiusM)}&types=${STORE_TYPES}&sortrule=distance&show_fields=business&page_size=10`)
  return (body.pois || []).map(storePoi)
}

/** 关键字搜索；city 是优先的城市（空时全国） */
export async function storesByKeyword(http: Http, key: string, keyword: string, city: string): Promise<StorePoi[]> {
  const body = await amapGet(http, `https://restapi.amap.com/v5/place/text?key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(keyword)}`
    + `&types=${STORE_TYPES}&region=${encodeURIComponent(city)}&show_fields=business&page_size=10`)
  return (body.pois || []).map(storePoi)
}
