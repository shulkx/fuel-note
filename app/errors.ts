// 给用户看的错误说明（app/ 下各模块和页面共用）
import { XxyhError } from "../sync/xxyh/api"

export function errorText(error: unknown): string {
  if (error instanceof XxyhError && error.kind === "auth") return `${error.message}。请在「设置 › 小熊油耗」重新粘贴凭据。`
  return error instanceof Error ? error.message : String(error)
}
