// 小组件的导入链（设计文档 9.4 节）：widget.tsx 只从 common/widget_runtime 导入；整条链没有循环依赖（打包器出过问题的情形），
// 也不加载账本、同步、识别这些大模块（小组件内存约 30MB）。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"

const ROOT = join(__dirname, "..")

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8")
  const out: string[] = []
  for (const m of src.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)) out.push(m[1])
  return out
}

function resolve(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null
  const base = join(dirname(from), spec)
  for (const ext of [".ts", ".tsx"]) if (existsSync(base + ext)) return base + ext
  throw new Error(`找不到 ${spec}（${relative(ROOT, from)}）`)
}

test("小组件只从 common/widget_runtime 导入；导入链没有循环，不含账本和同步", () => {
  const entry = join(ROOT, "widget.tsx")
  assert.deepEqual(importsOf(entry).filter(s => s.startsWith(".")), ["./common/widget_runtime"])
  const seen = new Set<string>()
  const stack: string[] = []
  const cycles: string[] = []
  const visit = (file: string) => {
    if (stack.includes(file)) { cycles.push([...stack.slice(stack.indexOf(file)), file].map(f => relative(ROOT, f)).join(" → ")); return }
    if (seen.has(file)) return
    seen.add(file)
    stack.push(file)
    for (const spec of importsOf(file)) { const f = resolve(file, spec); if (f) visit(f) }
    stack.pop()
  }
  visit(entry)
  assert.deepEqual(cycles, [])
  const loaded = [...seen].map(f => relative(ROOT, f).replace(/\\/g, "/")).sort()
  for (const heavy of ["common/model.ts", "common/ledger.ts", "sync/xxyh/sync.ts", "sync/xxyh/api.ts", "common/receipt.ts", "readers/azure.ts", "pages/app.tsx"]) {
    assert.ok(!loaded.includes(heavy), `小组件不应加载 ${heavy}`)
  }
  assert.ok(loaded.includes("providers/volvo_cn.ts"))
})
