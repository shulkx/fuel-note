// Scripting 的 fetch（无跨域限制）
import { fetch } from "scripting"
import { Http, hostOf, NetworkError } from "./http"

export const scriptingHttp: Http = async req => {
  let res: Awaited<ReturnType<typeof fetch>>
  try {
    res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.body,
      timeout: req.timeout ?? 30,
    })
  } catch (error) {
    throw new NetworkError(`网络请求失败：${hostOf(req.url)}（${error instanceof Error ? error.message : String(error)}）`)
  }
  return { status: res.status, text: await res.text() }
}
