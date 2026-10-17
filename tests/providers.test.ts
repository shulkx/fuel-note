import { test } from "node:test"
import assert from "node:assert/strict"
import { createHash, createHmac } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { mapVolvoTrip, parseRefreshToken, signRequest, volvoCn } from "../providers/volvo_cn"
import { accountInfo, downloadBackup } from "../sync/xxyh/api"
import { LIVE, readOnlyHttp, XXYH_ROOT, xxyhTokenFromHar } from "./helpers"

test("沃尔沃签名：与独立实现的 HMAC 一致", () => {
  const now = new Date("2026-10-18T03:04:05.678Z")
  const { url, headers } = signRequest("/app/iam/api/v1/refreshToken", { refreshToken: "a b*c" }, null, now)
  assert.equal(url, "https://apigateway.digitalvolvo.com/app/iam/api/v1/refreshToken?refreshToken=a%20b%2Ac")
  assert.equal(headers["x-sdk-date"], "20261018T030405Z")
  const canonical = "GET\n/app/iam/api/v1/refreshToken/\nrefreshToken=a%20b%2Ac\nhost:apigateway.digitalvolvo.com\nx-sdk-content-sha256:UNSIGNED-PAYLOAD\nx-sdk-date:20261018T030405Z\n\nhost;x-sdk-content-sha256;x-sdk-date\nUNSIGNED-PAYLOAD"
  const sts = `SDK-HMAC-SHA256\n20261018T030405Z\n${createHash("sha256").update(canonical).digest("hex")}`
  const sig = createHmac("sha256", "bjGqb3TvEEZ8W8QhoyhEH4IenwCnc4JQ").update(sts).digest("hex")
  assert.equal(headers.v587sign, `SDK-HMAC-SHA256 Access=204114990, SignedHeaders=host;x-sdk-content-sha256;x-sdk-date, Signature=${sig}`)
  assert.equal(headers.host, undefined)
})

test("沃尔沃行程映射：米 → 公里，GCJ-02 → WGS-84", () => {
  const t = mapVolvoTrip({
    id: "t1",
    tripDetails: [{ fuelConsumption: 2.33, distance: 30656, startOdometer: 82912685, startTime: 1, endOdometer: 82943341, endTime: 2,
      startPosition: { longitude: 121.60495, latitude: 31.23362, streetAddress: "示例路 1号", city: "上海市", region: "浦东新区" },
      endPosition: null }],
  })!
  assert.equal(t.end_odometer_km, 82943.341)
  assert.equal(t.distance_km, 30.656)
  assert.equal(t.end, null)
  assert.ok(t.start && Math.abs(t.start.lng - 121.60495) > 0.003) // 已转换
  assert.equal(mapVolvoTrip({ tripDetails: [{ startTime: 1 }] }), null)
  assert.equal(parseRefreshToken('{"refreshToken":"rt1"}'), "rt1")
  assert.throws(() => volvoCn.normalizeCredential({ refreshToken: "" }))
})

const volvoFile = XXYH_ROOT ? join(XXYH_ROOT, "tools/volvo.json") : ""
test("在线（只读）：沃尔沃车辆与最近 7 天行程", { skip: LIVE && volvoFile && existsSync(volvoFile) ? false : "需要 LIVE=1 和 tools/volvo.json" }, async () => {
  const cred = volvoCn.normalizeCredential({ refreshToken: JSON.parse(readFileSync(volvoFile, "utf8")).refreshToken })
  const ctx = { http: readOnlyHttp, now: () => Date.now() }
  const cars = await volvoCn.listVehicles(ctx, cred)
  assert.ok(cars.length >= 1)
  const trips = await volvoCn.fetchTrips(ctx, cred, cars[0].id, { from: Date.now() - 7 * 86400e3, to: Date.now() })
  console.log(`  ${cars.length} 辆车，最近 7 天 ${trips.length} 段行程${trips.length ? `，最后里程 ${Math.floor(trips[trips.length - 1].end_odometer_km)} km` : ""}`)
  for (const t of trips) assert.ok(t.end_odometer_km > 1000 && t.end_ts >= t.start_ts)
})

test("在线（只读）：小熊账号与最新云备份", { skip: LIVE && xxyhTokenFromHar() ? false : "需要 LIVE=1 和抓包里的 token" }, async () => {
  const token = xxyhTokenFromHar()!
  const acct = await accountInfo(readOnlyHttp, token)
  assert.ok(acct.version && acct.version > 0)
  const doc = await downloadBackup(readOnlyHttp, token, acct.version!)
  console.log(`  云端 v${acct.version}：${doc.cars.length} 辆车，${doc.cars[0].fuelRecords?.length} 条加油`)
  assert.ok(doc.cars.length >= 1)
})
