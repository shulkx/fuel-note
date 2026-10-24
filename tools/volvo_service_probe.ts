// 沃尔沃养修记录的探测（开发用，只读）：用 XXYH_ROOT/tools/volvo.json 的 refresh token 走油记的签名，
// 依次调工单列表、工单详情、工单信息（经销商）、维修委托单（到店里程）、结算明细（零件、优惠、自付）。
// 原始返回存到 XXYH_ROOT/out/volvo_probe/（不进仓库，含个人信息），屏幕上只打印摘要，不打印电话、姓名、车牌。
//   XXYH_ROOT=E:/GitHub/xxyh npx tsx tools/volvo_service_probe.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Http } from "../platform/http"
import { volvoCn, volvoGateway } from "../providers/volvo_cn"

const ROOT = process.env.XXYH_ROOT || "E:/GitHub/xxyh"
const OUT = join(ROOT, "out/volvo_probe")
const API = "/app/maintenance/api/v1"
/** 只放行沃尔沃网关上的读取；POST 只允许结算明细这一个查询接口 */
const http: Http = async req => {
  const method = req.method || "GET"
  if (method !== "GET" && !req.url.includes("/repairing/queryRepairBalanceList")) throw new Error(`探测只读：${req.url}`)
  const res = await fetch(req.url, { method, headers: req.headers, body: req.body, signal: AbortSignal.timeout((req.timeout || 30) * 1000) })
  return { status: res.status, text: await res.text() }
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const day = (s: unknown) => String(s || "").slice(0, 16)

async function main() {
  const cred = { refreshToken: String(JSON.parse(readFileSync(join(ROOT, "tools/volvo.json"), "utf8")).refreshToken || "") }
  const ctx = { http, now: () => Date.now() }
  const vin = (await volvoCn.listVehicles(ctx, cred))[0].id
  mkdirSync(OUT, { recursive: true })

  // 与 App 相同：一次取 100 条，data 直接是数组
  const r = await volvoGateway(ctx, cred, `${API}/queryReservationLogByQuery`, { vin, combinationState: "0", pageIndex: "0", pageSize: "100" })
  if (Number(r && r.code) !== 200) throw new Error(`工单列表失败：${r && r.code} ${r && r.msg}`)
  const list: any[] = Array.isArray(r.data) ? r.data : []
  writeFileSync(join(OUT, "list.json"), JSON.stringify(list, null, 1))
  console.log(`工单列表 ${list.length} 条`)

  for (const it of list) {
    const orderId = String(it.orderId || "")
    const owner = String(it.dealerCode || "")
    if (!orderId || !owner) { console.log(`- ${day(it.reservationDate)} ${it.reservationTypeName} ${it.stateName}：没有工单号`); continue }
    const saved: Record<string, unknown> = { item: it }
    const detail = await volvoGateway(ctx, cred, `${API}/repairing/getMaintenanceOrderDetail`, { vinCode: vin, ownerCode: owner, orderId })
    saved.detail = detail
    const roNos: string[] = (detail && detail.data && detail.data.cardInfo && detail.data.cardInfo.word006 && detail.data.cardInfo.word006.roNos) || []
    await sleep(300)
    saved.info = await volvoGateway(ctx, cred, `${API}/repairing/getMaintenanceOrderInfo`, { vinCode: vin, orderId, ownerCode: owner })
    await sleep(300)
    let tickets: any = null
    let balance: any = null
    if (roNos.length) {
      tickets = await volvoGateway(ctx, cred, `${API}/repairing/queryRepairTicketList`, { roNoList: roNos.join(","), ownerCode: owner, vinCode: vin })
      await sleep(300)
      balance = await volvoGateway(ctx, cred, `${API}/repairing/queryRepairBalanceList`, {}, { vin, ownerCode: owner, roNoList: roNos, orderId, cancellationFlag: "10041002" })
      await sleep(300)
    }
    saved.tickets = tickets
    saved.balance = balance
    writeFileSync(join(OUT, `${orderId}.json`), JSON.stringify(saved, null, 1))

    const t: any[] = (tickets && tickets.data && tickets.data.list) || []
    const b: any[] = (balance && balance.data && balance.data.list) || []
    const dealer = (saved.info as any)?.data?.dealerInfo
    console.log(`- ${day(it.reservationDate)} ${it.reservationTypeName} · ${it.stateName} · ${dealer ? dealer.companyShortNameCn || dealer.companyNameCn : it.dealerName} · 工单 ${roNos.length} 张`
      + `（详情 ${detail && detail.code}，委托单 ${tickets ? tickets.code : "—"}，结算 ${balance ? balance.code : "—"}）`)
    for (const x of t) {
      const projects = (x.handRepairProjectList || []).map((p: any) => p.handRepairProjectName).join("；")
      console.log(`    委托单 ${day(x.roCreateDate)} ${x.repairTypeCodeName} · 里程 ${x.inMileage || "—"} · 原价 ${x.totalOriginalAmount} · 优惠 ${x.totalPreferentialAmount} · 实付 ${x.totalPayAmount} · ${projects}`)
    }
    for (const x of b) {
      const parts = (x.handRepairProjectList || []).flatMap((p: any) => (p.repairPartList || []).map((q: any) => q.partName || q.repairPartName || "?"))
      const pref = (x.roPreferentialVoList || []).map((p: any) => `${p.preferentialName} ${p.preferentialAmount}`)
      console.log(`    结算 ${day(x.balanceTime)} ${x.repairTypeName} · 自付 ${x.ownAmount} · 零件 ${parts.length} 项${pref.length ? ` · 优惠：${pref.join("；")}` : ""}`)
    }
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
