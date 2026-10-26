// 沃尔沃养修（2.1 设计第 3–9、12 节）：接口返回的整理（providers/volvo_service.ts）、保养项目的整理规则、进店的叫法、记没记、
// 先勾好的权益、找门店、保存和删除（common/service.ts）、卡的有效期起（common/perks.ts）。编造的数据，不联网；车牌、券号是编的。
import { test } from "node:test"
import assert from "node:assert/strict"
import { BJ_OFFSET } from "../common/format"
import { makeAppData, removeRecord } from "../common/ledger"
import { ledgerProblems, normalizeLedger } from "../common/ledger_file"
import { perkBook, perkStart, usablePerks } from "../common/perks"
import {
  putServiceVisit, serviceDraft, serviceOfExpense, serviceStore, serviceVocabulary, settlementOf, settlementRefs, suggestUses, ticketLabel, visitState, visitTitle,
} from "../common/service"
import { emptyLedger, InsuranceYear, LedgerFile, Perk, ServiceTicket, ServiceVisit, Store, Vehicle } from "../common/types"
import {
  classifyLabour, oilGrade, parseDealer, parseTicket, parseVisit, parseVisitList, prefName, volvoAliases, volvoTicketItems, volvoTime,
} from "../providers/volvo_service"
import { volvoCn } from "../providers/volvo_cn"
import { emptyXxyhState } from "../sync/xxyh/types"

const T = (s: string) => volvoTime(s) as number
const DAY = 86400e3
const v1: Vehicle = { id: "v1", name: "示例车", default_grade: 95, created_ts: 0, xxyh_car: null, provider: { id: "volvo_cn", vehicle_id: "VIN1", name: "示例" } }
const naming = volvoCn.serviceNaming!([])

function ticket(p: Partial<ServiceTicket>): ServiceTicket {
  return {
    ro_no: "RO1", type: "保养", created_ts: T("2026-04-03 10:30"), settled_ts: T("2026-04-03 13:40"), projects: ["保养"], labours: [], parts: [],
    total: 0, own: 0, labour_discount: 0, discounts: [], prefs: [], rounding: 0, remark: "", ...p,
  }
}
function visit(p: Partial<ServiceVisit>): ServiceVisit {
  return {
    provider: "volvo_cn", order_id: "NR_X_1", dealer_code: "D01", arrive_ts: T("2026-04-03 10:26"), state: "已评价", settled_ts: T("2026-04-03 13:40"), odometer: 79471,
    dealer: { short: "示例汽车", name: "示例汽车销售服务有限公司", address: "示例路1号", phone: "", lng: 121.4, lat: 31.2, hours: "08:30–17:00" }, tickets: [ticket({})], ...p,
  }
}
const perk = (p: Partial<Perk>): Perk => ({
  id: "p1", vehicle_id: "v1", name: "维修保养券", kind: "balance", total: 1300, unit: "元", end_ts: T("2027-01-06 23:59"), source: "2026 车险",
  insurance_id: "y26", origin: "insurance", raw: "", note: "", created_ts: T("2026-10-20 10:00"), ...p,
})
const year = (id: string, paid: string): InsuranceYear => ({ id, vehicle_id: "v1", policies: [], discount: 0, paid_ts: T(paid), expense_id: null, remark: "" })

// ---------- 接口返回的整理 ----------

test("进店列表：时间按北京时间，新的在前；已取消的标出来；没有工单号或经销商代码的不要", () => {
  const heads = parseVisitList([
    { orderId: "A", dealerCode: "D01", reservationDate: "2024/10/11 12:21", stateName: "已评价" },
    { orderId: "B", dealerCode: "D01", reservationDate: "2026/04/03 10:26", stateName: "已取消" },
    { orderId: "", dealerCode: "D01", reservationDate: "2026/04/04 10:26", stateName: "已评价" },
  ])
  assert.deepEqual(heads.map(h => [h.order_id, h.cancelled]), [["B", true], ["A", false]])
  assert.equal(heads[1].arrive_ts, Date.UTC(2024, 9, 11, 12, 21) - BJ_OFFSET)
})

test("优惠名去掉车牌和券号（券号是 KQ 加 12 位数字）", () => {
  assert.equal(prefName("沪A12B34;优惠名称续保赠送油漆券"), "续保赠送油漆券")
  assert.equal(prefName("12B34;优惠名称销售促销"), "销售促销")
  assert.equal(prefName("KQ2025122200332026忠诚守候养修/保养套餐优惠券-200元"), "2026忠诚守候养修/保养套餐优惠券-200元")
  assert.equal(prefName("KQ20231018001223年秋冬服-55元空调滤材料费抵扣券"), "23年秋冬服-55元空调滤材料费抵扣券")
  assert.equal(prefName("沪A12B34销售赠送保养券"), "销售赠送保养券")
  assert.equal(prefName("上门取车"), "上门取车")
})

test("一张工单的结算：工时优惠、其他减免（不和券重复）、券和活动优惠、抹零按差额（可以是负数）、开单时间取委托单", () => {
  const b = {
    roNo: "RO9", repairTypeName: "保养", balanceTime: "2023-12-04 16:27:39", totalAmount: "5,049.72", ownAmount: "0.0", balanceRemark: " 建议更换小电瓶 ",
    discountList: [{ name: "上门取车", amount: "75" }, { name: "送车上门", amount: "55" }, { name: "工时：更换火花塞", amount: "10" },
      { name: "KQ20231018001223年秋冬服-55元空调滤材料费抵扣券", amount: "55" }, { name: "沪A12B34销售赠送保养券", amount: "1,337" }, { name: "沪A12B34续保赠送补漆券，代金券", amount: "3,517" }],
    roPreferentialVoList: [{ preferentialType: "优惠券", preferentialName: "KQ20231018001223年秋冬服-55元空调滤材料费抵扣券", preferentialAmount: "55.0" },
      { preferentialType: "经销商优惠", preferentialName: "沪A12B34销售赠送保养券", preferentialAmount: "1337.0" },
      { preferentialType: "经销商优惠", preferentialName: "沪A12B34续保赠送补漆券，代金券", preferentialAmount: "3517.0" },
      { preferentialType: "优惠券", preferentialName: "上门取送车抵扣券", preferentialAmount: "0.0" }],
    handRepairProjectList: [{ handRepairProjectName: "机油机滤更换保养套餐", roLabourList: [{ labourName: "工时：原厂维修保养" }, { labourName: "工时：喷漆：左前门" }],
      repairPartList: [{ partName: "材料：沃尔沃全合成机油 0W20 208L" }] }],
  }
  const t = parseTicket(b, new Map([["RO9", T("2023-12-01 11:47")]]))!
  assert.deepEqual([t.type, t.total, t.own, t.labour_discount, t.remark, t.created_ts], ["保养", 5049.72, 0, 10, "建议更换小电瓶", T("2023-12-01 11:47")])
  assert.deepEqual(t.discounts, [{ name: "上门取车", amount: 75 }, { name: "送车上门", amount: 55 }])
  assert.deepEqual(t.prefs.map(p => [p.name, p.type, p.amount]), [["23年秋冬服-55元空调滤材料费抵扣券", "优惠券", 55], ["销售赠送保养券", "经销商优惠", 1337], ["续保赠送补漆券，代金券", "经销商优惠", 3517]])
  assert.equal(t.rounding, 0.72)
  assert.deepEqual([t.labours, t.parts], [["原厂维修保养", "喷漆：左前门"], ["沃尔沃全合成机油 0W20 208L"]])
  const up = parseTicket({ roNo: "R2", repairTypeName: "机电维修", balanceTime: "2023-04-25 09:07:09", totalAmount: "1,495.43", ownAmount: "1467.0",
    discountList: [{ name: "工时：更换蒸发排放阀", amount: "28.8" }] }, new Map())!
  assert.equal(up.rounding, -0.37, "自付比原价减去优惠还多：向上取整")
  assert.equal(up.created_ts, up.settled_ts, "没有委托单时开单时间用结算时间")
})

test("一次进店：经销商坐标换成 WGS-84，到店里程取委托单最大的，最后结算时间；没结算时没有工单", () => {
  const head = { order_id: "NR_X_1", dealer_code: "D01", arrive_ts: T("2024-10-11 12:21"), state: "已评价", cancelled: false }
  const v = parseVisit(head, { dealerInfo: { companyShortNameCn: "示例汽车", companyNameCn: "示例汽车销售服务有限公司", addressZh: "示例路1号", phone: "021-0", longitude: "121.4633", latitude: "31.1903", openTime: "08:30", closeTime: "17:00" } },
    [{ roNo: "R1", roCreateDate: "2024-10-11 15:59:25", inMileage: "58052KM" }, { roNo: "R2", roCreateDate: "2024-10-11 12:21:20", inMileage: "58000KM" }],
    [{ roNo: "R1", repairTypeName: "保养", balanceTime: "2024-10-15 15:36:58", totalAmount: "100", ownAmount: "100" },
      { roNo: "R2", repairTypeName: "事故", balanceTime: "2024-10-15 15:41:31", totalAmount: "0", ownAmount: "0" }])
  assert.deepEqual([v.odometer, v.settled_ts, v.tickets.map(t => t.ro_no), v.dealer!.hours], [58052, T("2024-10-15 15:41:31"), ["R2", "R1"], "08:30–17:00"])
  assert.ok(Math.abs(v.dealer!.lng! - 121.4633) > 0.001 && Math.abs(v.dealer!.lng! - 121.4633) < 0.01, "GCJ-02 换成 WGS-84")
  assert.deepEqual([parseVisit(head, {}, [], []).tickets, parseVisit(head, {}, [], []).settled_ts, parseVisit(head, {}, [], []).dealer], [[], null, null])
  assert.equal(parseDealer({ companyNameCn: "只有全称" })!.short, "只有全称")
})

// ---------- 保养项目（设计第 5 节） ----------

test("项目整理：不记的、写进备注的、原厂基础保养 = 机油 <标号> + 机油滤清器、去掉「更换」、斜杠取主名、服务关怀、括号照原样、去重", () => {
  const aliases = volvoAliases(["工时：更换空调滤芯/乘客室空气滤清器/花粉滤", "更换刹车油/制动液"])
  const c = (l: string, parts: string[] = []) => classifyLabour(l, parts, aliases)
  assert.deepEqual([c("提供底漆照片"), c("交运沃尔沃免费检查（价值360元）"), c("车辆健康检查工时")], [{ kind: "skip" }, { kind: "skip" }, { kind: "skip" }])
  assert.deepEqual(c("客户反映：急加速，右后有异响，请检查"), { kind: "note", text: "客户反映：急加速，右后有异响，请检查" })
  assert.deepEqual(c("工时：检查空调不制冷"), { kind: "note", text: "检查空调不制冷" })
  assert.deepEqual(c("喷漆：左前门，左后门"), { kind: "note", text: "喷漆：左前门，左后门" })
  assert.deepEqual(c("原厂基础保养", ["机油滤芯", "沃尔沃全合成机油 5W30 208L"]), { kind: "items", items: ["机油 5W30", "机油滤清器"] })
  assert.deepEqual(c("原厂维修保养", ["OIL 0W/20 208L"]), { kind: "items", items: ["机油 0W20", "机油滤清器"] })
  assert.deepEqual(c("原厂基础保养", ["机油滤芯"]), { kind: "items", items: ["机油", "机油滤清器"] })
  assert.deepEqual(c("服务关怀-车内杀菌"), { kind: "items", items: ["车内杀菌"] })
  assert.deepEqual(c("更换燃油滤清器/汽滤"), { kind: "items", items: ["燃油滤清器"] })
  assert.deepEqual(c("更换乘客室空气滤清器"), { kind: "items", items: ["空调滤芯"] }, "别名按别的工单里的斜杠统一成主名")
  assert.deepEqual(c("更换制动衬片（后2个）"), { kind: "items", items: ["制动衬片（后2个）"] })
  assert.equal(oilGrade(["火花塞套件"]), "")
})

test("一张工单：只有保养工单出项目；第二行是来自哪个工时；只有基础保养的工单标出来", () => {
  const basic = ticket({ labours: ["提供底漆照片", "车辆健康检查工时", "原厂基础保养"], parts: ["OIL 0W/20 208L"] })
  assert.deepEqual(naming(basic), { items: [{ name: "机油 0W20", labour: "原厂基础保养" }, { name: "机油滤清器", labour: "原厂基础保养" }], notes: [], basic_only: true })
  const more = naming(ticket({ labours: ["检查空调不制冷", "更换火花塞", "更换火花塞", "更换燃油滤清器/汽滤"] }))
  assert.deepEqual([more.items.map(i => i.name), more.notes, more.basic_only], [["火花塞", "燃油滤清器"], ["检查空调不制冷"], false])
  assert.deepEqual(volvoTicketItems(ticket({ type: "事故", labours: ["喷漆：前保"] }), new Map()), { items: [], notes: [], basic_only: false })
})

// ---------- 叫法、记没记 ----------

test("进店的叫法：保养在前；补漆、维修、零售照规则；自付为 0 的保修、事故不写，全是这种时才写", () => {
  assert.equal(ticketLabel(ticket({ type: "机电维修", projects: ["划痕补漆平安电销X1"] })), "补漆")
  assert.equal(ticketLabel(ticket({ type: "零售", projects: ["其他"] })), "补漆")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "事故", own: 300, projects: ["划痕补漆X2"] }), ticket({ type: "事故", own: 0 }), ticket({})] })), "保养 · 补漆")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "机电维修", own: 813, projects: ["延保"] }), ticket({})] })), "保养 · 维修")
  assert.equal(visitTitle(visit({ tickets: [ticket({ type: "保修", own: 0 })] })), "保修")
})

test("记没记：没结算；之前手动记的（进店那天到结算后 3 天）；记下的；记下的记录不算别的进店的", () => {
  const v = visit({})
  const base: LedgerFile = { ...emptyLedger(), vehicles: [v1] }
  assert.deepEqual(visitState(base, "v1", { ...v, tickets: [], settled_ts: null }), { kind: "unsettled" })
  assert.deepEqual(visitState(base, "v1", v), { kind: "todo" })
  const manual: LedgerFile = { ...base, records: [{ kind: "expense", id: "e9", vehicle_id: "v1", ts: v.settled_ts! + 3 * DAY, category_id: 100001, amount: 120, remark: "" }] }
  assert.deepEqual(visitState(manual, "v1", v), { kind: "recorded", amount: 120, open: "e9", linked: false })
  const late = { ...manual, records: [{ ...manual.records[0], ts: v.settled_ts! + 5 * DAY }] }
  assert.deepEqual(visitState(late, "v1", v), { kind: "todo" })
  const fuelOnly = { ...base, records: [{ ...manual.records[0], category_id: 100000 }] }
  assert.deepEqual(visitState(fuelOnly as LedgerFile, "v1", v), { kind: "todo" }, "行车费不算")
  const saved = putServiceVisit(makeAppData(base, emptyXxyhState()), v1, v, {
    main: { expense: { ts: v.arrive_ts, category_id: 100001, amount: 0, remark: "" }, uses: [], store: null, maintenance: null }, others: [],
  }).ledger
  const st = visitState(saved, "v1", v)
  assert.equal(st.kind === "recorded" && st.linked, true)
  const neighbor = visit({ order_id: "NR_X_2", arrive_ts: v.arrive_ts + DAY, settled_ts: v.settled_ts! + DAY })
  assert.deepEqual(visitState(saved, "v1", neighbor), { kind: "todo" }, "记下的养修记成的费用不让旁边的进店算成已记")
})

// ---------- 卡的有效期起、先勾好的权益 ----------

test("有效期起：车险赠送从那一年保险的购买日（当天）起；写了 start_ts 用它；其余从添加那天起。只列进店那天有效的卡", () => {
  const book = { perks: [perk({}), perk({ id: "p2", insurance_id: null, origin: "other", source: "购车赠送", name: "基础保养", kind: "count", total: 6, unit: "张", end_ts: null, start_ts: T("2020-01-02 00:00") }),
    perk({ id: "p3", insurance_id: null, origin: "package", source: "套餐", name: "原厂喷漆", kind: "count", total: 1, unit: "面", end_ts: null, created_ts: T("2019-11-30 20:00") })],
  uses: [], years: [year("y26", "2025-12-23 15:44")], stores: [] }
  assert.equal(perkStart(book, book.perks[0]), T("2025-12-23 00:00"))
  assert.equal(perkStart(book, book.perks[2]), T("2019-11-30 00:00"))
  const ids = (ts: number) => usablePerks(book, "v1", ts, null).map(u => u.perk.id).sort()
  assert.deepEqual(ids(T("2025-12-23 09:00")), ["p1", "p2", "p3"], "买保险那天早上的保养也能用")
  assert.deepEqual(ids(T("2025-07-03 09:00")), ["p2", "p3"], "历史的养修不列下一期的车险赠送")
  assert.deepEqual(ids(T("2019-12-01 09:00")), ["p3"])
})

test("先勾好：「续保」配车险赠送的储值卡、只有基础保养的工单配基础保养、补漆 X<n> 配油漆面 n 个；对得上的不止一张时不勾；同一张卡不重复勾", () => {
  const perks = [perk({}), perk({ id: "b26", name: "基础保养", kind: "count", total: 1, unit: "次" }), perk({ id: "o26", name: "油漆面", kind: "count", total: 3, unit: "面" })]
  const book = { perks, uses: [], years: [year("y26", "2025-12-23 15:44")], stores: [] }
  const ts = T("2026-04-03 10:26")
  const basic = ticket({ labours: ["提供底漆照片", "原厂基础保养"], prefs: [{ name: "销售促销", type: "会员权益", amount: 1397 }] })
  const other = ticket({ ro_no: "R2", labours: ["更换火花塞"], prefs: [{ name: "2026忠诚守候养修/保养套餐优惠券-200元", type: "优惠券", amount: 200 }, { name: "续保代金券", type: "会员权益", amount: 1297 }] })
  assert.deepEqual(suggestUses(book, "v1", ts, [basic, other], naming), [{ perk_id: "b26", used: 1, deduct: 0 }, { perk_id: "p1", used: 1297, deduct: 1297 }])
  const paint = ticket({ type: "零售", projects: ["划痕补漆续保赠送X3"], prefs: [{ name: "续保赠送油漆面", type: "预付费抵扣", amount: 3000 }] })
  assert.deepEqual(suggestUses(book, "v1", ts, [paint], naming), [{ perk_id: "o26", used: 3, deduct: 0 }], "储值卡剩 1300 不够 3000，不勾")
  const two = { ...book, perks: [...perks, perk({ id: "o26b", name: "驾乘险油漆面", kind: "count", total: 2, unit: "面" })] }
  assert.deepEqual(suggestUses(two, "v1", ts, [ticket({ type: "事故", projects: ["划痕补漆X2"] })], naming), [], "两张油漆面卡都够：不勾")
  const taken = new Map<string, number>()
  suggestUses(book, "v1", ts, [basic], naming, taken)
  assert.deepEqual(suggestUses(book, "v1", ts, [basic], naming, taken), [], "基础保养只剩 1 次，已经勾给了别的工单")
  assert.deepEqual(suggestUses(book, "v1", T("2025-07-03 09:00"), [basic, other], naming), [], "那一期没有车险赠送的卡")
})

// ---------- 找门店 ----------

test("找门店：先找经销商代码；没有时按名称（简称或全称）或 300 米内找，标橙；都没有时不选", () => {
  const s = (p: Partial<Store>): Store => ({ id: "s1", name: "示例汽车销售服务有限公司", full_name: "示例汽车销售服务有限公司", address: "", phone: "", hours: "", poi_id: "B1", lng: 121.4, lat: 31.2, dealer: null, ...p })
  const v = visit({})
  assert.deepEqual(serviceStore([s({ id: "a", name: "别的", full_name: "", lng: 0, lat: 0 }), s({ id: "b", name: "我的店", dealer: { provider: "volvo_cn", code: "D01" } })], v), { store: s({ id: "b", name: "我的店", dealer: { provider: "volvo_cn", code: "D01" } }), pending: false })
  assert.equal(serviceStore([s({})], v).pending, true)
  assert.equal(serviceStore([s({ name: "改过的名字", full_name: "", lng: 121.4015, lat: 31.2 })], v).store?.id, "s1", "坐标在 300 米内")
  assert.deepEqual(serviceStore([s({ name: "远处", full_name: "", lng: 121.5, lat: 31.3 })], v), { store: null, pending: false })
  assert.deepEqual(serviceStore([s({ dealer: { provider: "volvo_cn", code: "D99" } })], v), { store: null, pending: false }, "已经是别的经销商的门店不用")
})

// ---------- 表单内容、保存、删除 ----------

const visit1011 = () => visit({
  order_id: "NR_X_3", arrive_ts: T("2024-10-11 12:21"), settled_ts: T("2024-10-15 15:41"), odometer: 58052,
  tickets: [
    ticket({ ro_no: "RA", type: "事故", created_ts: T("2024-10-11 12:21"), projects: ["划痕补漆赠送X1"], own: 0, total: 120, discounts: [{ name: "上门取车", amount: 60 }, { name: "送车上门", amount: 60 }] }),
    ticket({ ro_no: "RB", type: "事故", created_ts: T("2024-10-11 15:55"), projects: ["划痕补漆续保赠送X2"], own: 300, total: 2300, prefs: [{ name: "续保赠送油漆券", type: "预付费抵扣", amount: 2000 }] }),
    ticket({ ro_no: "RC", created_ts: T("2024-10-11 15:59"), labours: ["原厂基础保养"], parts: ["沃尔沃全合成机油 0W20 208L"], own: 380, total: 1337.22, prefs: [{ name: "人寿电销基础保养", type: "预付费抵扣", amount: 957 }], rounding: 0.22, remark: "保养人寿赠送基础保养" }),
  ],
})

test("从养修填写：保养工单一笔（进店时间、到店里程、项目、实付自付为 0 才填 0）；其他工单各一笔（开单时间、备注写项目和优惠）；门店按经销商找到", () => {
  const v = visit1011()
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v1], insurance: [year("y24", "2023-12-01 19:03")],
    stores: [{ id: "s1", name: "示例汽车销售服务有限公司", full_name: "示例汽车销售服务有限公司", address: "", phone: "", hours: "", poi_id: "B1", lng: 121.4, lat: 31.2, dealer: null }],
    perks: [perk({ id: "b24", name: "基础保养", kind: "count", total: 1, unit: "次", insurance_id: "y24", source: "2024 车险", end_ts: T("2025-01-06 23:59") })] }
  const d = serviceDraft(ledger, perkBook(ledger), v1, v, naming)
  assert.deepEqual([d.main.tickets.map(t => t.ro_no), d.main.ts, d.main.odometer, d.main.items.map(i => i.name), d.main.amount, d.main.own], [["RC"], v.arrive_ts, 58052, ["机油 0W20", "机油滤清器"], null, 380])
  assert.deepEqual(d.main.uses, [{ perk_id: "b24", used: 1, deduct: 0 }])
  assert.deepEqual(d.others.map(o => [o.ticket.ro_no, o.ts, o.amount, o.remark]), [
    ["RA", T("2024-10-11 12:21"), 0, "划痕补漆赠送X1"], ["RB", T("2024-10-11 15:55"), null, "划痕补漆续保赠送X2 · 续保赠送油漆券 ¥2,000.00"]])
  assert.deepEqual([d.store?.id, d.storePending], ["s1", true])
  const noMaint = serviceDraft(ledger, perkBook(ledger), v1, visit({ tickets: [ticket({ ro_no: "Z1", type: "事故", projects: ["前部事故"] }), ticket({ ro_no: "Z2", type: "零售", projects: ["划痕补漆X3"] })] }), naming)
  assert.deepEqual([noMaint.main.tickets.map(t => t.ro_no), noMaint.main.odometer, noMaint.main.items, noMaint.main.remark], [["Z1"], null, [], "前部事故"])
})

test("保存：保养记录和费用、另记的费用（关掉的不记）、权益记在各自的费用上、门店写进经销商代码、结算原样存进账本；删到一张不剩时回到没记", () => {
  const v = visit1011()
  const store: Store = { id: "s1", name: "示例汽车销售服务有限公司", full_name: "", address: "", phone: "", hours: "", poi_id: "B1", lng: 121.4, lat: 31.2, dealer: null }
  const ledger: LedgerFile = { ...emptyLedger(), vehicles: [v1], stores: [store], perks: [perk({ id: "o", name: "油漆面", kind: "count", total: 2, unit: "面", insurance_id: null, origin: "other", end_ts: null })] }
  const c = putServiceVisit(makeAppData(ledger, emptyXxyhState()), v1, v, {
    main: { expense: { ts: v.arrive_ts, category_id: 100001, amount: 0, remark: "" }, uses: [], store, maintenance: { odometer: 58052, items: ["机油 0W20", "机油滤清器"], remark: "" } },
    others: [{ ro_no: "RA", expense: null, uses: [] }, { ro_no: "RB", expense: { ts: T("2024-10-11 15:55"), category_id: 100001, amount: 300, remark: "划痕补漆" }, uses: [{ perk_id: "o", used: 2, deduct: 0 }] }],
  })
  const l = c.ledger
  const exps = l.records.filter(r => r.kind === "expense")
  assert.deepEqual(exps.map(e => [e.amount, e.kind === "expense" ? e.store_id : null]), [[0, "s1"], [300, "s1"]])
  assert.equal(l.records.filter(r => r.kind === "maintenance").length, 1)
  assert.deepEqual(l.perk_uses.map(u => [u.perk_id, u.used, u.expense_id]), [["o", 2, exps[1].id]])
  assert.deepEqual(l.stores[0].dealer, { provider: "volvo_cn", code: "D01" })
  const rec = l.service_records[0]
  assert.deepEqual(rec.tickets.map(t => [t.ro_no, t.record_id]), [["RA", null], ["RB", exps[1].id], ["RC", exps[0].id]])
  assert.deepEqual(ledgerProblems(l), [])
  assert.deepEqual(serviceOfExpense(l, exps[0].id)!.tickets.map(t => t.ro_no), ["RC"])
  // 再记一次同一次进店：换掉原来那条，不重复
  const again = putServiceVisit(makeAppData(l, emptyXxyhState()), v1, v, { main: { expense: { ts: v.arrive_ts, category_id: 100001, amount: 0, remark: "" }, uses: [], store: null, maintenance: null }, others: [] }).ledger
  assert.equal(again.service_records.length, 1)
  // 删掉保养那笔：补漆还在，仍算记过；再删补漆：回到没记
  const d1 = removeRecord(makeAppData(l, emptyXxyhState()), exps[0]).ledger
  assert.deepEqual(d1.service_records[0].tickets.map(t => t.record_id), [null, exps[1].id, null])
  const d2 = removeRecord(makeAppData(d1, emptyXxyhState()), exps[1]).ledger
  assert.deepEqual(d2.service_records, [])
  assert.deepEqual(visitState(d2, "v1", v), { kind: "todo" })
})

test("结算合在一起、使用权益页的对照（旧工单列项目名里写的赠送）、沃尔沃的叫法（工单加账本，按次数）", () => {
  const a = ticket({ total: 100, own: 10, labour_discount: 5, prefs: [{ name: "续保代金券", type: "", amount: 80 }], rounding: 5, remark: "建议每8500公里保养" })
  const b = ticket({ total: 50, own: 0, remark: "建议每8500公里保养，建议更换前刹车片" })
  assert.deepEqual(settlementOf([a, b]), { total: 150, labour_discount: 5, discounts: [], prefs: a.prefs, rounding: 5, own: 10, remark: "建议每8500公里保养，建议更换前刹车片" })
  assert.deepEqual(settlementRefs([a, ticket({ prefs: [{ name: "忠诚守候养修/保养套餐优惠券-200元", type: "", amount: 200 }] }), ticket({ projects: ["保养（44382公里）国寿赠送", "保养"] })]),
    [{ name: "续保代金券", amount: 80 }, { name: "忠诚守候养修/保养套餐优惠券", amount: 200 }, { name: "保养（44382公里）国寿赠送", amount: null }])
  const l: LedgerFile = { ...emptyLedger(), records: [{ kind: "maintenance", id: "m", vehicle_id: "v1", ts: T("2022-08-01 10:00"), odometer: 1, items: ["机油", "空调滤芯"], amount: 0, remark: "" }] }
  const vs = [visit({ tickets: [ticket({ labours: ["原厂基础保养", "更换火花塞"], parts: ["机油 0W20"] })] }), visit({ order_id: "B", arrive_ts: T("2025-07-03 09:00"), tickets: [ticket({ labours: ["原厂基础保养"], parts: ["机油 0W20"] })] })]
  assert.deepEqual(serviceVocabulary(vs, naming, l, "v1"), ["机油 0W20", "机油滤清器", "火花塞", "机油", "空调滤芯"])
})

test("读账本时补上 service_records；检查记成的记录都在", () => {
  const n = normalizeLedger({ ...emptyLedger(), service_records: undefined } as unknown as Record<string, unknown>)
  assert.deepEqual(n.service_records, [])
  const bad = { ...emptyLedger(), vehicles: [v1], service_records: [{ vehicle_id: "v1", provider: "volvo_cn", order_id: "X", dealer_code: "D", arrive_ts: 0, odometer: null, dealer: null, tickets: [{ ...ticket({}), record_id: "nope" }] }] } as LedgerFile
  assert.deepEqual(ledgerProblems(bad), ["养修 X 的工单 RO1 记成的记录不存在"])
})
