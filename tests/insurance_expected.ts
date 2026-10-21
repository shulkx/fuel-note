// 用户保单的期望值（XXYH_ROOT/out/insurance/expected.json）和逐项比较。
// 电脑上的真实数据测试（tests/policy_text.test.ts）和手机上的自动检查（tools/device_check.ts）共用。
import { markMatch, ParsedMark, ParsedPolicy } from "../common/policy_text"

const BJ = (s: string) => Date.parse(`${s}+08:00`)

export type Expected = {
  not_policy?: boolean; pdfkit_no_text?: boolean; kind: string; title: string; insurer: string; policy_no_tail: string; policy_no_len: number; start: string; end: string; sign: string
  premium: number; premium_ex_tax: number | null; tax: number | null; float_rate: number | null; vehicle_tax: number | null; phone: string
  items: Array<{ key: string; amount: number | null; premium: number | null; times: number | null }> | null
  /** 单独的交强险标志文件：保单号后 4 位、长度、期间；mark_page：交强险保单里第几页是标志（从 1 数） */
  mark?: { policy_no_tail: string; policy_no_len: number; start: string; end: string }
  mark_page?: number
  /** 图片（2026 年的标志 JPG）：只在截图识别的结果里核对 */
  image?: boolean
}

/** 一个文件读出的保单和标志（readPolicyPages、readPolicyFiles 的结果） */
export type ReadResult = { parsed: ParsedPolicy | null; mark: { info: ParsedMark; page: number | null } | null }

/** 标志：单独的标志文件要整份认成标志、号码和期间对得上；保单里有标志页的要认出那一页、与这份保单对得上；其余没有标志 */
export function checkMark(id: string, e: Expected, r: ReadResult, problems: string[]): void {
  if (e.mark) {
    const m = r.mark
    if (!m || m.page !== null) problems.push(`${id}：没认出是整份标志`)
    else if (m.info.policy_no.slice(-4) !== e.mark.policy_no_tail || m.info.policy_no.length !== e.mark.policy_no_len
      || m.info.start_ts !== Date.parse(e.mark.start) || m.info.end_ts !== Date.parse(e.mark.end)) problems.push(`${id}：标志读出 ${JSON.stringify(m.info)}`)
    return
  }
  const want = e.mark_page ? e.mark_page - 1 : null
  if ((r.mark?.page ?? null) !== want) problems.push(`${id}：标志页读出 ${r.mark?.page ?? "没有"}，应为 ${want ?? "没有"}`)
  if (r.mark && r.parsed && markMatch(r.mark.info, r.parsed) !== "no") problems.push(`${id}：标志与这份保单对不上`)
}

/** 读出的和期望值逐项比较，不同的写进 problems */
export function compareExpected(id: string, e: Expected, p: ParsedPolicy, problems: string[]): void {
  const got = {
    kind: p.kind, title: p.title, insurer: p.insurer, tail: p.policy_no.slice(-4), len: p.policy_no.length, start: p.start_ts, end: p.end_ts,
    sign: p.sign_ts, premium: p.premium, premium_ex_tax: p.premium_ex_tax, tax: p.tax, float_rate: p.float_rate, vehicle_tax: p.vehicle_tax, phone: p.phone, issues: p.issues,
  }
  const want = {
    kind: e.kind, title: e.title, insurer: e.insurer, tail: e.policy_no_tail, len: e.policy_no_len, start: Date.parse(e.start), end: Date.parse(e.end),
    sign: BJ(`${e.sign}T12:00:00`), premium: e.premium, premium_ex_tax: e.premium_ex_tax, tax: e.tax, float_rate: e.float_rate, vehicle_tax: e.vehicle_tax, phone: e.phone, issues: [],
  }
  for (const k of Object.keys(want) as Array<keyof typeof want>) {
    if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) problems.push(`${id}：${k} 读出 ${JSON.stringify(got[k])}，应为 ${JSON.stringify(want[k])}`)
  }
  if (e.items) {
    const items = p.items.map(i => ({ key: i.key, amount: i.amount, premium: i.premium, times: i.times }))
    if (JSON.stringify(items) !== JSON.stringify(e.items)) problems.push(`${id}：明细读出 ${JSON.stringify(items)}`)
  }
}
