// 从保单 PDF 的文字里读出保单（设计文档 20.5 节）。纯逻辑：输入每页的文字（PDFKit 的 PDFPage.string），不碰文件。
// PDF 只给整页文字、不给坐标：表格的名称和数值可能分开、行序可能被打乱，所以每一项都有退路，读不准的写进 issues。
// 读不出文字的 PDF（扫描件、特殊字体）截图后由 Vision 识别，文字块先用 ocrPageText 排成行。
import { catalogEntry, itemKey } from "./insurance_catalog"
import { OcrBlock, ocrLines } from "./receipt_rules"
import { Policy, PolicyItem, PolicyKind } from "./types"

export type ParsedPolicy = Omit<Policy, "file"> & { vin: string | null; sign_ts: number | null }

const BJ_OFFSET = 8 * 3600e3
const DAY = 86400e3
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (s: string) => Number(s.replace(/[,\s]/g, ""))
const fmt = (n: number) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")

/** 北京时间某天 0 点 */
const bjDate = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) - BJ_OFFSET

// ---------- 大写金额 ----------

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 壹: 1, 一: 1, 贰: 2, 二: 2, 两: 2, 叁: 3, 三: 3, 肆: 4, 四: 4, 伍: 5, 五: 5, 陆: 6, 六: 6, 柒: 7, 七: 7, 捌: 8, 八: 8, 玖: 9, 九: 9 }
const CN_UNIT: Record<string, number> = { 拾: 10, 十: 10, 佰: 100, 百: 100, 仟: 1000, 千: 1000 }

function cnInteger(s: string): number | null {
  let total = 0
  let section = 0
  let digit = 0
  for (const ch of s) {
    if (ch in CN_DIGIT) digit = CN_DIGIT[ch]
    else if (ch in CN_UNIT) { section += (digit || 1) * CN_UNIT[ch]; digit = 0 }
    else if (ch === "万") { total += (section + digit) * 1e4; section = 0; digit = 0 }
    else if (ch === "亿") { total = (total + section + digit) * 1e8; section = 0; digit = 0 }
    else return null
  }
  return total + section + digit
}

/** 「人民币伍仟零叁拾壹元贰角」→ 5031.2；「叁佰陆拾元整」→ 360；认不出时 null */
export function parseChineseAmount(s: string): number | null {
  const m = /^(?:人民币)?([零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿一二两三四五六七八九十百千]+)元零?(?:([零壹贰叁肆伍陆柒捌玖])角)?零?(?:([零壹贰叁肆伍陆柒捌玖])分)?/.exec(s.trim())
  if (!m) return null
  const int = cnInteger(m[1])
  if (int == null) return null
  return round2(int + (m[2] ? CN_DIGIT[m[2]] / 10 : 0) + (m[3] ? CN_DIGIT[m[3]] / 100 : 0))
}

const CN_AMOUNT = "[零〇壹贰叁肆伍陆柒捌玖拾佰仟万亿]+元[零壹贰叁肆伍陆柒捌玖角分整]*"

// ---------- 保险期间 ----------

const DATE = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g

function datesIn(s: string): Array<[number, number, number]> {
  return [...s.matchAll(DATE)].map(m => [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number])
}

function periodOf(a: [number, number, number], b: [number, number, number], maxDays: number): { start: number; end: number } | null {
  const start = bjDate(...a)
  const end = bjDate(...b) + DAY - 1
  return end > start && end - start <= maxDays * DAY ? { start, end } : null
}

/**
 * 「保险期间 / 保险期限」后 240 字以内的头两个日期；到期一律按当天结束（「23 时 59 分」「24 时」「二十四时」）。
 * 不够时在全文里找相隔约一年的一对日期（交强险第 2 页的标志上也写着期间）
 */
export function parsePeriod(text: string): { start: number; end: number } | null {
  for (const m of text.matchAll(/保险期[间限]/g)) {
    const ds = datesIn(text.slice(m.index!, m.index! + 240))
    if (ds.length >= 2) {
      const p = periodOf(ds[0], ds[1], 400)
      if (p) return p
    }
  }
  const all = datesIn(text)
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const p = periodOf(all[i], all[j], 370)
      if (p && p.end - p.start >= 360 * DAY) return p
    }
  }
  return null
}

// ---------- 保费 ----------

type Premium = { premium: number | null; ex: number | null; tax: number | null; chinese: number | null }

function parsePremium(text: string): Premium {
  const out: Premium = { premium: null, ex: null, tax: null, chinese: null }
  // 人寿：「本合同的保险费为…元，其中不含税价格为…元，增值税额为…元」
  const gl = /本合同的保险费为\s*([\d,]+(?:\.\d+)?)\s*元\s*[,，]?\s*其中不含税价格为\s*([\d,]+(?:\.\d+)?)\s*元\s*[,，]?\s*增值税额为\s*([\d,]+(?:\.\d+)?)\s*元/.exec(text)
  // 平安：「保险费合计: RMB…元（不含税保费:…元，税额:…元）」「（小写）RMB…（不含税保费：…元，税额 ：…元）」
  const pa = /(?:保险费合计\s*[:：]\s*|小写\s*[)）]\s*)RMB\s*([\d,]+(?:\.\d+)?)\s*元?\s*[（(]\s*不含税保费\s*[:：]\s*([\d,]+(?:\.\d+)?)\s*元\s*[,，]\s*税额\s*[:：]\s*([\d,]+(?:\.\d+)?)/.exec(text)
  const m = gl ?? pa
  if (m) {
    out.premium = num(m[1])
    out.ex = num(m[2])
    out.tax = num(m[3])
  } else {
    // 其余：保险费合计后面的第一个金额（人寿车险「（¥: …元）」，意外险「￥CNY…元」）
    const any = /保险费合计[\s\S]{0,100}?(?:¥|￥|RMB|CNY)\s*[:：]?\s*([\d,]+\.\d{1,2})/.exec(text) ?? /总保险费[\s\S]{0,100}?CNY\s*([\d,]+\.\d{1,2})/.exec(text)
    if (any) out.premium = num(any[1])
  }
  // 大写金额：保险费合计后面 160 字以内第一个
  const at = text.search(/保险费合计/)
  if (at >= 0) {
    const cn = new RegExp(CN_AMOUNT).exec(text.slice(at, at + 160))
    if (cn) out.chinese = parseChineseAmount(cn[0])
  }
  return out
}

// ---------- 交强险 ----------

/** 「浮动比率：-10.00%」；扫描件截图识别时「%」离得远、可能读不出，数字在行末也算 */
function parseFloatRate(text: string): number | null {
  const m = /浮动比率\s*[:：]\s*([+\-−]?)\s*(\d+(?:\.\d+)?)\s*(?:[%％]|$)/m.exec(text)
  return m ? (m[1] ? -1 : 1) * Number(m[2]) || 0 : null
}

/**
 * 车船税：「合计（人民币大写）：叁佰陆拾元整」（不是「保险费合计」那一个）；手机上取出的文字里大写金额可能排在标签前面。
 * 都没有时用「当年应缴」后面的金额
 */
function parseVehicleTax(text: string): number | null {
  for (const m of text.matchAll(new RegExp(`合计\\s*[(（]人民币大写[)）]\\s*[:：]\\s*(${CN_AMOUNT})`, "g"))) {
    if (text.slice(Math.max(0, m.index! - 3), m.index!) === "保险费") continue
    const v = parseChineseAmount(m[1])
    if (v != null) return v
  }
  // 大写金额紧挨在「合计」前面（中间只有空白），不会是「保险费合计」的那一个
  const before = new RegExp(`(${CN_AMOUNT})\\s*合计\\s*[(（]人民币大写[)）]`).exec(text)
  if (before) {
    const v = parseChineseAmount(before[1])
    if (v != null) return v
  }
  const due = /当年应缴[^\d]{0,12}([\d,]+\.\d{2})/.exec(text)
  return due ? num(due[1]) : null
}

// ---------- 险种明细（商业险） ----------

const MONEY = /^[\d,]+\.\d{2}$/
const TIMES = /^(\d+)次$/
const isValue = (s: string) => MONEY.test(s) || TIMES.test(s) || /^[—–\-－]+$/.test(s) || s === "/" || /^共享/.test(s) || s === "是" || s === "否" || /^\d+(\.\d+)?%$/.test(s)
const HEADER = /保险金额|责任限额|保险费小计|是否投保不计免赔/

type Name = { name: string; key: string | null }

function toItem(n: Name, vals: string[]): PolicyItem {
  const times = vals.map(v => TIMES.exec(v)).find(Boolean)
  const text = vals.find(v => /^共享/.test(v) || v === "/")
  const amount_text = text ?? (times ? times[0] : "")
  if (n.key && catalogEntry(n.key)?.group === "service") {
    return { key: n.key, name: n.name, amount: null, amount_text, premium: null, times: times ? Number(times[1]) : null }
  }
  const money = vals.filter(v => MONEY.test(v)).map(num)
  // 两个金额：保额、保费；一个金额：只有保费（「不计免赔率险」、共享保额的附加险）
  return {
    key: n.key, name: n.name, amount_text,
    amount: money.length >= 2 ? money[0] : null,
    premium: money.length ? money[money.length - 1] : null,
    times: times ? Number(times[1]) : null,
  }
}

/**
 * 「承保险种」到「保险费合计」之间的明细。名称和数值配对：一般是名称后面跟着它的数值（按行）；
 * 连续几个名称后面才跟一串数值时（2022 年平安的四项服务），数值按列分给这几个名称。
 * 名称断成两行时，认不出统一名称的那一行接到上一个名称后面
 */
export function parseItems(text: string, kind: PolicyKind): PolicyItem[] {
  const start = text.search(/承\s*保\s*险\s*种/)
  const end = start >= 0 ? text.indexOf("保险费合计", start) : -1
  if (start < 0 || end < 0) return []
  const groups: Array<{ names: Name[]; values: string[] }> = []
  for (const raw of text.slice(start, end).split("\n").slice(1)) {
    const line = raw.trim().replace(/(\d)\s+次/g, "$1次")
    if (!line || HEADER.test(line)) continue
    // 行末的数值拆出来，前面的是名称（手机上取出的文字一个险种一行：「机动车损失保险 180000.00 — 3000.00」）
    const parts = line.split(/\s+/)
    let k = parts.length
    while (k > 0 && isValue(parts[k - 1])) k--
    const nameText = parts.slice(0, k).join("")
    const values = parts.slice(k)
    let g = groups[groups.length - 1]
    if (!nameText) {
      if (g) g.values.push(...values)
      continue
    }
    const key = itemKey(nameText, kind)
    const last = g && !g.values.length ? g.names[g.names.length - 1] : null
    if (last && !key) {
      // 名称断成两行：「附加机动车增值服务特约条款代为送检服务」「特约条款 1 次 — —」
      last.name += nameText
      last.key = itemKey(last.name, kind)
    } else {
      if (!g || g.values.length) { g = { names: [], values: [] }; groups.push(g) }
      g.names.push({ name: nameText, key })
    }
    g!.values.push(...values)
  }
  const items: PolicyItem[] = []
  for (const g of groups) {
    const k = g.names.length
    if (k === 1) { items.push(toItem(g.names[0], g.values)); continue }
    const cols = g.values.length % k === 0 ? g.values.length / k : 0
    g.names.forEach((n, i) => items.push(toItem(n, cols ? Array.from({ length: cols }, (_, c) => g.values[c * k + i]) : [])))
  }
  return items
}

// ---------- 其他字段 ----------

/** 标题：平安的搭售保障在「按以下条件承保：」后面；其余取第一行像标题的，去掉监制单位和「（电子保单）」「电子保险单」 */
function parseTitle(text: string): string | null {
  const cond = /按以下条件承保\s*[:：]\s*(.+?)(?=\s|以下|$)/m.exec(text)
  if (cond) return cond[1]
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+/g, "")
    if (/单号|查验/.test(l) || !/保险单|保障$|驾乘险/.test(l)) continue
    const t = l.replace(/^.*监制/, "").replace(/限在\S*?销售/, "").replace(/[（(]电子保单[)）]/, "").replace(/电子保险单$/, "")
    if (t && t.length <= 30) return t
  }
  return null
}

function parseInsurer(text: string): string {
  const m = /(中国[一-龥]{2,6}|[一-龥]{2,6})财产保险(?:股份)?有限公司/.exec(text)
  return m ? m[0] : ""
}

function parsePhone(text: string): string | null {
  // 「服务电话」「客服/投诉热线」「全国统一服务/投诉电话」「报案电话」「受理统一电话」「客服热线」
  const m = /(?:服务|投诉|报案|受理|客服)[^\d\n]{0,8}?(?:电话|热线)[^\d]{0,8}(9\d{4}|400\d{7}|\d{5,8})/.exec(text)
  return m ? m[1] : null
}

const VIN = /^(?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17}$/

/**
 * 车架号：17 位、不含 I O Q、至少一个字母（避开证件号）；前后不能紧挨字母数字（避开更长的保单号、确认码）。
 * 扫描件截图识别时 1、0 可能读成 I、O：只在「车辆识别代码」「车架号」「VIN」后面纠正
 */
function parseVin(text: string): string | null {
  const m = /(?:^|[^A-Z0-9])((?=[A-HJ-NPR-Z0-9]*[A-HJ-NPR-Z])[A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/m.exec(text)
  if (m) return m[1]
  const ocr = /(?:车辆识别代码|车架号|VIN码?)[^A-Z0-9]{0,20}([A-Z0-9]{17})(?![A-Z0-9])/.exec(text)
  const vin = ocr ? ocr[1].replace(/I/g, "1").replace(/[OQ]/g, "0") : ""
  return VIN.test(vin) ? vin : null
}

/** 解析结果 → 保存的保单（file 为保存后的原件相对路径） */
export function toPolicy(p: ParsedPolicy, file: string | null): Policy {
  const { vin: _vin, sign_ts: _sign, ...rest } = p
  return { ...rest, file }
}

/** 保单上的车架号与车辆数据提供方的车（沃尔沃的 VIN）不同时的提示；没有关联提供方或没读出车架号时不提示 */
export function vinWarning(vin: string | null, providerVehicleId: string | null | undefined): string | null {
  if (!vin || !providerVehicleId || !/^[A-HJ-NPR-Z0-9]{17}$/i.test(providerVehicleId)) return null
  return vin.toUpperCase() === providerVehicleId.toUpperCase() ? null : "保单上的车架号与这辆车不符，请确认没有选错车或选错文件"
}

/** 签单日期：标签后 200 字以内的第一个日期（手机上取出的文字里，标签和日期之间可能隔着公司名称、邮编、电话） */
function parseSignTs(text: string): number | null {
  const m = /(?:签单日期|出单日期)[\s\S]{0,200}?(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(text)
  return m ? bjDate(Number(m[1]), Number(m[2]), Number(m[3])) + 12 * 3600e3 : null
}

/**
 * 保单号：「保险单号」「保单号」后 200 字以内第一个以数字开头、19–24 位的号码。
 * 手机上取出的文字里标签挤在一起（「确认码：保险单号：」「保单号：验真码：」），号码排在后面；
 * 确认码以字母开头或长达 30 位，证件号 18 位、车架号 17 位，都不会被当成保单号
 */
function parsePolicyNo(text: string): string {
  for (const m of text.matchAll(/保险?单号/g)) {
    const hit = /(?:^|[^0-9A-Z])([0-9][0-9A-Z]{18,23})(?![0-9A-Z])/.exec(text.slice(m.index! + m[0].length, m.index! + m[0].length + 200))
    if (hit) return hit[1]
  }
  return ""
}

/** PDF 里有没有可读的文字（有的 PDF 用了读不出的字体，手机上取出来是空的） */
export function pdfHasText(pages: string[]): boolean {
  return pages.some(p => p.trim().length > 0)
}

/**
 * 读不出文字的 PDF 截图后，Vision 识别出的文字块 → 一页文字：按位置排成行（与小票相同），再交给 parsePolicyText。
 * Vision 给出的顺序是按列的（名称一列、保额一列、保费一列），排成行后和电脑上取出的文字一样，一个险种一行
 */
export function ocrPageText(blocks: OcrBlock[]): string {
  return ocrLines(blocks).map(l => l.text).join("\n")
}

// ---------- 合起来 ----------

/** 读不出标题和保费时不是保单（例如交强险标志），返回 null */
export function parsePolicyText(pages: string[]): ParsedPolicy | null {
  const text = pages.join("\n").replace(/\r/g, "")
  const title = parseTitle(text)
  const pr = parsePremium(text)
  if (!title && pr.premium == null) return null
  const kind: PolicyKind = title === "机动车交通事故责任强制保险单" ? "compulsory"
    : title && /商业保险保险单$/.test(title) ? "commercial"
      : /意外伤害|驾乘/.test(text) ? "accident" : "other"
  const issues: string[] = []
  const period = parsePeriod(text)
  if (!period) issues.push("没读出保险期间，请填写")
  if (pr.premium == null) issues.push("没读出保险费合计，请填写")
  else if (pr.chinese != null && Math.abs(pr.premium - pr.chinese) > 0.005) issues.push(`保险费 ${fmt(pr.premium)} 与大写金额 ${fmt(pr.chinese)} 不一致，请核对`)
  const items = kind === "commercial" ? parseItems(text, kind) : []
  if (items.length && pr.premium != null) {
    const sum = round2(items.reduce((s, i) => s + (i.premium ?? 0), 0))
    if (Math.abs(sum - pr.premium) > 0.02) issues.push(`各险种保费合计 ${fmt(sum)} 与保险费合计 ${fmt(pr.premium)} 不符，请核对`)
  }
  return {
    kind,
    title: title ?? "",
    insurer: parseInsurer(text),
    policy_no: parsePolicyNo(text),
    start_ts: period?.start ?? 0,
    end_ts: period?.end ?? 0,
    premium: pr.premium ?? 0,
    premium_ex_tax: pr.ex,
    tax: pr.tax,
    float_rate: kind === "compulsory" ? parseFloatRate(text) : null,
    vehicle_tax: kind === "compulsory" ? parseVehicleTax(text) : null,
    phone: parsePhone(text),
    items,
    issues,
    vin: parseVin(text),
    sign_ts: parseSignTs(text),
  }
}
