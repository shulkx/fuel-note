// 手机上的自动检查（电脑端）。手机上开着「FuelNote Check」（tools/check），它向采样服务报到后，这里直接请求手机。说明见 tools/check/README.md。
//
//   XXYH_ROOT=E:/GitHub/xxyh npx tsx tools/device_check.ts [recognize] [ledger] [shots]   （不写时三项都做）
//
// 真实数据（期望值、小熊里的保险费用）只从 XXYH_ROOT 读，计划在这里生成后发给手机；结果和截图存到 XXYH_ROOT/out/check/，不进仓库。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ParsedMark, ParsedPolicy } from "../common/policy_text"
import { latestBackupFile, readJson } from "../tests/helpers"
import { checkMark, compareExpected, Expected } from "../tests/insurance_expected"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const OUT = join(ROOT, "out/check")
const BRIDGE = "http://127.0.0.1:3100"
const DAY = 86400e3
const BJ = (s: string) => Date.parse(`${s}+08:00`)

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
  const r = await post<{ results: Array<{ id: string; textless: boolean; image: boolean; error: string | null; parsed: ParsedPolicy | null; mark: { info: ParsedMark; page: number | null } | null }> }>(
    `${phone}/run/recognize`, { ids })
  writeFileSync(join(OUT, "recognize.json"), JSON.stringify(r, null, 1))
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
    return { label: folder.slice(0, 4), files, link, amount }
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

// ---------- 截图：第 128、133–135、137、142 项 ----------

async function shots(phone: string): Promise<number> {
  mkdirSync(join(OUT, "shots"), { recursive: true })
  let failed = 0
  // 页面撑高（单位：点），一张截图看到整页
  const screens: Array<[string, number]> = [["coverage", 2000], ["detail", 2400], ["form", 3000], ["records", 0]]
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
  if (run("shots")) bad += await shots(phone)
  process.exitCode = bad ? 1 : 0
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
})
