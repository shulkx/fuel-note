// Scripting 的 fetch（无跨域限制）
import { fetch } from "scripting"
import { Http, hostOf, NetworkError } from "./http"

export const scriptingHttp: Http = async req => {
  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.body,
      timeout: req.timeout ?? 30, // 秒
      debugLabel: `FuelNote ${hostOf(req.url)}`,
    })
    return { status: res.status, text: await res.text() }
  } catch (error) {
    // 超时时 fetch 抛 AbortError
    if (error instanceof Error && error.name === "AbortError") throw new NetworkError(`请求超时：${hostOf(req.url)}`)
    throw new NetworkError(`网络请求失败：${hostOf(req.url)}（${error instanceof Error ? error.message : String(error)}）`)
  }
}
