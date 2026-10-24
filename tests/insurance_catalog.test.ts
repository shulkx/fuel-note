import { test } from "node:test"
import assert from "node:assert/strict"
import { catalogEntry, insurerShort, itemKey } from "../common/insurance_catalog"

test("商业险：各家、各年份的写法对应到同一个统一名称", () => {
  const cases: Array<[string, string]> = [
    ["机动车损失保险", "damage"],
    ["机动车第三者责任保险", "third_party"],
    ["第三者责任保险", "third_party"],
    ["附加医保外医疗费用责任险（三者）", "med_extra"],
    ["附加医保外医疗费用责任险（机动车第三者责任保险）", "med_extra"],
    ["附加法定节假日限额翻倍险", "holiday_double"],
    ["附加机动车增值服务特约条款代为送检服务 特约条款", "send_inspection"],
    ["代为送检服务特约条款", "send_inspection"],
    ["附加机动车代为送检服务特约条款", "send_inspection"],
    ["附加机动车增值服务特约条款（道路救援服 务特约条款）", "rescue"],
    ["道路救援服务特约条款", "rescue"],
    ["附加机动车车辆安全检测特约条款", "inspection"],
    ["附加机动车代为驾驶服务特约条款", "driver"],
    ["不计免赔率险", "non_deductible"],
    ["机动车车上人员责任保险（司机）", "seat_driver"],
    ["机动车车上人员责任保险（乘客）", "seat_passenger"],
    ["附加车身划痕损失险", "scratch"],
    ["附加自用充电桩损失保险", "charger_loss"],
  ]
  for (const [name, key] of cases) assert.equal(itemKey(name, "commercial"), key, name)
})

test("意外险：节假日翻倍、住院津贴不会被认成身故或医疗", () => {
  const cases: Array<[string, string]> = [
    ["意外身故、伤残", "accident_death"],
    ["意外身故", "accident_death"],
    ["驾驶或乘坐意外身故残疾", "accident_death"],
    ["意外伤残", "accident_disability"],
    ["意外伤害医疗费用", "accident_medical"],
    ["驾驶或乘坐意外医疗", "accident_medical"],
    ["意外伤害住院津贴", "hospital_allowance"],
    ["节假日驾乘意外身故、伤残", "accident_holiday"],
    ["驾乘事故法定节日限额翻倍", "accident_holiday"],
    ["超龄人员", "over_age"],
    ["室内财产损失保障", "non_vehicle"],
  ]
  for (const [name, key] of cases) assert.equal(itemKey(name, "accident"), key, name)
})

test("按保单种类限定：商业险里的「盗抢」不会被当成家财", () => {
  assert.equal(itemKey("全车盗抢险", "commercial"), "theft")
  assert.equal(itemKey("盗抢损失（限特定入室方式）", "accident"), "non_vehicle")
  assert.equal(itemKey("车辆不认识的条款", "commercial"), null)
})

test("统一名称的简称和分组", () => {
  assert.deepEqual([catalogEntry("damage")?.short, catalogEntry("damage")?.group], ["车损险", "main"])
  assert.equal(catalogEntry("rescue")?.group, "service")
  assert.equal(catalogEntry("non_deductible")?.group, "legacy")
  assert.equal(catalogEntry("nope"), null)
})

test("保险公司简称", () => {
  assert.equal(insurerShort("中国平安财产保险股份有限公司上海市静安支公司"), "中国平安")
  assert.equal(insurerShort("中国人寿财产保险股份有限公司上海市分公司"), "中国人寿")
  assert.equal(insurerShort("中国太平洋财产保险股份有限公司"), "太平洋")
  assert.equal(insurerShort("中国太平财产保险有限公司"), "太平")
  assert.equal(insurerShort("示例财产保险股份有限公司北京分公司"), "示例")
})
