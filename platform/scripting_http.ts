// Scripting 的 fetch（无跨域限制）
import { fetch } from "scripting"
import { Http, hostOf, NetworkError } from "./http"

/** 二进制请求体：fetch 的 body 只接受 Data、FormData、string、ArrayBuffer（文档 request/fetch），二进制用 Data */
function binaryBody(bytes: Uint8Array): Data | ArrayBuffer {
  return Data.fromUint8Array(bytes) ?? bytes.slice().buffer
}

export const scriptingHttp: Http = async req => {
  try {
    const res = await fetch(req.url, {
      method: req.method || "GET",
      headers: req.headers,
      body: req.bodyBytes ? binaryBody(req.bodyBytes) : req.body,
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

/**
 * 诊断 gRPC 请求（设计文档 18.1 节）：同一个请求用几种写法各发一次，列出结果。
 * 「不带请求体」服务器应立即报错，用来区分连不上服务器和请求体没发对。每次最多等 15 秒
 */
export async function probeBinaryPost(url: string, headers: Record<string, string>, bytes: Uint8Array): Promise<string[]> {
  const noTe = Object.fromEntries(Object.entries(headers).filter(([k]) => k.toLowerCase() !== "te"))
  const variants: Array<{ name: string; headers: Record<string, string>; body: () => Data | ArrayBuffer | null | undefined }> = [
    { name: "不带请求体", headers, body: () => undefined },
    { name: "Data，带 te", headers, body: () => Data.fromUint8Array(bytes) },
    { name: "Data，不带 te", headers: noTe, body: () => Data.fromUint8Array(bytes) },
    { name: "ArrayBuffer，带 te", headers, body: () => bytes.slice().buffer },
  ]
  const lines: string[] = []
  for (const v of variants) {
    const t0 = Date.now()
    const sec = () => ((Date.now() - t0) / 1000).toFixed(1)
    try {
      const body = v.body()
      if (body === null) { lines.push(`${v.name}：请求体转换失败`); continue }
      const res = await fetch(url, { method: "POST", headers: v.headers, ...(body ? { body } : {}), timeout: 15, debugLabel: "FuelNote probe" })
      const data = await res.bytes()
      lines.push(`${v.name}：HTTP ${res.status}，grpc-status ${res.headers.get("grpc-status") ?? "无"}，${res.headers.get("content-type") ?? "无类型"}，${data.length} 字节，${sec()} 秒`)
    } catch (error) {
      const timeout = error instanceof Error && error.name === "AbortError"
      lines.push(`${v.name}：${timeout ? "超时" : error instanceof Error ? error.message : String(error)}（${sec()} 秒）`)
    }
  }
  return lines
}

