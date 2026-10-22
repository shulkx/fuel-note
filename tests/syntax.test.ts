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

// Scripting 的 frame 有两种写法：固定的 width/height，或伸缩的 min/max/ideal（scripting.d.ts 的 FrameSizeProps 是两者之一）。
// 混写时类型检查不报错，但运行时只按固定尺寸，maxWidth 等被忽略（1.4.0-beta.1：小组件的「记加油」按钮缩成了文字宽）。
test("frame 不混用固定尺寸和伸缩尺寸", () => {
  const FIXED = new Set(["width", "height"])
  const FLEX = new Set(["minWidth", "maxWidth", "idealWidth", "minHeight", "maxHeight", "idealHeight"])
  const problems: string[] = []
  for (const file of sources(ROOT)) {
    if (!file.endsWith(".tsx")) continue
    const rel = relative(ROOT, file)
    const sf = ts.createSourceFile(rel, readFileSync(file, "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(sf) === "frame" && node.initializer && ts.isJsxExpression(node.initializer)
        && node.initializer.expression && ts.isObjectLiteralExpression(node.initializer.expression)) {
        const keys = node.initializer.expression.properties.map(p => (p.name ? p.name.getText(sf) : ""))
        if (keys.some(k => FIXED.has(k)) && keys.some(k => FLEX.has(k))) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
          problems.push(`${rel}:${line + 1} frame={{ ${keys.join(", ")} }}`)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  assert.deepEqual(problems, [])
})

// 左滑删除前要确认的记录行（油耗、费用、保险页）：按钮设了 role="destructive" 时，一按下系统就把这一行划走，
// 确认时选了「取消」，行却不见了（1.6.0-beta.4）。这些页面统一用 pages/components.tsx 的 swipeToDelete
test("记录页的左滑删除不用 role=\"destructive\"（统一用 swipeToDelete）", () => {
  for (const name of ["fuel_records.tsx", "expense_records.tsx", "insurance_history.tsx"]) {
    const src = readFileSync(join(ROOT, "pages", name), "utf8")
    assert.ok(/trailingSwipeActions[^\n]*swipeToDelete\(/.test(src), `${name} 没有用 swipeToDelete`)
    assert.ok(!/trailingSwipeActions[\s\S]{0,200}role="destructive"/.test(src), `${name} 的左滑按钮设了 role="destructive"`)
  }
})
