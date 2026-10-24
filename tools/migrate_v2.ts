// 现有数据转换到 2.0（2.0 设计第 5 节）。只在电脑上运行，不进发布包：
//   XXYH_ROOT=E:/GitHub/xxyh npx tsx tools/migrate_v2.ts <1.x 备份.json>
// 输出到 XXYH_ROOT/out/fuelnote/：backup-v2.json（在油记 2.0 里恢复）、report.md（转换报告，含真实数据，不进仓库）。
// 屏幕只打印条数和文件位置。
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { isRefuel } from "../sync/xxyh/mapping"
import { migrateV1, MigrationReport, recordCounts, V1Backup } from "./migrate_v2_core"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const OUT = join(ROOT, "out/fuelnote")

function reportText(r: MigrationReport, input: string): string {
  const lines = [`# 油记 2.0 转换报告`, ``, `来源：${input}`, ``, `## 车辆和记录`, ``]
  for (const v of r.vehicles) lines.push(`- ${v.name}：加油 ${v.fuel} 条、费用 ${v.expense} 笔、保养 ${v.maintenance} 条（${v.paired} 条配上了费用）`)
  lines.push(``, `## 保险`, ``)
  for (const y of r.insurance) lines.push(`- ${y.ok ? "✓" : "✗"} ${y.detail}`)
  lines.push(``, `## 权益使用`, ``, `共 ${r.uses.total} 条，对上费用 ${r.uses.matched} 条。`)
  for (const u of r.uses.unmatched) lines.push(`- ${u}`)
  lines.push(``, `## 问题`, ``)
  if (!r.problems.length) lines.push(`没有。`)
  for (const p of r.problems) lines.push(`- ${p}`)
  return lines.join("\n") + "\n"
}

function main() {
  const input = process.argv[2]
  if (!input || input.startsWith("--")) throw new Error("用法：npx tsx tools/migrate_v2.ts <1.x 备份.json>")
  const v1 = JSON.parse(readFileSync(input, "utf8")) as V1Backup
  const appVersion = JSON.parse(readFileSync(join(__dirname, "..", "script.json"), "utf8")).version
  const { backup, report } = migrateV1(v1, appVersion)

  // 条数：转换前 1.x 显示的（小熊车辆按云端、本机车辆按本机记录）和转换后的，每辆车每种都要相同
  const after = recordCounts(backup.ledger.records)
  const bad: string[] = []
  for (const v of v1.ledger.vehicles) {
    const car = v.xxyh_car ? v1.xxyh.base?.cars.find(c => String(c.uuid) === v.xxyh_car) : null
    const before = car
      ? { fuel: (car.fuelRecords || []).filter(isRefuel).length, expense: (car.expenseRecords || []).length, maintenance: (car.maintainRecords || []).length }
      : {
        fuel: v1.ledger.records.filter(r => r.vehicle_id === v.id && r.kind === "fuel").length,
        expense: v1.ledger.records.filter(r => r.vehicle_id === v.id && r.kind === "expense").length,
        maintenance: 0,
      }
    const a = after[v.id] ?? { fuel: 0, expense: 0, maintenance: 0 }
    if (a.fuel !== before.fuel || a.expense !== before.expense || a.maintenance !== before.maintenance) {
      bad.push(`${v.name}：转换前 ${JSON.stringify(before)}，转换后 ${JSON.stringify(a)}`)
    }
  }
  if (bad.length) report.problems.push(...bad.map(b => `条数不同：${b}`))

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, "report.md"), reportText(report, input))
  if (report.problems.length) {
    console.log(`转换没有通过检查，${report.problems.length} 个问题，见 ${join(OUT, "report.md")}`)
    process.exit(1)
  }
  writeFileSync(join(OUT, "backup-v2.json"), JSON.stringify(backup))
  for (const v of report.vehicles) console.log(`${v.fuel} 条加油、${v.expense} 笔费用、${v.maintenance} 条保养（${v.paired} 条配上了费用）`)
  console.log(`保险 ${report.insurance.filter(y => y.ok).length}/${report.insurance.length} 年对上费用；权益使用 ${report.uses.matched}/${report.uses.total} 条对上`)
  console.log(`已写出 ${join(OUT, "backup-v2.json")} 和 report.md`)
}

main()
