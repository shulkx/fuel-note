// Scripting 的 fetch（无跨域限制）
import { AbortController, fetch } from "scripting"
import { chunkBytes, Http, hostOf, NetworkError, readUntil } from "./http"

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

/**
 * 诊断车况请求（设计文档 18.1 节）：不带请求体、带请求体各发一次，记下收到响应头和第一段响应体的时间，读到就断开。
 * 「不带请求体」服务器应立即报错，用来区分连不上服务器和请求本身的问题。每次最多等 15 秒
 */
export async function probeBinaryPost(url: string, headers: Record<string, string>, bytes: Uint8Array): Promise<string[]> {
  const variants: Array<{ name: string; body: Data | null | undefined }> = [
    { name: "不带请求体", body: undefined },
    { name: "带请求体", body: Data.fromUint8Array(bytes) },
  ]
  const lines: string[] = []
  for (const v of variants) {
    const t0 = Date.now()
    const sec = () => ((Date.now() - t0) / 1000).toFixed(1)
    if (v.body === null) { lines.push(`${v.name}：请求体转换失败`); continue }
    const controller = new AbortController()
    try {
      const res = await fetch(url, { method: "POST", headers, ...(v.body ? { body: v.body } : {}), timeout: 15, signal: controller.signal, debugLabel: "FuelNote probe" })
      const head = `HTTP ${res.status}，grpc-status ${res.headers.get("grpc-status") ?? "无"}，${sec()} 秒收到响应头`
      const reader = res.body.getReader()
      const r = await reader.read()
      lines.push(`${v.name}：${head}；${r.done ? "响应体为空" : `第一段 ${chunkBytes(r.value).length} 字节`}，${sec()} 秒`)
      reader.cancel().catch(() => undefined)
    } catch (error) {
      const timeout = error instanceof Error && error.name === "AbortError"
      lines.push(`${v.name}：${timeout ? "超时" : error instanceof Error ? error.message : String(error)}（${sec()} 秒）`)
    } finally {
      controller.abort()
    }
  }
  return lines
}
