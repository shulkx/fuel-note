// 改版本号：npm run bump -- 1.1.1
// 先在 CHANGELOG.md 最上面写好「## 1.1.1 — 日期」一节，再运行；会同时改 script.json 和 package.json。
// 之后提交「release: 1.1.1」并打标签 v1.1.1（git tag -s）。
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const next = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(next || "")) {
  console.error("用法：npm run bump -- <主版本.次版本.修订号>，例如 1.1.1")
  process.exit(1)
}

const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8")
const top = changelog.match(/^## (\d+\.\d+\.\d+)/m)
if (!top || top[1] !== next) {
  console.error(`CHANGELOG.md 最上面一节应该是「## ${next} — 日期」，现在是「${top ? top[1] : "没有"}」`)
  process.exit(1)
}

const scriptPath = join(root, "script.json")
const script = readFileSync(scriptPath, "utf8")
const current = (script.match(/"version"\s*:\s*"([^"]+)"/) || [])[1]
// script.json 由 Scripting 生成，保留它的格式，只替换版本号
writeFileSync(scriptPath, script.replace(/("version"\s*:\s*)"[^"]+"/, `$1"${next}"`))

const pkgPath = join(root, "package.json")
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
pkg.version = next
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log(`版本 ${current} → ${next}。下一步：git commit -m "release: ${next}" 并 git tag -s v${next} -m "${next}"`)
