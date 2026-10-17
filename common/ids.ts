/** 本机生成的 id：时间（36 进制）+ 随机串，按创建时间大致有序 */
export function newId(prefix = ""): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0")
  return `${prefix}${Date.now().toString(36)}${rand}`
}

/** 12 位随机串，用作小熊接口的 reqcode */
export function randomCode(length = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let out = ""
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}
