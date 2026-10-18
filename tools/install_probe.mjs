// 把 tools/probe 复制到 Scripting 的脚本目录（../FuelNote Probe），开发服务器才能同步到手机。
// 第一次需要在手机上新建一个同名的空脚本「FuelNote Probe」，再在开发服务器页面里选它。
import { copyFileSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, "probe")
const to = join(here, "..", "..", "FuelNote Probe")
mkdirSync(to, { recursive: true })
for (const name of readdirSync(from)) copyFileSync(join(from, name), join(to, name))
console.log(`已复制到 ${to}`)
