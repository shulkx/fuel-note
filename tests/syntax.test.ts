// Scripting 把每个源文件（包括 .ts）都按 TSX 转译。在 TSX 里 `<T>(v: T) => …` 会被当成 JSX 标签，
// tsc 检查 .ts 时发现不了，到手机上才报 `Unexpected token ','` 或 `Can't find variable: T`。
// 这里把每个源文件都当作 .tsx 解析一遍，有语法错误就失败。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import ts from "typescript"

const ROOT = join(__dirname, "..")
const SKIP = new Set(["node_modules", "tests", "docs"])

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

test("所有源文件都能按 TSX 解析（与 Scripting 的转译方式一致）", () => {
  const problems: string[] = []
  for (const file of sources(ROOT)) {
    const rel = relative(ROOT, file)
    const sf = ts.createSourceFile(`${rel}.tsx`, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
    const diags = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics || []
    for (const d of diags) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start || 0)
      problems.push(`${rel}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    }
  }
  assert.deepEqual(problems, [])
})
