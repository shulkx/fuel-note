// Scripting 的 fetch（无跨域限制）
import { AbortController, fetch } from "scripting"
import { Http, hostOf, NetworkError, readUntil } from "./http"

/** 二进制请求体：fetch 的 body 只接受 Data、FormData、string、ArrayBuffer（文档 request/fetch），二进制用 Data */
function binaryBody(bytes: Uint8Array): Data | ArrayBuffer {
  return Data.fromUint8Array(bytes) ?? bytes.slice().buffer
}

export const scriptingHttp: Http = async req => {
  // 流式响应读到需要的部分后，用它断开请求（不然连接一直开着，直到超时）
  const controller = new AbortController()
  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.bodyBytes ? binaryBody(req.bodyBytes) : req.body,
      timeout: req.timeout ?? 30, // 秒
      signal: controller.signal,
      debugLabel: `FuelNote ${hostOf(req.url)}`,
    })
    const headers: Record<string, string> = {}
    for (const name of ["content-type", "grpc-status", "grpc-message"]) {
      const v = res.headers.get(name)
      if (v != null) headers[name] = v
    }
    if (req.binary && req.stopWhen) {
      // 文档 request/readable_stream：用 Response.body 的读取器逐块读，读完取消
      const reader = res.body.getReader()
      try {
        return { status: res.status, text: "", bytes: await readUntil(() => reader.read(), req.stopWhen), headers }
      } finally {
        reader.cancel().catch(() => undefined)
        controller.abort()
      }
    }
    if (req.binary) return { status: res.status, text: "", bytes: await res.bytes(), headers }
    return { status: res.status, text: await res.text(), headers }
  } catch (error) {
    // 超时时 fetch 抛 AbortError
    if (error instanceof Error && error.name === "AbortError") throw new NetworkError(`请求超时：${hostOf(req.url)}`)
    throw new NetworkError(`网络请求失败：${hostOf(req.url)}（${error instanceof Error ? error.message : String(error)}）`)
  }
}
