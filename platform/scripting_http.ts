// Scripting 的 fetch（无跨域限制）
import { fetch } from "scripting"
import { Http, hostOf, NetworkError } from "./http"

export const scriptingHttp: Http = async req => {
  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.bodyBytes ?? req.body,
      timeout: req.timeout ?? 30, // 秒
      debugLabel: `FuelNote ${hostOf(req.url)}`,
    })
    const headers: Record<string, string> = {}
    for (const name of ["content-type", "grpc-status", "grpc-message"]) {
      const v = res.headers.get(name)
      if (v != null) headers[name] = v
    }
    if (req.binary) return { status: res.status, text: "", bytes: await res.bytes(), headers }
    return { status: res.status, text: await res.text(), headers }
  } catch (error) {
    // 超时时 fetch 抛 AbortError
    if (error instanceof Error && error.name === "AbortError") throw new NetworkError(`请求超时：${hostOf(req.url)}`)
    throw new NetworkError(`网络请求失败：${hostOf(req.url)}（${error instanceof Error ? error.message : String(error)}）`)
  }
}
