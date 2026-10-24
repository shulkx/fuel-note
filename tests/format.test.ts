// 金额的写法和北京时间（common/format.ts）：和合并前各处的写法一样
import { test } from "node:test"
import assert from "node:assert/strict"
import { bjDayStart, grouped, yuan, yuanShort } from "../common/format"

test("金额：千分位、两位小数；整数可以不写小数", () => {
  assert.equal(grouped(0), "0.00")
  assert.equal(grouped(950), "950.00")
  assert.equal(grouped(5510.5), "5,510.50")
  assert.equal(grouped(1234567.891), "1,234,567.89")
  assert.equal(yuan(1000), "¥1,000.00")
  assert.equal(yuan(-12.3), "¥-12.30")
  assert.equal(yuanShort(800), "¥800")
  assert.equal(yuanShort(5000), "¥5,000")
  assert.equal(yuanShort(99.5), "¥99.50")
})

test("北京时间某天 0 点：设备在哪个时区都一样", () => {
  assert.equal(bjDayStart(2026, 1, 7), Date.UTC(2026, 0, 6, 16))
  assert.equal(new Date(bjDayStart(2026, 12, 31) + 8 * 3600e3).toISOString(), "2026-12-31T00:00:00.000Z")
})
