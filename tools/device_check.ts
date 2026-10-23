// 手机上的自动检查（电脑端）。手机上开着「FuelNote Check」（tools/check），它向采样服务报到后，这里直接请求手机。说明见 tools/check/README.md。
//
//   XXYH_ROOT=E:/GitHub/xxyh npx tsx tools/device_check.ts [recognize] [ledger] [shots] [split]   （不写时都做）
//
// 真实数据（期望值、小熊里的保险费用、小熊备份）只从 XXYH_ROOT 读，计划在这里生成后发给手机；结果和截图存到 XXYH_ROOT/out/check/，不进仓库。
// split（1.6，设计文档第 21 节）：把最新的小熊备份发给手机，在检查用的文件夹里建一辆关联小熊的车，用同一套纯函数算出期望值来比较。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { expenseEntries, expenseSummary, expenseYears, monthTotals, withoutCarInsurance } from "../common/expense_stats"
import { monthFuelCost, summarize, yearSummaries } from "../common/fuel_stats"
import { ParsedMark, ParsedPolicy } from "../common/policy_text"
import { monthKey } from "../common/time"
import { FuelRecord, LedgerRecord } from "../common/types"
import { carKey, mapBackup } from "../sync/xxyh/mapping"
import { XxyhBackup } from "../sync/xxyh/types"
import { latestBackupFile, readJson } from "../tests/helpers"
import { checkMark, compareExpected, Expected } from "../tests/insurance_expected"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const OUT = join(ROOT, "out/check")
const BRIDGE = "http://127.0.0.1:3100"
const DAY = 86400e3
const BJ = (s: string) => Date.parse(`${s}+08:00`)
const INSURANCE_CATEGORY = 100002

type Step = { name: string; ok: boolean; detail: string }

function phoneUrl(): string {
  const file = join(OUT, "phone.json")
  if (!existsSync(file)) throw new Error("手机还没报到：先在手机上打开「FuelNote Check」")
  const p = readJson(file) as { address: string; port: number; stamp: string }
  return `http://${p.address}:${p.port}`
}

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15 * 60e3) })
  if (!res.ok) throw new Error(`${url} 返回 HTTP ${res.status}`)
  const body = (await res.json()) as T & { error?: string }
  if (body.error) throw new Error(`手机上出错：${body.error}`)
  return body
}

function post<T>(url: string, body: unknown): Promise<T> {
  return call<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
}

const expected = (): Record<string, Expected> => readJson(join(ROOT, "out/insurance/expected.json"))

/** 采样服务清单里的保单文件（PDF 和图片） */
async function insuranceFiles(): Promise<string[]> {
  const list = (await (await fetch(`${BRIDGE}/list`)).json()) as Array<{ id: string; kind: string }>
  return list.filter(i => i.kind === "pdf" || i.kind === "ins_image").map(i => i.id)
}

// ---------- 识别：第 129、139、142 项 ----------

async function recognize(phone: string): Promise<number> {
  const ids = await insuranceFiles()
  console.log(`识别：${ids.length} 个文件，手机上读取（读不出文字的截图识别）……`)
  const r = await post<{ results: Array<{
    id: string; textless: boolean; image: boolean; error: string | null; parsed: ParsedPolicy | null; mark: { info: ParsedMark; page: number | null } | null; pages: string[] | null
  }> }>(`${phone}/run/recognize`, { ids })
  writeFileSync(join(OUT, "recognize.json"), JSON.stringify(r, null, 1))
  // 手机上 PDFKit 取出的原文：pdfkit.jsonl 里还没有的补上（tests/policy_text.test.ts 的真实保单测试用）
  const kitFile = join(ROOT, "out/insurance/pdfkit.jsonl")
  const have = new Set(readFileSync(kitFile, "utf8").split("\n").filter(l => l.trim()).map(l => (JSON.parse(l) as { file: string }).file))
  const fresh = r.results.filter(x => x.pages && !have.has(x.id))
  for (const x of fresh) appendFileSync(kitFile, JSON.stringify({ file: x.id, pages: x.pages, from: "check" }) + "\n")
  if (fresh.length) console.log(`识别：手机上取出的文字补进 pdfkit.jsonl ${fresh.length} 份（${fresh.map(x => x.id.split("/").pop()).join("、")}）`)
  const exp = expected()
  const problems: string[] = []
  let checked = 0
  for (const x of r.results) {
    const e = exp[x.id]
    if (!e) continue
    checked++
    if (x.error) { problems.push(`${x.id}：${x.error}`); continue }
    checkMark(x.id, e, x, problems)
    if (e.not_policy) { if (x.parsed) problems.push(`${x.id}：标志被当成了保单`) }
    else if (!x.parsed) problems.push(`${x.id}：没认出是保单`)
    else compareExpected(x.id, e, x.parsed, problems)
  }
  const scanned = r.results.filter(x => x.textless).length
  console.log(`识别：核对 ${checked} 个文件（其中截图识别 ${scanned} 个），${problems.length ? `${problems.length} 处不对` : "全部一致"}`)
  for (const p of problems) console.log(`  ✗ ${p}`)
  return problems.length
}

// ---------- 记账：第 130–132、135、136、138、141、142 项 ----------

/** 小熊里已有的保险费用（最新的云备份） */
function seeds(): Array<{ ts: number; amount: number; remark: string }> {
  const file = latestBackupFile()
  if (!file) return []
  const b = readJson(file) as { cars: Array<{ expenseRecords?: Array<{ type: number; date: number; expense: number; description?: string }> }> }
  return b.cars.flatMap(c => c.expenseRecords ?? []).filter(r => r.type === 100002)
    .map(r => ({ ts: r.date, amount: r.expense, remark: r.description ?? "" })).sort((a, b) => a.ts - b.ts)
}

/** 每年（保单文件夹）的文件、签单日期、合计；付款日期前后 45 天内有小熊费用的补到那笔，金额不同时保留原金额 */
async function plan() {
  const exp = expected()
  const ids = await insuranceFiles()
  const s = seeds()
  const folders = [...new Set(ids.map(id => id.split("/")[1]))].filter(f => /^\d{4}年/.test(f)).sort()
  const years = folders.map(folder => {
    const files = ids.filter(id => id.split("/")[1] === folder)
    const policies = files.map(id => exp[id]).filter((e): e is Expected => !!e && !e.not_policy)
    const sign = Math.max(...policies.map(e => BJ(`${e.sign}T12:00:00`)))
    const total = Math.round(policies.reduce((t, e) => t + e.premium + (e.vehicle_tax ?? 0), 0) * 100) / 100
    const near = s.map((x, i) => ({ i, d: Math.abs(x.ts - sign) })).filter(x => x.d <= 45 * DAY).sort((a, b) => a.d - b.d)[0]
    const link = near ? near.i : null
    const amount: "total" | "keep" = link != null && Math.abs(s[link].amount - total) > 0.005 ? "keep" : "total"
    return { label: folder.slice(0, 4), files, link, amount, total, sign }
  })
  return { seeds: s, years }
}

async function ledger(phone: string): Promise<number> {
  const p = await plan()
  console.log(`记账：${p.years.length} 年、小熊里已有 ${p.seeds.length} 笔保险费用；${p.years.map(y => `${y.label}${y.link != null ? `补到已有（${y.amount === "keep" ? "保留原金额" : "改成合计"}）` : "新记"}`).join("、")}`)
  const r = await post<{ steps: Step[] }>(`${phone}/run/ledger`, p)
  writeFileSync(join(OUT, "ledger.json"), JSON.stringify(r, null, 1))
  for (const s of r.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}${s.detail ? `（${s.detail}）` : ""}`)
  const bad = r.steps.filter(s => !s.ok).length
  console.log(`记账：${r.steps.length} 项，${bad ? `${bad} 项不对` : "全部通过"}`)
  return bad
}

// ---------- 油耗与费用分开：第 143–150 项 ----------

async function split(phone: string): Promise<number> {
  const file = latestBackupFile()
  if (!file) throw new Error("没有小熊备份（XXYH_ROOT/out/xxyh_backup_v*.json）")
  const doc = readJson(file) as XxyhBackup
  const version = Number(/v(\d+)\.json$/.exec(file)?.[1] ?? 0)
  const p = await plan()
  const car = carKey(doc.cars.find(c => Number(c.selected) === 1) || doc.cars[0])
  const records: LedgerRecord[] = mapBackup(doc, k => (k === car ? "v" : null)).records.map(r => ({ ...r, origin: "xxyh" as const, pending: false }))
  const fills = records.filter((r): r is FuelRecord & LedgerRecord => r.kind === "fuel")
  const now = Date.now()
  const fuel = (["ytd", "all"] as const).map(range => {
    const s = summarize(fills, range, now)
    return { range, count: s.fuel_count, cost: s.fuel_cost, distance: s.distance_km, avg: s.avg_consumption }
  })
  const entries = expenseEntries(records)
  // 费用页和费用统计（1.6.0-beta.4）：去掉车险。备份里的保险费用备注都写着「…车险」，导入保单后新记的也是，所以不用知道关联了哪一年
  const rest = withoutCarInsurance(entries, [])
  const restAll = expenseSummary(rest, "all", now)
  const categories = restAll.categories
  const expense = { total: restAll.total, count: restAll.count, years: expenseYears(rest).map(y => [y.year, y.total, y.count] as [number, number, number]) }
  const linkedSeeds = new Set(p.years.filter(y => y.link != null).map(y => y.link))
  // 保险和交通规费：备份里原有的几笔，加上导入保单后新记的、改成保单合计的
  let insurance = records.reduce((t, r) => t + (r.kind === "expense" && r.category_id === INSURANCE_CATEGORY ? r.amount : 0), 0)
  for (const y of p.years) {
    if (y.link == null) insurance += y.total
    else if (y.amount === "total") insurance += y.total - p.seeds[y.link].amount
  }
  const maintenance = records.filter(r => r.kind === "maintenance")
  // 有保养、又没有保险费用落进去的第一个月
  const insuranceMonths = new Set([...records.filter(r => r.kind === "expense" && r.category_id === INSURANCE_CATEGORY).map(r => monthKey(r.ts)), ...p.years.map(y => monthKey(y.sign))])
  const key = maintenance.map(r => monthKey(r.ts)).sort().find(k => !insuranceMonths.has(k)) ?? null
  const month = key ? { key, total: monthTotals(entries).get(key) ?? 0 } : null
  const d = new Date(now)
  const thisYear = yearSummaries(fills).find(y => y.year === d.getFullYear())
  const widget = { month: monthKey(now), month_cost: monthFuelCost(fills, now), year: String(d.getFullYear()), year_cost: thisYear ? thisYear.cost : 0 }
  console.log(`油耗与费用：小熊备份 v${version}，${fills.length} 条加油、${entries.length} 笔费用（${maintenance.length} 条保养）；${p.years.length} 年保单`)
  const expect = {
    fuel, categories, expense, insurance_years: p.years.length, amount_only: p.seeds.length - linkedSeeds.size, insurance, maintenance: maintenance.length, month, widget,
  }
  const r = await post<{ steps: Step[] }>(`${phone}/run/split`, { doc, version, plan: p, expect })
  writeFileSync(join(OUT, "split.json"), JSON.stringify(r, null, 1))
  for (const s of r.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}${s.detail ? `（${s.detail}）` : ""}`)
  const bad = r.steps.filter(s => !s.ok).length
  console.log(`油耗与费用：${r.steps.length} 项，${bad ? `${bad} 项不对` : "全部通过"}`)
  return bad
}

// ---------- 截图：第 128、133–135、137、142 项（记账之后），第 144–147、149、152–158 项（油耗与费用之后） ----------

// ---------- 权益：第 161–168 项（油耗与费用之后，在同一辆关联小熊的车上） ----------

/**
 * 用户的 2026 车险赠送（原文和条目）和保养套餐（XXYH_ROOT/out/benefits/benefits.json，不进仓库），发给手机识别、加进检查用的账本；
 * 有套餐的截图（out/benefits/package.png）时一起发过去识别
 */
async function benefits(phone: string): Promise<number> {
  const file = join(ROOT, "out/benefits/benefits.json")
  if (!existsSync(file)) throw new Error(`没有 ${file}`)
  const plan = readJson(file) as { gift: { items: unknown[] }; pkg: { items: unknown[]; image?: string } }
  const image = join(ROOT, "out/benefits/package.png")
  if (existsSync(image)) plan.pkg.image = readFileSync(image).toString("base64")
  console.log(`权益：车险赠送 ${plan.gift.items.length} 项、套餐 ${plan.pkg.items.length} 项${plan.pkg.image ? "（带套餐截图）" : ""}`)
  const r = await post<{ steps: Step[] }>(`${phone}/run/benefits`, plan)
  writeFileSync(join(OUT, "benefits.json"), JSON.stringify(r, null, 1))
  for (const s of r.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}${s.detail ? `（${s.detail}）` : ""}`)
  const bad = r.steps.filter(s => !s.ok).length
  console.log(`权益：${r.steps.length} 项，${bad ? `${bad} 项不对` : "全部通过"}`)
  return bad
}

/** 页面撑高（单位：点），一张截图看到整页；0 为一屏 */
const SHOTS_LEDGER: Array<[string, number]> = [["detail", 2400], ["form", 3000], ["renewal", 0]]
const SHOTS_SPLIT: Array<[string, number]> = [
  ["fuel-records", 0], ["fuel-stats", 2400], ["expense-records", 2400], ["expense-stats", 1400], ["expense-form", 0], ["insurance-records", 2000], ["insurance-2021", 2400],
]

const SHOTS_BENEFITS: Array<[string, number]> = [
  ["benefit-tab", 2600], ["benefit-batch", 1600], ["benefit-card", 1400], ["benefit-done", 0], ["benefit-add", 2600], ["benefit-item", 1400], ["benefit-batch-edit", 0],
  ["benefit-use", 0], ["benefit-pick", 2400], ["expense-benefits", 1200], ["store-picker", 1200], ["insurance-2026", 2600],
]

async function shots(phone: string, screens: Array<[string, number]>): Promise<number> {
  mkdirSync(join(OUT, "shots"), { recursive: true })
  let failed = 0
  for (const [screen, height] of screens) {
    for (const scheme of ["light", "dark"]) {
      const res = await fetch(`${phone}/shot?screen=${screen}&scheme=${scheme}&height=${height}`, { signal: AbortSignal.timeout(60e3) })
      const type = res.headers.get("content-type") ?? ""
      if (!res.ok || !type.includes("image/png")) {
        failed++
        console.log(`  ✗ ${screen}（${scheme}）：HTTP ${res.status} ${type.includes("json") ? await res.text() : ""}`)
        continue
      }
      const file = join(OUT, "shots", `${screen}-${scheme}.png`)
      writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      console.log(`  ✓ ${file}`)
    }
  }
  return failed
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const phone = phoneUrl()
  const ping = await call<{ stamp: string; data: string }>(`${phone}/ping`)
  console.log(`手机 ${phone}，STAMP ${ping.stamp}，数据文件夹 ${ping.data}`)
  if (!ping.data.endsWith("/FuelNoteCheck")) throw new Error("手机上的数据文件夹不是 FuelNoteCheck，停止")
  const want = process.argv.slice(2)
  const run = (name: string) => !want.length || want.includes(name)
  let bad = 0
  if (run("recognize")) bad += await recognize(phone)
  if (run("ledger")) bad += await ledger(phone)
  if (run("shots")) bad += await shots(phone, SHOTS_LEDGER)
  if (run("split")) {
    bad += await split(phone)
    bad += await shots(phone, SHOTS_SPLIT)
  }
  // 要在 split 之后（用它建的那辆关联小熊的车）
  if (run("benefits")) {
    bad += await benefits(phone)
    bad += await shots(phone, SHOTS_BENEFITS)
  }
  process.exitCode = bad ? 1 : 0
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
