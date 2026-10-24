// 纯逻辑层（CLAUDE.md 的分层规则）：common/（除下面三个）、sync/、stations/、readers/、providers/ 和 platform/http.ts
// 不导入 "scripting"、不导入其他 platform/ 文件、不用 Scripting 的全局对象，Node 测试才能直接加载
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..")
/** 例外：model.ts 是页面用的应用层；widget_runtime.ts 是小组件的入口模块；widget_data.ts 不引用其他源文件，自己读 widget.json */
const EXCEPT = new Set(["common/model.ts", "common/widget_runtime.ts", "common/widget_data.ts"])
const GLOBALS = /\b(FileManager|Keychain|Dialog|Navigation|Pasteboard|Storage|Script|Widget|BackgroundKeeper|Notification|Intent|DocumentPicker|ShareSheet)\./

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).filter(n => n.endsWith(".ts")).map(n => `${dir}/${n}`)
}

test("纯逻辑层不碰 Scripting", () => {
  const files = [...["common", "sync/xxyh", "stations", "readers", "providers"].flatMap(sources), "platform/http.ts"].filter(f => !EXCEPT.has(f))
  assert.ok(files.length > 30)
  const bad: string[] = []
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map(l => l.replace(/\/\/.*$/, "")).join("\n")
    if (/from "scripting"/.test(text)) bad.push(`${f}：导入 "scripting"`)
    const platform = [...text.matchAll(/from "\.\.\/(?:\.\.\/)?platform\/(\w+)"/g)].map(m => m[1]).filter(m => m !== "http")
    if (platform.length) bad.push(`${f}：导入 platform/${platform.join("、")}`)
    const g = GLOBALS.exec(text)
    if (g) bad.push(`${f}：用了 ${g[1]}`)
  }
  assert.deepEqual(bad, [])
})
