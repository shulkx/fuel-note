// 凭据存 Keychain，不进数据文件
import { ProviderId } from "../common/types"

const PREFIX = "fuelnote."

export const SECRET_XXYH_TOKEN = "xxyh.token"
export const SECRET_AMAP_KEY = "amap.key"
export const providerSecretKey = (id: ProviderId) => `provider.${id}`

export function getSecret(key: string): string | null {
  try {
    const v = Keychain.get(PREFIX + key)
    return typeof v === "string" && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

export function setSecret(key: string, value: string): void {
  const v = value.trim()
  if (!v) return removeSecret(key)
  Keychain.set(PREFIX + key, v)
}

export function removeSecret(key: string): void {
  try { Keychain.remove(PREFIX + key) } catch { /* 不存在 */ }
}

export function getJsonSecret(key: string): Record<string, string> | null {
  const raw = getSecret(key)
  if (!raw) return null
  try {
    const v = JSON.parse(raw)
    return v && typeof v === "object" ? v : null
  } catch {
    return null
  }
}

export function setJsonSecret(key: string, value: Record<string, string>): void {
  setSecret(key, JSON.stringify(value))
}

/** 界面上只显示开头和长度 */
export function maskSecret(value: string | null): string {
  if (!value) return "未设置"
  return `${value.slice(0, 6)}…（${value.length} 位）`
}
