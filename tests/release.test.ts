// 发布（.github/workflows/release.yml）：远程资源地址指向最新 Release 的 FuelNote.zip；
// 运行需要的源码都打进安装包，开发用的文件不打进去
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")
const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")
/** 只在开发时用，不打包 */
const DEV_DIRS = new Set(["tests", "tools", "docs", "node_modules", "dist"])

// Windows 上检出的文件可能是 CRLF
const env = (name: string) => (workflow.match(new RegExp(`^\\s+${name}:\\s*"?([^"\\r\\n]+)"?\\r?$`, "m")) || [])[1]

test("发布：script.json 的远程资源指向最新 Release 的安装包，每天检查一次", () => {
  const script = JSON.parse(readFileSync(join(ROOT, "script.json"), "utf8"))
  assert.equal(env("PACKAGE_FILE"), "FuelNote.zip")
  assert.deepEqual(script.remoteResource, {
    url: `https://github.com/shulkx/fuel-note/releases/latest/download/${env("PACKAGE_FILE")}`,
    autoUpdateInterval: Number(env("AUTO_UPDATE_INTERVAL")),
  })
})

test("发布：所有运行需要的源码都打进安装包", () => {
  const copied = new Set([...workflow.matchAll(/^\s+cp (?:-R )?(\S+) dist\/package\/$/gm)].map(m => m[1]))
  for (const name of readdirSync(ROOT)) {
    if (name.startsWith(".") || DEV_DIRS.has(name)) continue
    const isDir = statSync(join(ROOT, name)).isDirectory()
    const hasSource = isDir
      ? readdirSync(join(ROOT, name), { recursive: true }).some(f => /\.tsx?$/.test(String(f)))
      : /\.tsx$/.test(name)
    if (hasSource) assert.ok(copied.has(name), `${name} 没有打进安装包（release.yml「Prepare package」）`)
  }
  for (const f of ["script.json", "index.tsx", "widget.tsx", "intent.tsx"]) assert.ok(copied.has(f), f)
  for (const d of DEV_DIRS) assert.ok(!copied.has(d), `${d} 不应打包`)
})

test("发布：运行时代码不引用开发用的目录", () => {
  const runtime = [...workflow.matchAll(/^\s+cp -R (\S+) dist\/package\/$/gm)].map(m => m[1])
  const files = [
    "index.tsx",
    "widget.tsx",
    "intent.tsx",
    ...runtime.flatMap(d => readdirSync(join(ROOT, d), { recursive: true }).map(f => join(d, String(f))).filter(f => /\.tsx?$/.test(f))),
  ]
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8")
    assert.doesNotMatch(src, /from\s+["'](\.\.?\/)+(tests|tools|docs)\//, f)
  }
})
