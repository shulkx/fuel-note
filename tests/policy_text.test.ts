// 保单文字的解析（设计文档 20.5 节）。样本照各家保单的版式编造：公司、号码、金额都是假的。
// 设置 XXYH_ROOT 时另外核对用户保单在手机上（PDFKit）和电脑上（pdftotext）取出的真实文字。
import { test } from "node:test"
import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { ocrPageText, parseChineseAmount, parseItems, parsePeriod, parsePolicyText, ParsedPolicy, pdfHasText, toPolicy, vinWarning } from "../common/policy_text"
import { OcrBlock } from "../common/receipt_rules"
import { XXYH_ROOT } from "./helpers"

const BJ = (s: string) => Date.parse(`${s}+08:00`)
const dayEnd = (s: string) => BJ(`${s}T23:59:59.999`)

// 平安的车险版式：「保险费合计: RMB…（不含税保费…税额…）（大写）人民币…」，明细逐行，免赔率一栏是「—」
const PA_COMMERCIAL = [`国家金融监督管理总局监制 限在某市销售
机动车商业保险保险单（电子保单）
流 水 号：
确 认 码： V0201EXAMPLE0000000000000000
保险单号： 10280000000000001234
行驶证车主：张三 投保人：张三
产品条款： 机动车综合商业保险示范条款
号牌号码 某A12345 机动车种类 六座以下客车
发动机号码 1234567 车辆识别代码 LSVAB12C3D4567890
承保险种
保险金额/责任限额（元） 绝对免赔率 保险费小计（元）
机动车损失保险
180000.00
—
3000.00
机动车第三者责任保险
3000000.00
—
1100.00
附加医保外医疗费用责任险（三者）
共享保额
—
23.45
代为送检服务特约条款
1次
—
—
道路救援服务特约条款
12次
—
—
保险费合计: RMB4123.45元（不含税保费:3889.95元，税额:233.50元）（大写）人民币肆仟壹佰贰拾叁元肆角伍分
保险期间自 2026 年 1 月 7 日 00 时 00 分起至 2027 年 1 月 6 日 23 时 59 分止
特别约定 1) 尊敬的客户：承保及理赔等信息您可通过客服热线95000核实。
公司名称： 示例财产保险股份有限公司某市分公司
服务电话: 95000
签单日期： 2025年12月20日`]

// 人寿的车险版式：明细逐行、没有免赔率一栏，服务的保费是 0.00；期间的结束日期断到下一行；税额写在特别约定里
const GL_COMMERCIAL = [`中国银行保险监督管理委员会监制 限在某市销售
机动车商业保险保险单(电子保单)
保险单号：6605000000000000005678
产品条款：机动车商业保险示范条款
承 保 险 种
保险金额/责任限额(元)
绝对免赔率 保险费小计(元)
机动车损失保险
250,000.00
2,500.00
机动车第三者责任保险
3,000,000.00
800.00
附加法定节假日限额翻倍险
3,000,000.00
70.00
附加医保外医疗费用责任险（机动车第三者责任保险）
200,000.00
15.00
附加机动车道路救援服务特约条款
7次
0.00
附加机动车代为送检服务特约条款
/
0.00
保险费合计(人民币大写):叁仟叁佰捌拾伍元整
（¥:
3,385.00元）
保险期间自 2024年01月07日00时00分 起至
2025年01月06日23时59分
止
特 别 约 定 5、本合同的保险费为3385.00元，其中不含税价格为3193.40元，增值税额为191.60元。
公司名称： 示例财产保险股份有限公司某市分公司
客服/投诉热线： 95000
签单日期： 2023年12月05日`]

// 平安 2022 年的服务：先列四个名称，数值按列排在后面
const PA_COLUMNS = [`机动车商业保险保险单（电子保单）
保险单号： 10280000000000004321
承保险种
保险金额/责任限额（元） 绝对免赔率 保险费小计（元）
机动车损失保险
290000.00
—
3700.00
机动车第三者责任保险
2000000.00
—
1100.00
附加机动车增值服务特约条款代为送检服务 特约条款
附加机动车增值服务特约条款代为驾驶服务 特约条款
附加机动车增值服务特约条款车辆安全检测 特约条款
附加机动车增值服务特约条款（道路救援服 务特约条款）
1 次 1 次 1 次 12 次
—
—
—
—
—
—
—
—
保险费合计: RMB4800.00元（不含税保费:4528.30元，税额:271.70元）（大写）人民币肆仟捌佰元整
保险期间自 2022 年 1 月 7 日 00 时 00 分起至 2023 年 1 月 6 日 23 时 59 分止
示例财产保险股份有限公司`]

// 2020 年 9 月改革前的旧条款：「是否投保不计免赔」一栏，不计免赔率险只有保费
const GL_LEGACY = [`机动车商业保险保险单（电子保单）
保险单号：805110000000000000999
承 保 险 种
保险金额/责任限额（元）
是否投保不计免赔
保险费小计（元）
机动车损失保险
300,000.00
是
6,000.00
第三者责任保险
1,500,000.00
是
1,900.00
不计免赔率险
1,200.00
保险费合计（人民币大写）：玖仟壹佰元整
（¥：9,100.00 元）
保险期间自 2020 年 1 月 7 日 0 时 0 分起至 2021 年 1 月 6 日 23 时 59 分止
示例财产保险股份有限公司
服务电话：95000`]

// 交强险（人寿版式）：浮动比率、车船税的大写合计；第 2 页是标志
const GL_COMPULSORY = [`国家金融监督管理总局监制 机动车交通事故责任强制保险单(电子保单)
保险单号：6605000000000000002468
与道路交通安全违法行为和道路交通事故相联系的浮动比率：-10.00%
保险费合计(人民币大写)： 捌佰伍拾伍元整
(¥: 855.00 元)其中救助基金( 1 %) ¥: 8. 元 07
保险期间自： 2024年01月07日00时00分 起至
2025年01月06日23时59分
止
代 整备质量 1784千克
收 当年应缴 ¥: 360.00 元 往年补缴 ¥: 0.00
元 滞纳金 ¥: 0.00
船 合计（人民币大写）：叁佰陆拾元整
（¥:
360.00 元）
特 别 约 定 2、本合同的保险费为855元，其中不含税价格为806.60元，增值税额为48.40元。
公司名称： 示例财产保险股份有限公司某市分公司
签单日期： 2023年12月05日`, `6605000000000000002468
自2024年01月07日00时00分起
至2025年01月06日23时59分止`]

// 交强险（平安版式）：浮动比率是正的，保费在「保险费合计: RMB…」
const PA_COMPULSORY = [`机动车交通事故责任强制保险单 (电子保单)
保险单号： 10280000000000003690
与道路交通安全违法行为和道路交通事故相联系的浮动比率: 20 % 保险费合计: RMB1140.00元（不含税保费:1075.47元，税额:64.53元）（大写）人民币壹仟壹佰肆拾元整
其中救助基金(1.0%) ￥: 10.75元 保险期间自 2025 年 03 月 01 日 00 时 00 分起至 2026 年 02 月 28 日 23 时 59 分止
收 当年应缴 ￥: 300.00
船 合计(人民币大写)： 叁佰元整
（￥: 300.00 元）
示例财产保险股份有限公司`]

// 人寿的意外险：「自…零时起，至…二十四时止」，「￥CNY…元」
const GL_ACCIDENT = [`人身意外伤害保险（特定场景B）电子保险单
保险单号： 6627000000000000001357
鉴于投保人已向本公司投保《示例财产保险股份有限公司人身意外伤害保险（特定场景B）》，特立本保险单为凭。
意外身故 CNY400,000.00 0.0元/0.0%
保险期间 保险费合计
自2024年1月7日零时起，至2025年1月6日二十四时止。
人民币 （大写） 叁佰元整
￥CNY300.00元`, `本合同的保险费为300.00元,其中不含税价格为283.02元，增值税额为16.98元。
签单日期：
综合事业部
2023年12月5日
全国统一客户服务电话： 95000`]

// 平安的搭售保障：标题在「按以下条件承保：」后面；期限写到秒，到期是「24时00分00秒」
const PA_BUNDLE = [`示例财产保险股份有限公司
示例车主保障
保单号：102800166Z0000002460 验真码：AbCdEf
本公司依据投保人申请，按以下条件承保：示例车主保障以下信息来源于您的投保申请
保险期限 2026年01月07日00时00分00秒 起 至 2027年01月06日24时00分00秒 止 (北京时间)
保险费合计/（元）
（小写）RMB500.00（不含税保费：471.70元，税额 ：28.30元）（大写）伍佰元整
险种名称：示例交通出行意外伤害保险`, `24小时全国理赔报案电话：95000。
出单日期： 2025年12月19日15时`]

// 手机上 PDFKit 取出的版式：一个险种一行（名称太长时折到下一行）；标签挤在一起，号码排在后面；
// 签单日期离标签很远；车船税的大写金额排在「合计（人民币大写）」前面，「当年应缴」的金额在「￥」前面
const PA_PDFKIT = [`机动车商业保险保险单（电子保单）
流 水 号：
确 认 码：
保险单号：
下载示例APP
单 证 查 验
V0201EXAMPLE00000000000000001
10280000000000007777
车辆识别代码 LSVAB12C3D4567890
承保险种 保险金额/责任限额（元）
绝对免赔率 保险费小计（元）
机动车损失保险 200000.00 — 3500.00
机动车第三者责任保险 2000000.00 — 1000.00
附加机动车增值服务特约条款代为送检服务
特约条款 1 次 — —
附加机动车增值服务特约条款（道路救援服
务特约条款） 12 次 — —
保险费合计: RMB4500.00元（不含税保费:4245.28元，税额:254.72元）（大写）人民币肆仟伍佰元整
保险期间自 2022 年 1 月 7 日 00 时 00 分起至 2023 年 1 月 6 日 23 时 59 分止
公司名称：
示例财产保险股份有限公司某市分
公司地址：
邮政编码：
200000
服务电话:
95000
签单日期：
2021年11月20日
(保险人签章)`]

const PA_PDFKIT_COMPULSORY = [`机动车交通事故责任强制保险单
(电子保单)
保险单号：
02PAIC00000000000000000001234D
10280000000000008888
与道路交通安全违法行为和道路交通事故相联系的浮动比率: 30 %
保险费合计: RMB1235.00元（不含税保费:1165.09元，税额:69.91元）（大写）人民币壹仟贰佰叁拾伍元整
保险期间自 2022 年 01 月 07 日 00 时 00 分起至 2023 年 01 月 06 日 23 时 59 分止
当年应缴
300.00
￥: 元
叁佰元整
合计(人民币大写)： （￥: 元）
300.00
示例财产保险股份有限公司`]

// 交强险标志：有保单号和期间，没有标题和保费
const STICKER = [`10280000000000003690 某A12345 2022年1月7日至2023年1月6日`]

test("大写金额", () => {
  assert.equal(parseChineseAmount("伍仟零叁拾壹元贰角"), 5031.2)
  assert.equal(parseChineseAmount("人民币肆仟柒佰肆拾元零叁角贰分"), 4740.32)
  assert.equal(parseChineseAmount("叁佰陆拾元整"), 360)
  assert.equal(parseChineseAmount("壹仟零捌拾伍元整"), 1085)
  assert.equal(parseChineseAmount("玖仟叁佰贰拾陆元玖角柒分"), 9326.97)
  assert.equal(parseChineseAmount("拾元整"), 10)
  assert.equal(parseChineseAmount("壹拾贰万叁仟元整"), 123000)
  assert.equal(parseChineseAmount("没有金额"), null)
})

test("保险期间：四种写法，以及只在别处（标志页）找得到时", () => {
  assert.deepEqual(parsePeriod(PA_COMMERCIAL.join("\n")), { start: BJ("2026-01-07T00:00:00"), end: dayEnd("2027-01-06") })
  assert.deepEqual(parsePeriod(GL_COMMERCIAL.join("\n")), { start: BJ("2024-01-07T00:00:00"), end: dayEnd("2025-01-06") })
  assert.deepEqual(parsePeriod(GL_ACCIDENT.join("\n")), { start: BJ("2024-01-07T00:00:00"), end: dayEnd("2025-01-06") })
  assert.deepEqual(parsePeriod(PA_BUNDLE.join("\n")), { start: BJ("2026-01-07T00:00:00"), end: dayEnd("2027-01-06") })
  // 期间的文字被打乱，只能从标志页的「自…起至…止」找到
  assert.deepEqual(parsePeriod("保险期间自： 2020 年 1 月 0 分起至 2021 年 1 月 59 分止\n2020年1月7日0时0分起至\n2021年1月6日23时59分止"),
    { start: BJ("2020-01-07T00:00:00"), end: dayEnd("2021-01-06") })
  assert.equal(parsePeriod("没有日期"), null)
})

test("平安商业险：标题、保单号、公司、保费和税额、电话、车架号、签单日期、逐行的明细", () => {
  const p = parsePolicyText(PA_COMMERCIAL) as ParsedPolicy
  assert.deepEqual(
    [p.kind, p.title, p.insurer, p.policy_no, p.premium, p.premium_ex_tax, p.tax, p.float_rate, p.vehicle_tax, p.phone, p.vin, p.sign_ts],
    ["commercial", "机动车商业保险保险单", "示例财产保险股份有限公司", "10280000000000001234", 4123.45, 3889.95, 233.5, null, null, "95000", "LSVAB12C3D4567890", BJ("2025-12-20T12:00:00")],
  )
  assert.deepEqual(p.items.map(i => [i.key, i.amount, i.amount_text, i.premium, i.times]), [
    ["damage", 180000, "", 3000, null],
    ["third_party", 3000000, "", 1100, null],
    ["med_extra", null, "共享保额", 23.45, null],
    ["send_inspection", null, "1次", null, 1],
    ["rescue", null, "12次", null, 12],
  ])
  assert.deepEqual(p.issues, [])
})

test("人寿商业险：税额在特别约定里，服务的 0.00 不算保费，「/」记在金额写法里", () => {
  const p = parsePolicyText(GL_COMMERCIAL) as ParsedPolicy
  assert.deepEqual([p.premium, p.premium_ex_tax, p.tax, p.phone, p.start_ts, p.end_ts], [3385, 3193.4, 191.6, "95000", BJ("2024-01-07T00:00:00"), dayEnd("2025-01-06")])
  assert.deepEqual(p.items.map(i => [i.key, i.amount, i.amount_text, i.premium, i.times]), [
    ["damage", 250000, "", 2500, null],
    ["third_party", 3000000, "", 800, null],
    ["holiday_double", 3000000, "", 70, null],
    ["med_extra", 200000, "", 15, null],
    ["rescue", null, "7次", null, 7],
    ["send_inspection", null, "/", null, null],
  ])
  assert.deepEqual(p.issues, [])
})

test("名称在前、数值按列排在后面时，按列分给这几项", () => {
  const p = parsePolicyText(PA_COLUMNS) as ParsedPolicy
  assert.deepEqual(p.items.map(i => [i.key, i.times]), [["damage", null], ["third_party", null], ["send_inspection", 1], ["driver", 1], ["inspection", 1], ["rescue", 12]])
  assert.deepEqual(p.issues, [])
})

test("改革前的旧条款：「是否投保不计免赔」是表头，不计免赔率险只有保费", () => {
  const p = parsePolicyText(GL_LEGACY) as ParsedPolicy
  assert.deepEqual(p.items.map(i => [i.key, i.amount, i.premium]), [["damage", 300000, 6000], ["third_party", 1500000, 1900], ["non_deductible", null, 1200]])
  assert.deepEqual([p.premium, p.premium_ex_tax, p.tax, p.issues], [9100, null, null, []])
})

test("交强险：浮动比率、车船税（大写合计）、没有明细", () => {
  const gl = parsePolicyText(GL_COMPULSORY) as ParsedPolicy
  assert.deepEqual([gl.kind, gl.title, gl.premium, gl.premium_ex_tax, gl.tax, gl.float_rate, gl.vehicle_tax, gl.items, gl.issues],
    ["compulsory", "机动车交通事故责任强制保险单", 855, 806.6, 48.4, -10, 360, [], []])
  assert.equal(gl.sign_ts, BJ("2023-12-05T12:00:00"))
  const pa = parsePolicyText(PA_COMPULSORY) as ParsedPolicy
  assert.deepEqual([pa.premium, pa.premium_ex_tax, pa.tax, pa.float_rate, pa.vehicle_tax, pa.start_ts, pa.end_ts],
    [1140, 1075.47, 64.53, 20, 300, BJ("2025-03-01T00:00:00"), dayEnd("2026-02-28")])
})

test("意外险和搭售的保障：读标题、保费、期间、电话，不读明细", () => {
  const a = parsePolicyText(GL_ACCIDENT) as ParsedPolicy
  assert.deepEqual([a.kind, a.title, a.policy_no, a.premium, a.premium_ex_tax, a.tax, a.phone, a.items, a.sign_ts],
    ["accident", "人身意外伤害保险（特定场景B）", "6627000000000000001357", 300, 283.02, 16.98, "95000", [], BJ("2023-12-05T12:00:00")])
  const a2 = parsePolicyText([GL_ACCIDENT[0], GL_ACCIDENT[1].replace("全国统一客户服务电话", "全国统一服务/投诉电话")]) as ParsedPolicy
  assert.equal(a2.phone, "95000")
  const b = parsePolicyText(PA_BUNDLE) as ParsedPolicy
  assert.deepEqual([b.kind, b.title, b.policy_no, b.premium, b.premium_ex_tax, b.tax, b.phone, b.end_ts, b.sign_ts],
    ["accident", "示例车主保障", "102800166Z0000002460", 500, 471.7, 28.3, "95000", dayEnd("2027-01-06"), BJ("2025-12-19T12:00:00")])
})

test("手机上取出的版式：一行一个险种、名称折行、标签挤在一起、日期离标签很远、大写金额在标签前面", () => {
  const p = parsePolicyText(PA_PDFKIT) as ParsedPolicy
  assert.deepEqual([p.policy_no, p.premium, p.vin, p.sign_ts, p.issues], ["10280000000000007777", 4500, "LSVAB12C3D4567890", BJ("2021-11-20T12:00:00"), []])
  assert.deepEqual(p.items.map(i => [i.key, i.amount, i.premium, i.times]), [
    ["damage", 200000, 3500, null], ["third_party", 2000000, 1000, null], ["send_inspection", null, null, 1], ["rescue", null, null, 12],
  ])
  const c = parsePolicyText(PA_PDFKIT_COMPULSORY) as ParsedPolicy
  assert.deepEqual([c.kind, c.policy_no, c.premium, c.float_rate, c.vehicle_tax], ["compulsory", "10280000000000008888", 1235, 30, 300])
  // 只有「当年应缴」时用它（金额在「￥」前面）
  const due = parsePolicyText([PA_PDFKIT_COMPULSORY[0].replace("叁佰元整\n合计(人民币大写)： （￥: 元）", "")]) as ParsedPolicy
  assert.equal(due.vehicle_tax, 300)
})

test("取不出文字的 PDF", () => {
  assert.equal(pdfHasText(["", "  \n"]), false)
  assert.equal(pdfHasText(["", "保险单"]), true)
})

// 扫描件截图后 Vision 识别出的文字块（人寿改革前版式）：归一化坐标、原点在左下；
// 顺序按列打乱（名称一列、保额一列、保费一列），和手机上识别 2020 年人寿保单时一样；车架号的 1 读成了 I
const ocrRow = (y: number, ...cells: Array<[number, string]>) => cells.map(([x, t]): OcrBlock => ({ t, c: 1, b: [x, 1 - y - 0.01, 0.1, 0.01] }))
const OCR_COMMERCIAL: OcrBlock[] = [
  ocrRow(0.10, [0.3, "机动车商业保险保险单（电子保单）"]),
  ocrRow(0.15, [0.5, "保险单号：805110000000000000999"]),
  ocrRow(0.20, [0.1, "发动机号码"], [0.2, "1234567"], [0.4, "车辆识别代码"], [0.6, "LSVABI2C3D4567890"]),
  ocrRow(0.30, [0.1, "承保险种"], [0.3, "保险金额/责任限额（元）"], [0.55, "是否投保不计免赔"], [0.8, "保险费小计（元）"]),
  ocrRow(0.33, [0.1, "机动车损失保险"], [0.3, "300,000.00"], [0.55, "是"], [0.8, "6,000.00"]),
  ocrRow(0.36, [0.1, "第三者责任保险"], [0.3, "1,500,000.00"], [0.55, "是"], [0.8, "1,900.00"]),
  ocrRow(0.39, [0.1, "不计免赔率险"], [0.8, "1,200.00"]),
  ocrRow(0.42, [0.1, "保险费合计（人民币大写）：玖仟壹佰元整"], [0.75, "（¥：9,100.00 元）"]),
  ocrRow(0.45, [0.1, "保险期间自 2020年1月7日0时0分起至2021年1月6日23时59分止"]),
  ocrRow(0.50, [0.1, "示例财产保险股份有限公司"], [0.5, "服务电话：95000"]),
].flat().sort((a, b) => a.b[0] - b.b[0] || b.b[1] - a.b[1])

test("扫描件：截图识别的文字块按位置排成行，再按规则读；车架号里的 I、O 纠正成 1、0", () => {
  const text = ocrPageText(OCR_COMMERCIAL)
  assert.match(text, /^机动车损失保险 300,000.00 是 6,000.00$/m)
  const p = parsePolicyText([text]) as ParsedPolicy
  assert.deepEqual(p.items.map(i => [i.key, i.amount, i.premium]), [["damage", 300000, 6000], ["third_party", 1500000, 1900], ["non_deductible", null, 1200]])
  assert.deepEqual([p.kind, p.premium, p.policy_no, p.vin, p.start_ts, p.end_ts, p.issues],
    ["commercial", 9100, "805110000000000000999", "LSVAB12C3D4567890", BJ("2020-01-07T00:00:00"), dayEnd("2021-01-06"), []])
  // 只在「车辆识别代码」后面纠正；纠正后仍不像车架号时不算
  assert.equal(parsePolicyText([text.replace("LSVABI2C3D4567890", "12345678901234567")])?.vin, null)
})

test("交强险：识别时丢了「%」的浮动比率", () => {
  const gl = parsePolicyText([GL_COMPULSORY[0].replace("-10.00%", "-10.00")]) as ParsedPolicy
  assert.equal(gl.float_rate, -10)
  const zero = parsePolicyText([GL_COMPULSORY[0].replace("相联系的浮动比率：-10.00%", "相联系浮动比率：0.00")]) as ParsedPolicy
  assert.equal(zero.float_rate, 0)
})

test("交强险标志不是保单", () => {
  assert.equal(parsePolicyText(STICKER), null)
  assert.equal(parsePolicyText([""]), null)
})

test("对不上时写进 issues：大写金额不同、明细之和不等于合计、读不出期间", () => {
  const wrongCn = parsePolicyText([PA_COMPULSORY[0].replace("壹仟壹佰肆拾元整", "壹仟壹佰叁拾元整")]) as ParsedPolicy
  assert.deepEqual(wrongCn.issues, ["保险费 1,140.00 与大写金额 1,130.00 不一致，请核对"])
  const wrongSum = parsePolicyText([PA_COMMERCIAL[0].replace("1100.00\n附加", "1000.00\n附加")]) as ParsedPolicy
  assert.deepEqual(wrongSum.issues, ["各险种保费合计 4,023.45 与保险费合计 4,123.45 不符，请核对"])
  const noPeriod = parsePolicyText([PA_COMPULSORY[0].replace(/保险期间自[^\n]*/, "")]) as ParsedPolicy
  assert.deepEqual([noPeriod.issues, noPeriod.start_ts, noPeriod.end_ts], [["没读出保险期间，请填写"], 0, 0])
})

test("parseItems：没有「承保险种」时为空", () => {
  assert.deepEqual(parseItems("随便一段文字", "commercial"), [])
})

test("转成保存的保单；车架号与关联的车不符时提示", () => {
  const p = parsePolicyText(PA_COMMERCIAL) as ParsedPolicy
  const saved = toPolicy(p, "insurance/ins1/商业险.pdf")
  assert.equal(saved.file, "insurance/ins1/商业险.pdf")
  assert.equal("vin" in saved || "sign_ts" in saved, false)
  assert.equal(vinWarning(p.vin, "LSVAB12C3D4567890"), null)
  assert.equal(vinWarning(p.vin, "lsvab12c3d4567890"), null)
  assert.match(vinWarning(p.vin, "LSVAB12C3D4567891") ?? "", /车架号与这辆车不符/)
  assert.equal(vinWarning(p.vin, null), null)
  assert.equal(vinWarning(null, "LSVAB12C3D4567891"), null)
})

// ---------- 真实保单（只在本机，XXYH_ROOT） ----------

type Expected = {
  not_policy?: boolean; pdfkit_no_text?: boolean; kind: string; title: string; insurer: string; policy_no_tail: string; policy_no_len: number; start: string; end: string; sign: string
  premium: number; premium_ex_tax: number | null; tax: number | null; float_rate: number | null; vehicle_tax: number | null; phone: string
  items: Array<{ key: string; amount: number | null; premium: number | null; times: number | null }> | null
}

const outDir = XXYH_ROOT ? join(XXYH_ROOT, "out/insurance") : ""

/** 读出的和期望值逐项比较，不同的写进 problems */
function compareExpected(id: string, e: Expected, p: ParsedPolicy, problems: string[]): void {
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

for (const source of ["pdfkit", "pdftotext"]) {
  const file = outDir && join(outDir, `${source}.jsonl`)
  const ready = !!file && existsSync(file) && existsSync(join(outDir, "expected.json"))
  test(`真实保单（${source}）：17 份保单逐项一致，3 张标志认出不是保单`, { skip: ready ? false : `需要 XXYH_ROOT 和 out/insurance/${source}.jsonl` }, () => {
    const expected = JSON.parse(readFileSync(join(outDir, "expected.json"), "utf8")) as Record<string, Expected>
    const samples = new Map<string, string[]>()
    for (const line of readFileSync(file, "utf8").split("\n")) if (line.trim()) { const r = JSON.parse(line); samples.set(r.file, r.pages) }
    const vins = new Set<string>()
    const problems: string[] = []
    for (const [id, e] of Object.entries(expected)) {
      if (id.startsWith("_")) continue
      const pages = samples.get(id)
      if (!pages) { problems.push(`${id}：没有样本`); continue }
      // 2020 年人寿的两份用了 PDFKit 读不出的字体，手机上取出来是空的；油记会提示手动添加
      if (!pdfHasText(pages)) { if (!(source === "pdfkit" && e.pdfkit_no_text)) problems.push(`${id}：取不出文字`); continue }
      if (source === "pdfkit" && e.pdfkit_no_text) problems.push(`${id}：标了取不出文字，现在取出来了，请更新 expected.json`)
      const p = parsePolicyText(pages)
      if (e.not_policy) { if (p) problems.push(`${id}：标志被当成了保单`); continue }
      if (!p) { problems.push(`${id}：没认出是保单`); continue }
      compareExpected(id, e, p, problems)
      if (p.vin) vins.add(p.vin)
    }
    if (vins.size !== 1 || ![...vins][0].match(/^[A-HJ-NPR-Z0-9]{17}$/)) problems.push(`车架号读出 ${vins.size} 种`)
    assert.deepEqual(problems, [])
  })
}

// 读不出文字的两份（2020 年人寿）：手机上 WebView 截图、Vision 识别的文字块（FuelNote Probe 传回的 pdf_ocr.jsonl）
const ocrFile = outDir && join(outDir, "pdf_ocr.jsonl")
const ocrReady = !!ocrFile && existsSync(ocrFile) && existsSync(join(outDir, "expected.json"))
test("真实保单（截图识别）：读不出文字的保单截图后逐项一致", { skip: ocrReady ? false : "需要 XXYH_ROOT 和 out/insurance/pdf_ocr.jsonl" }, () => {
  const expected = JSON.parse(readFileSync(join(outDir, "expected.json"), "utf8")) as Record<string, Expected>
  const problems: string[] = []
  const vins = new Set<string>()
  let checked = 0
  for (const line of readFileSync(ocrFile, "utf8").split("\n")) {
    if (!line.trim()) continue
    const r = JSON.parse(line) as { file: string; candidates: OcrBlock[] }
    const p = parsePolicyText([ocrPageText(r.candidates)])
    if (!p) { problems.push(`${r.file}：没认出是保单`); continue }
    if (p.vin) vins.add(p.vin)
    // 2020 原件没有期望值，只核对车架号
    const e = expected[r.file]
    if (!e) continue
    compareExpected(r.file, e, p, problems)
    checked++
  }
  if (!checked) problems.push("没有可核对的样本")
  if (vins.size !== 1 || ![...vins][0].match(/^[A-HJ-NPR-Z0-9]{17}$/)) problems.push(`车架号读出 ${vins.size} 种`)
  assert.deepEqual(problems, [])
})
