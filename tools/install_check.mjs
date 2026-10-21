// 把手机上的自动检查装到 Scripting 的脚本目录（../FuelNote Check），开发服务器才能同步到手机。说明见 tools/check/README.md。
// 连同油记的代码一起复制（common、platform、pages 等），tools/check 里的 "../../" 导入改成 "./"。只写有变化的文件，
// 先写到脚本目录外的临时文件夹再改名：直接覆盖时开发服务器可能读到写了一半的文件，手机会按旧内容重新运行。
// 第一次需要在手机上新建一个同名的空脚本「FuelNote Check」，再在开发服务器页面里选它。
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const app = join(here, "..")
const to = join(app, "..", "FuelNote Check")
const tmp = join(to, "..", ".install-tmp")
const DIRS = ["common", "platform", "pages", "providers", "sync", "stations", "readers"]

/** 目录下的全部文件（相对路径） */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const files = new Map()
for (const d of DIRS) for (const p of walk(join(app, d))) files.set(relative(app, p), readFileSync(p))
for (const p of walk(join(here, "check"))) {
  const rel = relative(join(here, "check"), p)
  const text = readFileSync(p, "utf8")
  files.set(rel, Buffer.from(/\.tsx?$/.test(rel) ? text.replace(/from "\.\.\/\.\.\//g, 'from "./') : text, "utf8"))
}

mkdirSync(tmp, { recursive: true })
let changed = 0
for (const [rel, content] of files) {
  const target = join(to, rel)
  if (existsSync(target) && readFileSync(target).equals(content)) continue
  mkdirSync(dirname(target), { recursive: true })
  const staged = join(tmp, rel.replace(/[\\/]/g, "__"))
  writeFileSync(staged, content)
  renameSync(staged, target)
  changed++
}
console.log(`已更新 ${to}：${changed} 个文件有变化（共 ${files.size} 个）`)
