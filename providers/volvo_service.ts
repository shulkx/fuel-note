// 沃尔沃养修（2.1 设计第 3、5 节，纯函数）：把养修接口的返回整理成通用的 ServiceVisit，和沃尔沃的保养项目整理规则。
// 原始返回不存；车牌、人名、电话不进结果（经销商电话除外）。经销商坐标是 GCJ-02，在这里换成 WGS-84。
import { BJ_OFFSET } from "../common/format"
import { gcj02ToWgs84 } from "../common/geo"
import { ServiceDealer, ServiceTicket, ServiceVisit } from "../common/types"
import { ServiceVisitHead, TicketItems } from "./types"

const round2 = (n: number) => Math.round(n * 100) / 100

/** 金额、里程（「1,337.22」「58052KM」）→ 数字；读不出时 0 */
export function volvoNumber(v: unknown): number {
  const n = Number(String(v ?? "").replace(/[,，\s]|KM/gi, ""))
  return Number.isFinite(n) ? n : 0
}

/** 「2024/10/11 12:21」「2024-10-15 15:41:31」（北京时间）→ 毫秒；读不出时 null */
export function volvoTime(v: unknown): number | null {
  const m = String(v ?? "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) - BJ_OFFSET
}

/** 进店列表（queryReservationLogByQuery 的 data）；没有工单号、经销商代码的不要 */
export function parseVisitList(rows: unknown[]): ServiceVisitHead[] {
  const out: ServiceVisitHead[] = []
  for (const r of rows as any[]) {
    const order = String(r?.orderId || "")
    const dealer = String(r?.dealerCode || "")
    const arrive = volvoTime(r?.reservationDate)
    if (!order || !dealer || arrive == null) continue
    const state = String(r?.stateName || "")
    out.push({ order_id: order, dealer_code: dealer, arrive_ts: arrive, state, cancelled: state === "已取消" })
  }
  return out.sort((a, b) => b.arrive_ts - a.arrive_ts)
}

/**
 * 优惠名去掉车牌和券号：「沪B09S59;优惠名称续保赠送油漆券」「09S59;优惠名称销售促销」→ 名称；
 * 「KQ2025122200332026忠诚守候…」（券号是 KQ 加 12 位数字）→「2026忠诚守候…」；「沪B09S59销售赠送保养券」→「销售赠送保养券」
 */
export function prefName(raw: unknown): string {
  let s = String(raw ?? "").trim()
  const i = s.indexOf("优惠名称")
  if (i >= 0) s = s.slice(i + 4)
  return s.replace(/^KQ\d{12}/, "").replace(/^[一-龥][A-Z][A-Z0-9]{5,6}(?![A-Z0-9])[;；]?/, "").trim()
}

const labourName = (raw: unknown) => String(raw ?? "").replace(/^工时：/, "").trim()
const partName = (raw: unknown) => String(raw ?? "").replace(/^材料：/, "").trim()

/** 一张工单的结算（queryRepairBalanceList 的一项）；created：委托单的开单时间（按工单号） */
export function parseTicket(b: any, created: Map<string, number>): ServiceTicket | null {
  const settled = volvoTime(b?.balanceTime)
  if (settled == null) return null
  const projects: any[] = Array.isArray(b.handRepairProjectList) ? b.handRepairProjectList : []
  const prefs = (Array.isArray(b.roPreferentialVoList) ? b.roPreferentialVoList : [])
    .map((p: any) => ({ name: prefName(p?.preferentialName), type: String(p?.preferentialType || ""), amount: round2(volvoNumber(p?.preferentialAmount)) }))
    .filter((p: { amount: number }) => p.amount > 0)
  const prefNames = new Set(prefs.map((p: { name: string }) => p.name))
  const discountList: any[] = Array.isArray(b.discountList) ? b.discountList : []
  const labourDiscount = round2(discountList.filter(d => String(d?.name || "").startsWith("工时：")).reduce((t, d) => t + volvoNumber(d?.amount), 0))
  // 其他减免：不是工时优惠、也不是券和活动优惠（同一条在 discountList 里也有一份）
  const discounts = discountList
    .filter(d => !String(d?.name || "").startsWith("工时：") && volvoNumber(d?.amount) > 0 && !prefNames.has(prefName(d?.name)))
    .map(d => ({ name: String(d.name).trim(), amount: round2(volvoNumber(d.amount)) }))
  const total = round2(volvoNumber(b.totalAmount))
  const own = round2(volvoNumber(b.ownAmount))
  const off = labourDiscount + discounts.reduce((t, d) => t + d.amount, 0) + prefs.reduce((t: number, p: { amount: number }) => t + p.amount, 0)
  const roNo = String(b.roNo || "")
  return {
    ro_no: roNo,
    type: String(b.repairTypeName || ""),
    created_ts: created.get(roNo) ?? settled,
    settled_ts: settled,
    projects: projects.map(p => String(p?.handRepairProjectName || "").trim()).filter(Boolean),
    labours: projects.flatMap(p => (Array.isArray(p?.roLabourList) ? p.roLabourList : []).map((l: any) => labourName(l?.labourName))).filter(Boolean),
    parts: projects.flatMap(p => (Array.isArray(p?.repairPartList) ? p.repairPartList : []).map((q: any) => partName(q?.partName))).filter(Boolean),
    total, own, labour_discount: labourDiscount, discounts, prefs,
    rounding: round2(total - off - own),
    remark: String(b.balanceRemark || "").trim(),
  }
}

/** 经销商（getMaintenanceOrderInfo 的 dealerInfo） */
export function parseDealer(d: any): ServiceDealer | null {
  if (!d || typeof d !== "object") return null
  const lng = volvoNumber(d.longitude)
  const lat = volvoNumber(d.latitude)
  const wgs = lng && lat ? gcj02ToWgs84([lng, lat]) : null
  return {
    short: String(d.companyShortNameCn || d.companyNameCn || "").trim(),
    name: String(d.companyNameCn || "").trim(),
    address: String(d.addressZh || "").trim(),
    phone: String(d.phone || "").trim(),
    lng: wgs ? wgs[0] : null,
    lat: wgs ? wgs[1] : null,
    hours: d.openTime && d.closeTime ? `${d.openTime}–${d.closeTime}` : "",
  }
}

/** 一次进店的明细：经销商、委托单（到店里程、开单时间）、结算。没结算时 tickets 为空 */
export function parseVisit(head: ServiceVisitHead, info: any, ticketList: any, balanceList: any): ServiceVisit {
  const roRows: any[] = Array.isArray(ticketList) ? ticketList : []
  const created = new Map<string, number>()
  for (const r of roRows) {
    const t = volvoTime(r?.roCreateDate)
    if (r?.roNo && t != null) created.set(String(r.roNo), t)
  }
  const odometer = Math.max(0, ...roRows.map(r => volvoNumber(r?.inMileage)))
  const tickets = (Array.isArray(balanceList) ? balanceList : [])
    .map(b => parseTicket(b, created))
    .filter((t): t is ServiceTicket => !!t)
    .sort((a, b) => a.created_ts - b.created_ts)
  return {
    provider: "volvo_cn",
    order_id: head.order_id,
    dealer_code: head.dealer_code,
    arrive_ts: head.arrive_ts,
    state: head.state,
    settled_ts: tickets.length ? Math.max(...tickets.map(t => t.settled_ts)) : null,
    odometer: odometer > 0 ? odometer : null,
    dealer: parseDealer(info?.dealerInfo),
    tickets,
  }
}

// ---------- 保养项目（设计第 5 节）：沃尔沃工单上的叫法，只清理，不按对照表改名 ----------

const BASIC = new Set(["原厂基础保养", "原厂维修保养"])

/** 斜杠写了几个名字的（「更换空调滤芯/乘客室空气滤清器/花粉滤」）：每个名字都对到第一个（沃尔沃的主名）。从全部养修记录的工时收集 */
export function volvoAliases(labours: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const l of labours) {
    const parts = labourName(l).replace(/^更换/, "").split("/").map(s => s.trim()).filter(Boolean)
    if (parts.length < 2) continue
    for (const p of parts) if (!out.has(p)) out.set(p, parts[0])
  }
  return out
}

/** 机油标号：从零件名里读（「沃尔沃全合成机油 0W20 208L」「OIL 0W/20 208L」→「0W20」） */
export function oilGrade(parts: string[]): string {
  for (const p of parts) {
    const m = p.match(/(\d+)\s*W\s*\/?\s*(\d+)/i)
    if (m && (p.includes("机油") || /OIL/i.test(p))) return `${m[1]}W${m[2]}`
  }
  return ""
}

/** 一个工时算什么：不记、写进备注、或几个项目 */
export function classifyLabour(raw: string, parts: string[], aliases: Map<string, string>): { kind: "skip" } | { kind: "note"; text: string } | { kind: "items"; items: string[] } {
  let name = labourName(raw)
  if (name.startsWith("提供") || name.includes("免费检查") || name.includes("健康检查")) return { kind: "skip" }
  if (name.startsWith("服务关怀-")) name = name.slice("服务关怀-".length)
  if (name.includes("检查") || name.includes("客户反映")) return { kind: "note", text: name }
  if (BASIC.has(name)) {
    const g = oilGrade(parts)
    return { kind: "items", items: [g ? `机油 ${g}` : "机油", "机油滤清器"] }
  }
  // 喷漆写成「补漆：左前门、左后门」，和费用页的标题同一个说法（2.1.0-beta.6）
  if (name.startsWith("喷漆")) return { kind: "note", text: name.replace(/^喷漆/, "补漆").replace(/[，,]/g, "、") }
  const main = name.replace(/^更换/, "").split("/")[0].trim()
  return { kind: "items", items: [aliases.get(main) ?? main] }
}

/** 一张工单整理出的项目（第二行写来自哪个工时）和写进备注的检查、问题。只有保养工单出项目 */
export function volvoTicketItems(t: ServiceTicket, aliases: Map<string, string>): TicketItems {
  const items: TicketItems["items"] = []
  const notes: string[] = []
  if (t.type !== "保养") return { items, notes, basic_only: false }
  let kept = 0
  let basic = 0
  for (const l of t.labours) {
    const c = classifyLabour(l, t.parts, aliases)
    if (c.kind !== "skip") kept += 1
    if (BASIC.has(labourName(l))) basic += 1
    if (c.kind === "note") { if (!notes.includes(c.text)) notes.push(c.text) }
    else if (c.kind === "items") for (const name of c.items) if (!items.some(x => x.name === name)) items.push({ name, labour: labourName(l) })
  }
  return { items, notes, basic_only: basic > 0 && kept === basic }
}
