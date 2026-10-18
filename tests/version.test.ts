// 版本号：script.json 为准，package.json、package-lock.json 和 CHANGELOG.md 最上面一节必须一致
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")

test("版本号：script.json、package.json、package-lock.json、CHANGELOG.md 一致", () => {
  const script = JSON.parse(readFileSync(join(ROOT, "script.json"), "utf8"))
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"))
  const top = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8").match(/^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) — (\d{4}-\d{2}-\d{2})/m)
  assert.match(script.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/)
  assert.equal(pkg.version, script.version)
  assert.equal(lock.version, script.version)
  assert.equal(lock.packages[""].version, script.version)
  assert.ok(top, "CHANGELOG.md 最上面要有「## 版本 — 日期」")
  assert.equal(top![1], script.version)
})
