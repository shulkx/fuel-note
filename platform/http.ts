// 网络请求的类型和工具（不依赖平台，Node 测试也能加载）。实际发请求见 scripting_http.ts。

export type HttpRequest = {
  method?: "GET" | "POST"
  url: string
  headers?: Record<string, string>
  body?: string
  /** 二进制请求体（gRPC），有它时不用 body */
  bodyBytes?: Uint8Array
  /** 响应按二进制读（放在 bytes 里，text 为空） */
  binary?: boolean
  /** 超时（秒） */
  timeout?: number
}

export type HttpResponse = {
  status: number
  text: string
  bytes?: Uint8Array
  /** 只带调用方关心的几个响应头（小写），例如 gRPC 的 grpc-status */
  headers?: Record<string, string>
}

export type Http = (req: HttpRequest) => Promise<HttpResponse>

export class NetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NetworkError"
  }
}

/** application/x-www-form-urlencoded / 查询字符串。Scripting 运行时有 URLSearchParams，但类型声明里没有；自己编码，Node 测试与设备结果一致 */
export function formEncode(params: Record<string, string>): string {
  return Object.keys(params).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join("&")
}

export function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").split(/[/?]/)[0]
}

export function parseJson<T = any>(res: HttpResponse, url: string): T {
  try {
    return JSON.parse(res.text) as T
  } catch {
    throw new NetworkError(`${hostOf(url)} 返回的不是 JSON（HTTP ${res.status}）`)
  }
}
