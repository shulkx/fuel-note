// 油耗和费用不耦合（设计文档 21.5 节）：
// - 油耗的文件不导入费用、保险的文件，费用、保险的文件也不导入油耗的；
// - 页面都从 common/model 导入，所以再查导入的名字：油耗的页面不用费用、保险模块导出的东西，反过来也一样。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import ts from "typescript"

const ROOT = join(__dirname, "..")

const files = (dir: string, re: RegExp) => readdirSync(join(ROOT, dir)).filter(f => re.test(f)).map(f => join(dir, f))
const FUEL_COMMON = files("common", /^fuel.*\.ts$/)
// 1.7 起权益、门店（perk*、store*、redact.ts，页面是 benefit_*、store_*）也算费用一侧（设计文档 22.15 节）
const EXPENSE_COMMON = [...files("common", /^(expense|insurance|perk|store|redact).*\.ts$/), "common/policy_text.ts"]
const FUEL_PAGES = files("pages", /^fuel_.*\.tsx$/)
const EXPENSE_PAGES = files("pages", /^(expense|insurance|policy|benefit|store)_.*\.tsx$/)

function parse(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, readFileSync(join(ROOT, rel), "utf8"), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX)
}

/** 文件里的导入：相对路径解析成仓库里的文件，以及从每个模块导入的名字 */
function imports(rel: string): Array<{ file: string; names: string[] }> {
  const out: Array<{ file: string; names: string[] }> = []
  for (const s of parse(rel).statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.moduleSpecifier.text.startsWith(".")) continue
    const base = resolve(ROOT, dirname(rel), s.moduleSpecifier.text)
    const found = [".ts", ".tsx"].map(ext => base + ext).find(existsSync)
    const bindings = s.importClause?.namedBindings
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.map(e => (e.propertyName ?? e.name).text) : []
    out.push({ file: found ? relative(ROOT, found).replace(/\\/g, "/") : s.moduleSpecifier.text, names })
  }
  return out
}

/** 模块直接导出的名字（函数、常量、类型） */
function exportsOf(rel: string): Set<string> {
  const out = new Set<string>()
  for (const s of parse(rel).statements) {
    const exported = ts.canHaveModifiers(s) && ts.getModifiers(s)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    if (!exported) continue
    if ((ts.isFunctionDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isClassDeclaration(s)) && s.name) out.add(s.name.text)
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) out.add(d.name.text)
  }
  return out
}

function crossing(from: string[], forbidden: string[]): string[] {
  const banned = new Set(forbidden.map(f => f.replace(/\\/g, "/")))
  return from.flatMap(f => imports(f).filter(i => banned.has(i.file)).map(i => `${basename(f)} → ${i.file}`))
}

function namesFromModel(pages: string[], forbidden: string[]): string[] {
  const banned = new Map<string, string>()
  for (const m of forbidden) for (const n of exportsOf(m)) banned.set(n, basename(m))
  return pages.flatMap(p => imports(p).filter(i => i.file === "common/model.ts").flatMap(i => i.names.filter(n => banned.has(n)).map(n => `${basename(p)}：${n}（${banned.get(n)}）`)))
}

test("分组里找得到文件（改名后这个测试仍然在查）", () => {
  assert.ok(FUEL_COMMON.length >= 2 && EXPENSE_COMMON.length >= 3)
  assert.ok(FUEL_PAGES.some(f => f.endsWith("fuel_tab.tsx")) && EXPENSE_PAGES.some(f => f.endsWith("expense_tab.tsx")))
})

test("油耗的文件不导入费用、保险的文件，反过来也一样", () => {
  assert.deepEqual(crossing([...FUEL_COMMON, ...FUEL_PAGES], [...EXPENSE_COMMON, ...EXPENSE_PAGES]), [])
  assert.deepEqual(crossing([...EXPENSE_COMMON, ...EXPENSE_PAGES], [...FUEL_COMMON, ...FUEL_PAGES]), [])
})

test("从 common/model 导入时：油耗的页面不用费用、保险的函数，费用、保险的页面不用油耗的", () => {
  assert.deepEqual(namesFromModel(FUEL_PAGES, EXPENSE_COMMON), [])
  assert.deepEqual(namesFromModel(EXPENSE_PAGES, FUEL_COMMON), [])
})
