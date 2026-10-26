// 附近加油站搜索：高德 Web 服务或小熊油耗
import { gcj02ToWgs84, LngLat, wgs84ToGcj02 } from "../common/geo"
import { Poi } from "../common/types"
import { Http, parseJson } from "../platform/http"
import { aroundPois } from "../sync/xxyh/api"

export type StationSearcher = {
  name: string
  nearby(p: LngLat, radiusM: number): Promise<Poi[]>
  /** 关键字搜索（只有高德支持） */
  keyword: ((keyword: string, city: string) => Promise<Poi[]>) | null
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function amapPoi(p: any): Poi {
  const gcj = String(p.location).split(",").map(Number) as LngLat
  const [lng, lat] = gcj02ToWgs84(gcj)
  return { name: String(p.name || ""), address: String(p.address || ""), province: String(p.pname || ""), city: String(p.cityname || ""), district: String(p.adname || ""), lng, lat, src: "amap" }
}

/** 高德 Web 服务的 GET：超出每秒请求数时等一下再试 */
export async function amapGet(http: Http, url: string): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await http({ url, timeout: 20 })
    const body = parseJson(res, url)
    if (body.infocode === "10021") { await sleep(800 * (attempt + 1)); continue } // 超出每秒请求数
    if (body.status !== "1") throw new Error(`高德：${body.info || "请求失败"}`)
    return body
  }
  throw new Error("高德查询过于频繁，请稍后重试")
}

export function amapSearcher(http: Http, key: string): StationSearcher {
  const k = encodeURIComponent(key)
  return {
    name: "高德",
    async nearby(p, radiusM) {
      const g = wgs84ToGcj02(p)
      const body = await amapGet(http, `https://restapi.amap.com/v5/place/around?key=${k}&location=${g[0].toFixed(6)},${g[1].toFixed(6)}&radius=${Math.round(radiusM)}&types=010100&sortrule=distance&page_size=10`)
      return (body.pois || []).map(amapPoi)
    },
    async keyword(keyword, city) {
      const body = await amapGet(http, `https://restapi.amap.com/v5/place/text?key=${k}&keywords=${encodeURIComponent(keyword)}&types=010100&region=${encodeURIComponent(city || "")}&page_size=10`)
      return (body.pois || []).map(amapPoi)
    },
  }
}

export function xxyhSearcher(http: Http, token: string): StationSearcher {
  return {
    name: "小熊油耗",
    nearby: p => aroundPois(http, token, p),
    keyword: null,
  }
}
