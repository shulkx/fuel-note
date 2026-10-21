// 保险年度的纯逻辑（设计文档 20.4、20.6 节）。全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  amountOnlyExpenses, composition, currentInsurance, daysLeft, expenseCandidates, expenseFor, insuranceYears, itemCompare, previousInsurance,
  fileCountText, markLook, renewalDue, upgradeYearMarks, yearFiles, yearGaps, yearInsurer, yearLabel, yearMark, yearOf, yearPeriod, yearPhone, yearTotal,
} from "../common/insurance"
import { ExpenseRecord, InsuranceYear, LedgerRecord, Policy, PolicyKind } from "../common/types"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const dayEnd = (s: string) => BJ(`${s}T23:59:59.999`)

function policy(kind: PolicyKind, from: string, to: string, premium: number, extra: Partial<Policy> = {}): Policy {
  return {
    kind, title: "示例保单", insurer: "示例财产保险股份有限公司", policy_no: "0000", start_ts: BJ(`${from}T00:00:00`), end_ts: dayEnd(to),
    premium, premium_ex_tax: null, tax: null, float_rate: null, vehicle_tax: null, phone: null, items: [], file: null, issues: [], ...extra,
  }
}

/** 一年：交强险 + 车船税、商业险、驾乘意外险；起保 y-01-07，到期 (y+1)-01-06 */
function year(id: string, y: number, extra: Partial<InsuranceYear> = {}, commercialFrom = `${y}-01-07`): InsuranceYear {
  return {
    id, vehicle_id: "v1", discount: 0, paid_ts: BJ(`${y - 1}-12-20T10:00:00`), expense_id: null, remark: "",
    policies: [
      policy("compulsory", `${y}-01-07`, `${y + 1}-01-06`, 950, { vehicle_tax: 360, float_rate: -10 }),
      policy("commercial", commercialFrom, `${y + 1}-01-06`, 4000, { insurer: "示例财产保险股份有限公司某市分公司", phone: "95000" }),
      policy("accident", `${y}-01-07`, `${y + 1}-01-06`, 200),
    ],
    ...extra,
  }
}

function expense(id: string, ts: number, amount: number, remark: string, category_id = 100002): ExpenseRecord & LedgerRecord {
  return { kind: "expense", id, vehicle_id: "v1", ts, category_id, amount, remark, origin: "local", pending: false }
}

test("合计 = 各份保费 + 车船税 − 优惠；构成分三段", () => {
  const y = year("a", 2026, { discount: 300 })
  assert.equal(yearTotal(y), 950 + 360 + 4000 + 200 - 300)
  assert.deepEqual(composition(y), { commercial: 4000, compulsory: 1310, other: 200 })
})

test("期间取最早起保到最晚到期；年份按起保年（商业险晚起保也算这一年）", () => {
  const y = year("a", 2023, {}, "2023-02-10")
  assert.deepEqual(yearPeriod(y), { start: BJ("2023-01-07T00:00:00"), end: dayEnd("2024-01-06") })
  assert.equal(yearOf(y), 2023)
  assert.equal(yearInsurer(y), "示例")
  assert.equal(yearLabel(y), "2023 车险 · 示例")
  assert.equal(yearPhone(y), "95000")
  assert.equal(yearPeriod({ ...y, policies: [] }), null)
})

test("排序、当前保单和上一年", () => {
  const all = [year("a", 2024), year("b", 2026), year("c", 2025), { ...year("x", 2026), vehicle_id: "v2" }]
  const ys = insuranceYears(all, "v1")
  assert.deepEqual(ys.map(y => y.id), ["b", "c", "a"])
  assert.equal(currentInsurance(ys, BJ("2026-10-21T12:00:00"))?.id, "b")
  assert.equal(currentInsurance(ys, BJ("2030-01-01T12:00:00")), null)
  assert.equal(previousInsurance(ys, ys[0])?.id, "c")
  assert.equal(previousInsurance(ys, ys[2]), null)
})

test("剩余天数按北京时间的日期算", () => {
  assert.equal(daysLeft(dayEnd("2027-01-06"), BJ("2026-10-21T23:30:00")), 77)
  assert.equal(daysLeft(dayEnd("2027-01-06"), BJ("2027-01-06T08:00:00")), 0)
  assert.equal(daysLeft(dayEnd("2027-01-06"), BJ("2027-01-20T08:00:00")), -14)
})

test("缺的年份；有只记了金额的保险费用落在缺口里时不算缺", () => {
  const ys = insuranceYears([year("a", 2020), year("b", 2022), year("c", 2023), year("d", 2025)], "v1")
  assert.deepEqual(yearGaps(ys, []), [2024, 2021])
  const paidFor2021 = expense("e1", BJ("2020-12-18T10:00:00"), 6000, "2021年示例车险")
  assert.deepEqual(yearGaps(ys, [paidFor2021]), [2024])
})

test("只有金额的保险费用：类别是保险和交通规费、备注里有「险」、还没关联", () => {
  const ys = [year("a", 2022, { expense_id: "e-linked" })]
  const records: LedgerRecord[] = [
    expense("e1", BJ("2020-12-18T10:00:00"), 6000, "2021年示例车险"),
    expense("e2", BJ("2021-03-01T10:00:00"), 300, "年检"),
    expense("e-linked", BJ("2021-12-20T10:00:00"), 5510, "2022 车险 · 示例"),
    expense("e3", BJ("2021-05-01T10:00:00"), 50, "保险丝", 100001),
  ]
  assert.deepEqual(amountOnlyExpenses(records, ys).map(r => r.id), ["e1"])
})

test("候选费用：付款日期前后 45 天、同类别、没关联别的保险，按日期远近排", () => {
  const ys = [year("a", 2022, { expense_id: "e-linked" })]
  const paid = BJ("2021-12-20T10:00:00")
  const records: LedgerRecord[] = [
    expense("far", BJ("2021-09-01T10:00:00"), 5000, "示例车险"),
    expense("near", BJ("2021-11-25T10:00:00"), 5800, "2022年示例车险"),
    expense("nearer", BJ("2021-12-18T10:00:00"), 300, "车船税"),
    expense("e-linked", BJ("2021-12-20T10:00:00"), 5510, "2022 车险 · 示例"),
    expense("other", BJ("2021-12-20T10:00:00"), 80, "停车", 100000),
  ]
  assert.deepEqual(expenseCandidates(records, ys, paid, null).map(r => r.id), ["nearer", "near"])
  // 编辑「a」时，它自己关联的费用也是候选
  assert.deepEqual(expenseCandidates(records, ys, paid, "a").map(r => r.id), ["e-linked", "nearer", "near"])
})

test("续保提醒：到期前 45 天起，到期后 30 天内仍提醒；记了下一年或点过「×」不提醒", () => {
  const ys = insuranceYears([year("a", 2025), year("b", 2026)], "v1")
  assert.equal(renewalDue(ys, BJ("2026-11-21T09:00:00"), []), null)
  assert.deepEqual(renewalDue(ys, BJ("2026-11-22T09:00:00"), []), { year: ys[0], daysLeft: 45 })
  assert.deepEqual(renewalDue(ys, BJ("2027-01-20T09:00:00"), []), { year: ys[0], daysLeft: -14 })
  assert.equal(renewalDue(ys, BJ("2027-02-10T09:00:00"), []), null)
  assert.equal(renewalDue(ys, BJ("2026-12-01T09:00:00"), ["b"]), null)
  const renewed = insuranceYears([...ys, year("c", 2027)], "v1")
  assert.equal(renewalDue(renewed, BJ("2026-12-01T09:00:00"), []), null)
  assert.equal(renewalDue([], BJ("2026-12-01T09:00:00"), []), null)
})

test("按统一名称对上一年：去年的保额、保费、次数", () => {
  const item = (key: string, amount: number | null, premium: number | null, times: number | null = null) =>
    ({ key, name: key, amount, amount_text: "", premium, times })
  const prev = year("a", 2025)
  prev.policies[1].items = [item("damage", 220000, 2400), item("rescue", null, null, 7)]
  const cur = year("b", 2026)
  cur.policies[1].items = [item("damage", 195000, 3700), item("rescue", null, null, 12), item("med_extra", null, 50)]
  const cmp = itemCompare(cur, prev)
  assert.deepEqual(cmp.get("damage"), { amount: 220000, premium: 2400, times: null })
  assert.deepEqual(cmp.get("rescue"), { amount: null, premium: null, times: 7 })
  assert.equal(cmp.get("med_extra"), undefined)
  assert.equal(itemCompare(cur, null).size, 0)
})

test("这一年存着的原件：各份保单和它的标志，再是附件（没认出是保单的 PDF）；计数分 PDF 和图片", () => {
  const y = year("i1", 2025)
  assert.deepEqual(yearFiles(y), [])
  const withFiles: InsuranceYear = {
    ...y,
    policies: [{ ...y.policies[0], file: "insurance/i1/交强险.pdf", mark: "insurance/i1/交强险标志.JPG" }, y.policies[1], { ...y.policies[2], file: "insurance/i1/意外险.pdf" }],
    attachments: ["insurance/i1/其他.pdf"],
  }
  assert.deepEqual(yearFiles(withFiles), ["insurance/i1/交强险.pdf", "insurance/i1/交强险标志.JPG", "insurance/i1/意外险.pdf", "insurance/i1/其他.pdf"])
  assert.equal(fileCountText(yearFiles(withFiles)), "3 份 PDF、1 张图片")
  assert.equal(fileCountText(["a.pdf", "b.PDF"]), "2 份 PDF")
  assert.equal(fileCountText(["a.heic"]), "1 张图片")
})

test("交强险标志徽章：交强险的到期年月（北京时间）；有效、45 天内到期、已到期", () => {
  const end = dayEnd("2027-01-06")
  assert.deepEqual(markLook(end, BJ("2026-10-21T12:00:00")), { year: 2027, month: 1, state: "ok" })
  assert.equal(markLook(end, BJ("2026-11-21T12:00:00")).state, "ok")
  assert.equal(markLook(end, BJ("2026-11-22T12:00:00")).state, "soon")
  assert.equal(markLook(end, BJ("2027-01-06T20:00:00")).state, "soon")
  assert.equal(markLook(end, BJ("2027-01-07T08:00:00")).state, "past")
  const y = year("i1", 2026)
  assert.deepEqual(yearMark(y), { end: dayEnd("2027-01-06"), file: null })
  assert.deepEqual(yearMark({ ...y, policies: [{ ...y.policies[0], mark: "insurance/i1/m.pdf" }, y.policies[1]] }), { end: dayEnd("2027-01-06"), file: "insurance/i1/m.pdf" })
  // 没有交强险时用这一年的到期日，没有标志文件
  assert.deepEqual(yearMark({ ...y, policies: [y.policies[1]] }), { end: dayEnd("2027-01-06"), file: null })
})

test("升级前存进来的标志：交强险 PDF 里的标志页拆出来；附件里整份是标志的挂到交强险上；读不出文字的跳过", async () => {
  const MARK_2025 = "6605000000000000004680\n某A12345\n自2025年01月07日00时00分起至2026年01月06日23时59分止\n示例财产保险股份\n95000"
  const POLICY = "机动车交通事故责任强制保险单（电子保单）\n保险费合计（人民币大写）：玖佰伍拾元整（¥：950.00 元）" + "示例条款。".repeat(80)
  const files: Record<string, string[] | null> = {
    "insurance/a/交强险.pdf": [POLICY, MARK_2025],
    "insurance/b/交强险.pdf": [POLICY],
    "insurance/b/标志.pdf": [MARK_2025],
    "insurance/b/其他.pdf": ["核保：张三"],
    "insurance/c/交强险.pdf": null,
  }
  const extracted: string[] = []
  const io = {
    pages: async (f: string) => files[f] ?? null,
    extract: async (f: string, page: number) => { extracted.push(`${f}#${page}`); return f.replace("交强险.pdf", "交强险标志.pdf") },
  }
  const base = year("a", 2025)
  const withFile = (id: string, attachments?: string[]): InsuranceYear => ({
    ...base, id, policies: [{ ...base.policies[0], file: `insurance/${id}/交强险.pdf` }, base.policies[1]], ...(attachments ? { attachments } : {}),
  })
  const a = await upgradeYearMarks(withFile("a", ["insurance/b/其他.pdf"]), io)
  assert.equal(a?.policies[0].mark, "insurance/a/交强险标志.pdf")
  assert.deepEqual(a?.attachments, ["insurance/b/其他.pdf"])
  assert.deepEqual(extracted, ["insurance/a/交强险.pdf#1"])
  const b = await upgradeYearMarks(withFile("b", ["insurance/b/标志.pdf"]), io)
  assert.equal(b?.policies[0].mark, "insurance/b/标志.pdf")
  assert.equal(b && "attachments" in b, false)
  assert.equal(await upgradeYearMarks(withFile("c"), io), null)
  // 已经有标志的不再动
  assert.equal(await upgradeYearMarks(a!, io), null)
})

test("对应的费用：类别 100002，金额是合计，备注是年份和保险公司", () => {
  const y = year("a", 2026, { remark: "续保送了保养" })
  assert.deepEqual(expenseFor(y), { ts: y.paid_ts, category_id: 100002, amount: 5510, remark: "2026 车险 · 示例\n续保送了保养" })
})

test("显示：北京时间的日期、期间、保额写法、浮动比率、变化", async () => {
  const { amountText, changeText, floatText, periodText, policyDate } = await import("../common/insurance")
  assert.equal(policyDate(BJ("2027-01-06T23:59:59.999")), "2027/1/6")
  assert.equal(periodText({ start: BJ("2026-01-07T00:00:00"), end: dayEnd("2027-01-06") }), "2026/1/7 – 2027/1/6")
  assert.equal(periodText(null), "—")
  assert.deepEqual([amountText(3000000), amountText(250000), amountText(180000.5), amountText(5000)], ["300 万", "25 万", "180,000.50", "5,000.00"])
  assert.deepEqual([floatText(10), floatText(-40), floatText(0)], ["+10%", "−40%", "0%"])
  assert.deepEqual([changeText(1552, 1000), changeText(744, 1000)], ["+55.2%", "−25.6%"])
})
