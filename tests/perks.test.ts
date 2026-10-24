// 权益卡的纯逻辑（权益设计 docs/specs/2026-10-23-benefits-wallet.md）：剩余和状态、按来自分组和到期提醒、续保提醒和「赠送」一行、
// 记费用能用的卡和默认用量（跟着金额走）、导出时的用量写法、费用统计的抵扣（按费用的 id）、同名和编辑检查；门店；识别结果的整理；去掉个人信息。
// 全部是编造的数据。
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  batchInfo, deductOf, deductSummary, defaultUse, doneGroups, endOfDayBJ, expenseUses, followAmount, giftLine, kindText, PerkBook, perkErrors, perkGroups, perkState,
  remaining, renewalGifts, sameName, usablePerks, usageLine,
} from "../common/perks"
import { redactText } from "../common/redact"
import { expenseStoreName, lastStoreFor, storeCandidates } from "../common/stores"
import { emptyLedger, ExpenseRecord, InsuranceYear, LedgerFile, Perk, PerkUse, Policy, Store } from "../common/types"
import { parsePerkScan, scanPicks } from "../readers/perk_llm"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const dayEnd = (s: string) => BJ(`${s}T23:59:59.999`)
const NOW = BJ("2026-10-22T12:00:00")

function policy(kind: Policy["kind"]): Policy {
  return {
    kind, title: "示例保单", insurer: "示例财产保险股份有限公司", policy_no: "0000", start_ts: BJ("2026-01-07T00:00:00"), end_ts: dayEnd("2027-01-06"),
    premium: 1000, premium_ex_tax: null, tax: null, float_rate: null, vehicle_tax: null, phone: null, items: [], file: null, issues: [],
  }
}
const YEAR: InsuranceYear = { id: "y26", vehicle_id: "v1", discount: 0, paid_ts: BJ("2025-12-20T10:00:00"), expense_id: null, remark: "", policies: [policy("compulsory"), policy("commercial")] }
const STORE: Store = { id: "st1", name: "示例沃尔沃", full_name: "示例汽车销售服务有限公司", address: "", phone: "", lng: null, lat: null, source: "manual" }

function perk(id: string, name: string, extra: Partial<Perk>): Perk {
  return {
    id, vehicle_id: "v1", name, kind: "count", total: 1, unit: "次", end_ts: dayEnd("2027-01-06"), store: "示例沃尔沃",
    source: "2026 车险", insurance_id: "y26", origin: "insurance", raw: "", note: "", created_ts: 1, ...extra,
  }
}
const PKG = { source: "示例保养套餐", insurance_id: null, origin: "package" as const, end_ts: dayEnd("2028-09-23"), created_ts: 2 }
const PERKS: Perk[] = [
  perk("fund", "维修保养券", { kind: "balance", total: 1000, unit: "元" }),
  perk("paint", "原厂油漆面", { total: 3, unit: "面" }),
  perk("basic", "基础保养", {}),
  perk("coupon", "基础保养抵用券", { ...PKG, unit: "张" }),
  perk("spray", "原厂喷漆", { ...PKG, unit: "面" }),
  perk("wash", "洗车", { source: "示例洗车卡", insurance_id: null, origin: "other", end_ts: null, store: "", total: 5, created_ts: 3 }),
]

const use = (id: string, perk_id: string, used: number, deduct: number, expense_id: string | null, ts = NOW): PerkUse =>
  ({ id, perk_id, ts, used, deduct, expense_id, note: "" })

function book(uses: PerkUse[] = [], perks = PERKS): PerkBook {
  return { perks, uses, years: [YEAR], stores: [STORE] }
}

test("剩余、状态：用掉的从总量里减去；用完的、过期的不在权益页，在已用完和已过期", () => {
  const b = book([use("u1", "fund", 300, 300, "e1"), use("u2", "basic", 1, 0, null)])
  assert.equal(remaining(b, PERKS[0]), 700)
  assert.equal(perkState(b, PERKS[2], NOW), "used_up")
  assert.equal(perkState(b, PERKS[1], BJ("2027-01-07T00:00:00")), "expired")
  assert.equal(perkState(b, PERKS[5], BJ("2030-01-01T00:00:00")), "active")
  assert.deepEqual(perkGroups(b, "v1", NOW).map(g => g.items.map(i => i.perk.id)), [["fund", "paint"], ["coupon", "spray"], ["wash"]])
  assert.deepEqual(doneGroups(b, "v1", NOW).map(g => [g.title, g.items.map(i => i.perk.id)]), [["2026 车险", ["basic"]]])
})

test("按来自分组：车险的按保险年度、其余按来自的文字；按到期排（不限期的最后）；30 天内到期写「1月6日到期 · N 项未用完」", () => {
  const b = book([use("u1", "fund", 300, 300, "e1")])
  const groups = perkGroups(b, "v1", BJ("2026-12-07T09:00:00"))
  assert.deepEqual(groups.map(g => [g.key, g.title, g.store]), [["ins:y26", "2026 车险", "示例沃尔沃"], ["src:示例保养套餐", "示例保养套餐", "示例沃尔沃"], ["src:示例洗车卡", "示例洗车卡", ""]])
  assert.equal(groups[0].note, "1月6日到期 · 3 项未用完")
  assert.equal(groups[1].note, null)
  assert.equal(perkGroups(book(), "v1", BJ("2026-12-07T09:00:00"))[0].note, "1月6日到期 · 3 项未使用")
  const info = batchInfo(b, "v1", "src:示例保养套餐")
  assert.equal(info?.title, "示例保养套餐")
  assert.equal(info?.end, dayEnd("2028-09-23"))
})

test("续保提醒并进还没用完的赠送；保单详情的「赠送」一行：名称和数量、使用情况；没有赠送时 null", () => {
  assert.equal(renewalGifts(book(), YEAR, BJ("2026-11-25T10:00:00")), "赠送 3 项未使用")
  const used = book([use("u1", "basic", 1, 0, null)])
  assert.equal(renewalGifts(used, YEAR, BJ("2026-11-25T10:00:00")), "赠送 2 项未使用")
  assert.deepEqual(giftLine(book(), YEAR), { key: "ins:y26", names: "维修保养券 ¥1,000 · 原厂油漆面 3 面 · 基础保养", status: "都未使用" })
  assert.equal(giftLine(used, YEAR)?.status, "已用 1 项")
  assert.equal(giftLine(book([], PERKS.filter(p => !p.insurance_id)), YEAR), null)
})

test("记费用能用的卡：不按门店、类别筛，过了有效期、没有剩余的不列；编辑时加回自己用掉的，自己用过的不管别的条件都列出", () => {
  const ts = BJ("2026-10-23T10:00:00")
  const b = book([use("u1", "basic", 1, 0, "e1", ts), use("u2", "fund", 1000, 1000, "e1", ts)])
  assert.deepEqual(usablePerks(b, "v1", ts, null).map(u => u.perk.id), ["paint", "coupon", "spray", "wash"])
  const editing = usablePerks(b, "v1", ts, "e1")
  assert.deepEqual(editing.map(u => [u.perk.id, u.left]), [["fund", 1000], ["paint", 3], ["basic", 1], ["coupon", 1], ["spray", 1], ["wash", 5]])
  // 改了日期到有效期以后：别的过期了，这一笔自己用过的仍然列出
  const late = BJ("2027-02-01T10:00:00")
  assert.deepEqual(usablePerks(b, "v1", late, "e1").map(u => u.perk.id), ["fund", "basic", "coupon", "spray", "wash"])
  // 别的费用用过的不算这一笔的
  assert.deepEqual(usablePerks(b, "v1", ts, "e2").map(u => u.perk.id), ["paint", "coupon", "spray", "wash"])
})

test("只有储值抵钱：取剩余和还没抵扣的金额中较小的；次数（含抵用券）用 1 次、不抵钱；跟着金额走时依次分配，合计不超过金额", () => {
  const [fund, , basic, coupon] = PERKS
  assert.deepEqual(defaultUse(fund, 1000, 380), { perk_id: "fund", used: 380, deduct: 380 })
  assert.deepEqual(defaultUse(fund, 300, null), { perk_id: "fund", used: 300, deduct: 300 })
  assert.deepEqual(defaultUse(fund, 300, 0), { perk_id: "fund", used: 0, deduct: 0 })
  assert.deepEqual(defaultUse(coupon, 1, 2000), { perk_id: "coupon", used: 1, deduct: 0 })
  assert.deepEqual(defaultUse(basic, 1, 2000), { perk_id: "basic", used: 1, deduct: 0 })
  assert.deepEqual([deductOf(fund, 120), deductOf(coupon, 1)], [120, 0])
  assert.deepEqual([kindText(fund), kindText(coupon), kindText(basic)], ["储值", "次数", "次数"])
  const fund2: Perk = { ...fund, id: "fund2", name: "保养基金", total: 500 }
  const usable = [{ perk: fund, left: 300 }, { perk: fund2, left: 500 }, { perk: coupon, left: 1 }]
  const uses = [{ perk_id: "fund", used: 300, deduct: 300 }, { perk_id: "fund2", used: 500, deduct: 500 }, { perk_id: "coupon", used: 1, deduct: 0 }]
  assert.deepEqual(followAmount(uses, ["fund", "fund2"], usable, 600), [uses[0], { perk_id: "fund2", used: 300, deduct: 300 }, uses[2]])
  assert.deepEqual(followAmount(uses, ["fund2"], usable, 600), [uses[0], { perk_id: "fund2", used: 300, deduct: 300 }, uses[2]])
  assert.deepEqual(followAmount(uses, ["fund", "fund2"], usable, 200), [{ perk_id: "fund", used: 200, deduct: 200 }, { perk_id: "fund2", used: 0, deduct: 0 }, uses[2]])
  assert.deepEqual(followAmount(uses, ["fund"], usable, null), uses)
  assert.deepEqual(followAmount(uses, [], usable, 100), uses)
})

test("导出到小熊时备注最后一行的写法：用了什么和门店；都没有时为空。一笔费用用掉的卡按费用的 id 找", () => {
  const uses = [{ perk_id: "fund", used: 1000, deduct: 1000 }, { perk_id: "basic", used: 1, deduct: 0 }]
  assert.equal(usageLine(PERKS, uses, "示例沃尔沃"), "维修保养券抵扣 ¥1,000.00 · 基础保养 1 次 · 示例沃尔沃")
  assert.equal(usageLine(PERKS, [{ perk_id: "gone", used: 1, deduct: 0 }], null), "")
  const b = book([use("u1", "fund", 800, 800, "e1"), use("u2", "basic", 1, 0, "e1"), use("u3", "paint", 1, 0, "e2"), use("u4", "wash", 1, 0, null)])
  assert.deepEqual(expenseUses(b, "v1", "e1").map(u => u.id), ["u1", "u2"])
  assert.deepEqual(expenseUses(b, "v2", "e1"), [], "别的车的卡不算")
})

test("费用统计的权益抵扣：只算记在现存费用上的，时间取费用的", () => {
  const t1 = BJ("2026-10-23T10:00:00")
  const t2 = BJ("2026-11-01T10:00:00")
  const b = book([use("u1", "fund", 800, 800, "e1"), use("u2", "fund", 200, 200, "e2"), use("u3", "basic", 1, 0, "e1"), use("u4", "fund", 0, 0, null)])
  assert.deepEqual(deductSummary(b, "v1", new Map([["e1", t1]]), 0), { total: 800, count: 1 })
  const both = new Map([["e1", t1], ["e2", t2]])
  assert.deepEqual(deductSummary(b, "v1", both, 0), { total: 1000, count: 2 })
  assert.deepEqual(deductSummary(b, "v1", both, BJ("2026-10-25T00:00:00")), { total: 200, count: 1 })
  assert.deepEqual(deductSummary(b, "v1", both, 0, BJ("2026-10-25T00:00:00")), { total: 800, count: 1 })
})

test("同名检查只看同一来自；编辑检查：名称、总量必填，用过的不能改类型，改总量时不能少于已用", () => {
  assert.equal(sameName(book(), "v1", "ins:y26", "基础 保养")?.id, "basic")
  assert.equal(sameName(book(), "v1", "ins:y26", "基础保养", "basic"), null)
  assert.equal(sameName(book(), "v1", "src:示例保养套餐", "基础保养"), null)
  const fund = PERKS[0]
  assert.deepEqual(perkErrors({ ...fund, name: " " }, null, 0), ["请填名称。"])
  assert.deepEqual(perkErrors({ ...PERKS[3], total: 0 }, null, 0), ["请填次数。"])
  assert.deepEqual(perkErrors({ ...fund, kind: "count", unit: "次" }, fund, 300), ["已经用过，不能更改类型。"])
  assert.deepEqual(perkErrors({ ...fund, total: 200 }, fund, 300), ["已用 ¥300.00，总量不能少于已用。"])
  assert.deepEqual(perkErrors({ ...fund, name: "保养券", note: "说明" }, fund, 300), [])
  assert.deepEqual(perkErrors({ ...fund, kind: "count", unit: "次" }, fund, 0), [])
})

test("有效期至：北京时间那一天的最后一毫秒", () => {
  assert.equal(endOfDayBJ(BJ("2028-09-23T08:30:00")), dayEnd("2028-09-23"))
  assert.equal(endOfDayBJ(BJ("2028-09-23T00:00:00")), dayEnd("2028-09-23"))
})

test("门店只看费用的 store_id，不从备注认店名：我的门店按最近用过的排、默认这一类上次用的、列表第二行的店名", () => {
  const WASH_STORE: Store = { ...STORE, id: "st2", name: "示例洗车店" }
  const rec = (id: string, ts: string, category_id: number, remark: string, store_id?: string): ExpenseRecord =>
    ({ kind: "expense", id, vehicle_id: "v1", ts: BJ(`${ts}T10:00:00`), category_id, amount: 100, remark, ...(store_id ? { store_id } : {}) })
  const records = [
    rec("e4", "2022-05-01", 100001, "第四次保养", "st1"),
    rec("e3", "2022-03-04", 1646374903, "洗车\n示例车体精细护理"),
    rec("e2", "2021-12-10", 1646374903, "速釉", "st2"),
    rec("e1", "2021-10-08", 1646374903, "上蜡", "st2"),
  ]
  const c = storeCandidates([WASH_STORE, STORE, { ...STORE, id: "st3", name: "没用过的店" }], records)
  assert.deepEqual(c.map(x => [x.store.name, x.count]), [["示例沃尔沃", 1], ["示例洗车店", 2], ["没用过的店", 0]])
  assert.equal(lastStoreFor(records, 1646374903, [STORE, WASH_STORE]), WASH_STORE, "备注里写的店名不算，取最近一笔有门店的")
  assert.equal(lastStoreFor(records, 100002, [STORE, WASH_STORE]), null)
  assert.equal(expenseStoreName([STORE], records[0]), "示例沃尔沃")
  assert.equal(expenseStoreName([STORE], records[1]), null, "备注最后一行不当店名")
  assert.equal(expenseStoreName([], records[0]), null, "门店删掉了")
})

test("识别结果：两种接口的结果整理成一样的；只有储值和次数（旧的抵用券按次数），不带面值和价值；名称为空、金额不对的去掉；次数不填按 1；保单自带的服务和已有的同名默认不勾", () => {
  const scan = parsePerkScan({
    source: null, end_date: "2027-01-06", end_text: "跟随保险", store: "本店", note: null,
    items: [
      { name: "维修保养券", kind: "balance", total: 800, unit: "元", face_value: null, value: null, note: null, policy_service: false },
      { name: "原厂油漆面", kind: "count", total: 3, unit: "面" },
      { name: "基础保养", kind: "count" },
      { name: "基础保养抵用券", kind: "voucher", total: 1, unit: "张", face_value: 350, value: 350 },
      { name: "代驾", kind: "count", total: 1, policy_service: false },
      { name: "道路救援", kind: "count", total: 12, policy_service: true },
      { name: "", kind: "count", total: 1 },
      { name: "没写金额的券", kind: "balance", total: null },
    ],
  })
  assert.deepEqual(scan.items.map(i => [i.name, i.kind, i.total, i.unit, i.policy_service]), [
    ["维修保养券", "balance", 800, "元", false], ["原厂油漆面", "count", 3, "面", false], ["基础保养", "count", 1, "次", false],
    ["基础保养抵用券", "count", 1, "张", false], ["代驾", "count", 1, "次", true], ["道路救援", "count", 12, "次", true],
  ])
  assert.ok(scan.items.every(i => !("face_value" in i) && !("value" in i)))
  assert.equal(scan.end_date, "2027-01-06")
  assert.equal(scan.store, "本店")
  const picks = scanPicks(scan, ["基础保养"])
  assert.deepEqual(picks.map(p => [p.name, p.on, p.warn]), [
    ["维修保养券", true, ""], ["原厂油漆面", true, ""], ["基础保养", false, "已有，可能重复"], ["基础保养抵用券", true, ""],
    ["代驾", false, "保单自带的服务，在保单详情里"], ["道路救援", false, "保单自带的服务，在保单详情里"],
  ])
  assert.deepEqual(parsePerkScan(null), { source: "", end_date: null, end_text: "", store: "", price: null, items: [], note: "" })
  // 套餐：名称、售价（字符串也认，0 不算）
  const pkg = parsePerkScan({ source: "示例保养套餐", price: "168", end_date: "2028-09-23", items: [{ name: "原厂喷漆", kind: "count", total: 1, unit: "面" }] })
  assert.deepEqual([pkg.source, pkg.price, pkg.end_date], ["示例保养套餐", 168, "2028-09-23"])
  assert.equal(parsePerkScan({ price: 0, items: [] }).price, null)
})

test("发给大模型前去掉手机号、座机、证件号、车牌和车架号", () => {
  const text = "联系人 13912345678，座机 021-12345678，身份证 11010119900101123X，车牌沪A12345，车架号 LVSHCAMB8CE000001。赠送维修保养券800元"
  assert.equal(redactText(text), "联系人 [手机号]，座机 [电话]，身份证 [证件号]，车牌[车牌]，车架号 [车架号]。赠送维修保养券800元")
  assert.equal(redactText("2026年保险：赠送维修保养券800元 额外赠送3个油漆面"), "2026年保险：赠送维修保养券800元 额外赠送3个油漆面")
})
