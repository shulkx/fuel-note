// 车况（设计文档 18.1 节）：gRPC 帧、protobuf 解析、沃尔沃 GetFuel / GetOdometer。
// 合成报文用假的 VIN；真实抓包（含 VIN）只从 XXYH_ROOT 读，不进仓库。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { grpcFrame, grpcHasMessage, grpcMessages, pbDump, pbMessage, pbNumber, pbString, pbSubmessage, pbTimestamp } from "../providers/grpc"
import { parseFuel, parseOdometer, statusRequestBody, volvoCn } from "../providers/volvo_cn"
import { chunkBytes, Http, HttpRequest, readUntil } from "../platform/http"
import { XXYH_ROOT } from "./helpers"

const VIN = "TESTVIN0000000001"

// 测试用的 protobuf 编码
const varint = (n: number): number[] => {
  const out: number[] = []
  let v = n
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80) }
  out.push(v)
  return out
}
const key = (no: number, wire: number) => varint(no * 8 + wire)
const fVarint = (no: number, n: number) => [...key(no, 0), ...varint(n)]
const fDouble = (no: number, n: number) => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return [...key(no, 1), ...b] }
const fFloat = (no: number, n: number) => { const b = Buffer.alloc(4); b.writeFloatLE(n); return [...key(no, 5), ...b] }
const fBytes = (no: number, bytes: number[]) => [...key(no, 2), ...varint(bytes.length), ...bytes]
const fString = (no: number, s: string) => fBytes(no, [...Buffer.from(s, "utf8")])
const timestamp = (sec: number, nanos: number) => [...fVarint(1, sec), ...fVarint(2, nanos)]

// 2026-10-12 15:16:59 +08:00。GetFuel：3.2 续航 620 km，3.5 续航 385 英里（官方 App 的 proto）
const SEC = 1791789419
const fuelMessage = () => Uint8Array.from([
  ...fString(2, VIN),
  ...fBytes(3, [...fBytes(1, timestamp(SEC, 420742000)), ...fVarint(2, 620), ...fDouble(3, 13.2), ...fFloat(4, 52), ...fVarint(5, 385)]),
])
const odometerMessage = () => Uint8Array.from([
  ...fString(2, VIN),
  ...fBytes(3, [...fBytes(1, timestamp(SEC, 420742000)), ...fVarint(2, 82943341), ...fFloat(3, 2943.3), ...fFloat(4, 35.6), ...fVarint(5, 23)]),
])

test("车况请求：gRPC 帧里只有字段 2 = VIN，与 App 的请求相同", () => {
  const body = statusRequestBody(VIN)
  assert.deepEqual([...body.subarray(0, 7)], [0, 0, 0, 0, 0x13, 0x12, 0x11])
  assert.equal(Buffer.from(body.subarray(7)).toString("utf8"), VIN)
  assert.deepEqual([...pbString(2, "ab")], [0x12, 2, 0x61, 0x62])
})

test("protobuf：varint、double、float、嵌套消息、时间戳；gRPC 帧拆分", () => {
  const frames = Uint8Array.from([...grpcFrame(fuelMessage()), ...grpcFrame(odometerMessage())])
  const msgs = grpcMessages(frames)
  assert.equal(msgs.length, 2)
  const m = pbMessage(msgs[0])
  const s = pbSubmessage(m, 3)!
  assert.equal(pbNumber(s, 2), 620)
  assert.equal(pbNumber(s, 3), 13.2)
  assert.equal(pbNumber(s, 4), 52)
  assert.equal(pbNumber(s, 5), 385)
  assert.equal(pbTimestamp(pbSubmessage(s, 1)), SEC * 1000 + 420)
  assert.equal(pbNumber(s, 99), null)
  assert.deepEqual(pbDump(s), ["1.1=1791789419", "1.2=420742000", "2=620", "3=13.2（double）", "4=52（float）", "5=385"])
  // 大于 2^32 的 varint 不溢出
  assert.equal(pbNumber(pbMessage(Uint8Array.from(fVarint(1, 2 ** 40 + 5))), 1), 2 ** 40 + 5)
  assert.throws(() => grpcMessages(Uint8Array.from([1, 0, 0, 0, 1, 0])), /压缩/)
  assert.throws(() => grpcMessages(Uint8Array.from([0, 0, 0, 0, 9, 1])), /不完整/)
})

test("GetFuel、GetOdometer：剩余油量、续航（km，不是英里）、平均油耗、里程表、车况时间", () => {
  assert.deepEqual(parseFuel(pbMessage(fuelMessage())), { ts: SEC * 1000 + 420, fuel_l: 52, range_km: 620, avg_consumption: 13.2 })
  assert.deepEqual(parseOdometer(pbMessage(odometerMessage())), { ts: SEC * 1000 + 420, odometer_km: 82943.341 })
  assert.deepEqual(parseFuel(pbMessage(Uint8Array.from(fString(2, VIN)))), { ts: null, fuel_l: null, range_km: null, avg_consumption: null })
})

test("流式响应：读到第一条完整消息就停，不等服务器结束（车况接口不会自己结束）", async () => {
  const frame = grpcFrame(fuelMessage())
  // 第一条消息分三块到达，之后服务器不再发、也不结束
  const chunks = [frame.subarray(0, 3), frame.subarray(3, 20), frame.subarray(20)]
  let reads = 0
  const read = () => {
    reads++
    const next = chunks.shift()
    return next ? Promise.resolve({ done: false, value: next }) : new Promise<{ done: boolean }>(() => undefined)
  }
  const got = await readUntil(read, grpcHasMessage)
  assert.equal(reads, 3)
  assert.deepEqual([...got], [...frame])
  assert.equal(grpcHasMessage(frame.subarray(0, 4)), false)
  assert.equal(grpcHasMessage(frame.subarray(0, frame.length - 1)), false)
  assert.equal(grpcHasMessage(frame), true)
  // 只有响应头、没有消息（gRPC 报错时）：流结束，返回空
  assert.equal((await readUntil(() => Promise.resolve({ done: true }), grpcHasMessage)).length, 0)
  // 文档里的块是 Data：用 toUint8Array 转
  assert.deepEqual([...chunkBytes({ toUint8Array: () => Uint8Array.from([1, 2]) })], [1, 2])
})

function fakeVolvo(opts: { expireFirst?: boolean; grpcStatus?: string } = {}): { http: Http; calls: HttpRequest[] } {
  const calls: HttpRequest[] = []
  let refreshes = 0
  const http: Http = async req => {
    calls.push(req)
    if (req.url.includes("/app/iam/api/v1/refreshToken")) {
      refreshes++
      return { status: 200, text: JSON.stringify({ code: 200, data: { accessToken: "a", jwtToken: "j", globalAccessToken: `g${refreshes}`, expiresIn: 1800 } }) }
    }
    const auth = req.headers!.authorization
    if (opts.expireFirst && auth === "Bearer g1") return { status: 401, text: "", bytes: new Uint8Array(0) }
    if (opts.grpcStatus) return { status: 200, text: "", bytes: new Uint8Array(0), headers: { "grpc-status": opts.grpcStatus, "grpc-message": "vehicle%20offline" } }
    const msg = req.url.endsWith("FuelService/GetFuel") ? fuelMessage() : odometerMessage()
    return { status: 200, text: "", bytes: grpcFrame(msg), headers: { "grpc-status": "0" } }
  }
  return { http, calls }
}

test("沃尔沃 vehicleStatus：两个接口一起读；请求头与 App 相同；会话失效时重新换一次", async () => {
  const { http, calls } = fakeVolvo({ expireFirst: true })
  const st = await volvoCn.vehicleStatus!({ http, now: () => 1792300000000 }, { refreshToken: "rt-status-1" }, VIN)
  assert.deepEqual({ ...st, raw: undefined }, { ts: SEC * 1000 + 420, fuel_l: 52, range_km: 620, avg_consumption: 13.2, odometer_km: 82943.341, raw: undefined })
  assert.match(st.raw[0], /^GetFuel .*4=52（float） 5=385/)
  const grpc = calls.filter(c => c.method === "POST")
  assert.equal(grpc.length, 4, "第一次 401，换会话后再读两个")
  const last = grpc[grpc.length - 1]
  assert.equal(last.headers!.authorization, "Bearer g2")
  assert.equal(last.headers!["content-type"], "application/grpc")
  assert.equal(last.headers!.vin, VIN)
  assert.ok(last.binary)
  assert.equal(last.stopWhen, grpcHasMessage, "流式接口：读到第一条消息就停")
  assert.deepEqual([...last.bodyBytes!], [...statusRequestBody(VIN)])
  assert.ok(grpc.some(c => c.url === "https://cepmobtoken.prod.c3.volvocars.com.cn/services.vehiclestates.odometer.OdometerService/GetOdometer"))
})

test("沃尔沃 vehicleStatus：gRPC 报错时给出原因", async () => {
  const { http } = fakeVolvo({ grpcStatus: "14" })
  await assert.rejects(volvoCn.vehicleStatus!({ http, now: () => 1792300000000 }, { refreshToken: "rt-status-2" }, VIN), /gRPC 14：vehicle offline/)
})

const har = XXYH_ROOT ? join(XXYH_ROOT, "materials/2026-10-13-003550.har") : ""

test("真实抓包（2026-10-13）：GetFuel 52 L、620 km、13.2 L/100km；GetOdometer 82,943.341 km；请求体与 App 相同", { skip: har && existsSync(har) ? false : "需要 XXYH_ROOT 和 materials/2026-10-13-003550.har" }, () => {
  const entries: any[] = JSON.parse(readFileSync(har, "utf8")).log.entries
  const find = (name: string) => entries.find(e => e.request.url.endsWith(name))
  const bytesOf = (e: any) => Uint8Array.from(Buffer.from(e.response.content.text, "base64"))
  const fuel = find("FuelService/GetFuel")
  const odo = find("OdometerService/GetOdometer")
  const vin = fuel.request.headers.find((h: any) => h.name.toLowerCase() === "vin").value
  assert.equal(Buffer.from(fuel.request.postData.text, "latin1").equals(Buffer.from(statusRequestBody(vin))), true)
  const f = parseFuel(pbMessage(grpcMessages(bytesOf(fuel))[0]))
  const o = parseOdometer(pbMessage(grpcMessages(bytesOf(odo))[0]))
  assert.deepEqual(f, { ts: Date.parse("2026-10-12T07:16:59.420Z"), fuel_l: 52, range_km: 620, avg_consumption: 13.2 })
  assert.equal(o.odometer_km, 82943.341)
})
