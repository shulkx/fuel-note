// gRPC 帧和 protobuf 的最小实现（设计文档 18.1 节）：只够读沃尔沃车况接口用到的几个字段。纯函数。
// gRPC 帧：1 字节压缩标记（只支持 0）+ 4 字节大端长度 + protobuf。
import { utf8 } from "../common/hash"

export function grpcFrame(message: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + message.length)
  const n = message.length
  out[1] = (n >>> 24) & 0xff
  out[2] = (n >>> 16) & 0xff
  out[3] = (n >>> 8) & 0xff
  out[4] = n & 0xff
  out.set(message, 5)
  return out
}

/** 响应体里的各个消息；压缩过的帧不支持 */
export function grpcMessages(body: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = []
  let i = 0
  while (i + 5 <= body.length) {
    if (body[i] !== 0) throw new Error("gRPC 响应被压缩，无法解析")
    const n = ((body[i + 1] << 24) >>> 0) + (body[i + 2] << 16) + (body[i + 3] << 8) + body[i + 4]
    if (i + 5 + n > body.length) throw new Error("gRPC 响应不完整")
    out.push(body.subarray(i + 5, i + 5 + n))
    i += 5 + n
  }
  return out
}

function varintBytes(n: number): number[] {
  const out: number[] = []
  let v = n
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
  return out
}

/** 字段 no 为字符串的 protobuf 片段 */
export function pbString(no: number, s: string): Uint8Array {
  const bytes = utf8(s)
  return Uint8Array.from([...varintBytes(no * 8 + 2), ...varintBytes(bytes.length), ...bytes])
}

/** 一个字段的值：varint、64 位（double）、32 位（float）、长度前缀的字节（嵌套消息或字符串） */
export type PbValue = { varint?: number; f64?: number; f32?: number; bytes?: Uint8Array }
export type PbMessage = Map<number, PbValue[]>

/** 解析一层 protobuf（嵌套消息用 pbMessage(value.bytes) 再解析） */
export function pbMessage(buf: Uint8Array): PbMessage {
  const out: PbMessage = new Map()
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let i = 0
  const readVarint = (): number => {
    let result = 0
    let mul = 1
    for (;;) {
      if (i >= buf.length) throw new Error("protobuf 数据不完整")
      const b = buf[i++]
      result += (b & 0x7f) * mul
      if (b < 0x80) return result
      mul *= 0x80
    }
  }
  while (i < buf.length) {
    const key = readVarint()
    const no = Math.floor(key / 8)
    const wire = key % 8
    let value: PbValue
    if (wire === 0) value = { varint: readVarint() }
    else if (wire === 1) { value = { f64: view.getFloat64(i, true) }; i += 8 }
    else if (wire === 5) { value = { f32: view.getFloat32(i, true) }; i += 4 }
    else if (wire === 2) {
      const n = readVarint()
      if (i + n > buf.length) throw new Error("protobuf 数据不完整")
      value = { bytes: buf.subarray(i, i + n) }
      i += n
    } else throw new Error(`不支持的 protobuf 类型 ${wire}`)
    out.set(no, [...(out.get(no) || []), value])
  }
  return out
}

export const pbFirst = (m: PbMessage, no: number): PbValue | undefined => (m.get(no) || [])[0]

/** 数值字段（不管是 varint、double 还是 float） */
export function pbNumber(m: PbMessage, no: number): number | null {
  const v = pbFirst(m, no)
  if (!v) return null
  const n = v.varint ?? v.f64 ?? v.f32
  return n == null || !Number.isFinite(n) ? null : n
}

export function pbSubmessage(m: PbMessage, no: number): PbMessage | null {
  const v = pbFirst(m, no)
  return v && v.bytes ? pbMessage(v.bytes) : null
}

/** google.protobuf.Timestamp → 毫秒 */
export function pbTimestamp(m: PbMessage | null): number | null {
  if (!m) return null
  const s = pbNumber(m, 1)
  if (s == null) return null
  return s * 1000 + Math.floor((pbNumber(m, 2) || 0) / 1e6)
}

/** 调试用：把一层消息写成「3.4=52 3.5=385」这样的文字（嵌套消息展开一层，字符串只写长度） */
export function pbDump(m: PbMessage, prefix = ""): string[] {
  const out: string[] = []
  for (const [no, values] of m) {
    for (const v of values) {
      const key = `${prefix}${no}`
      if (v.varint != null) out.push(`${key}=${v.varint}`)
      else if (v.f64 != null) out.push(`${key}=${Math.round(v.f64 * 1000) / 1000}（double）`)
      else if (v.f32 != null) out.push(`${key}=${Math.round(v.f32 * 1000) / 1000}（float）`)
      else if (v.bytes) {
        let nested: PbMessage | null = null
        try { nested = prefix ? null : pbMessage(v.bytes) } catch { nested = null }
        if (nested && nested.size) out.push(...pbDump(nested, `${key}.`))
        else out.push(`${key}=（${v.bytes.length} 字节）`)
      }
    }
  }
  return out
}
