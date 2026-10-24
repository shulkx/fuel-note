// 险种名称表和保险公司（设计文档 20.5 节）。各家、各年份的写法对应到同一个统一名称，历年对比按它对上。纯逻辑。
import { PolicyKind } from "./types"

export type CatalogGroup = "main" | "addon" | "service" | "legacy" | "ev" | "accident" | "non_vehicle"

export type CatalogEntry = { key: string; short: string; group: CatalogGroup; pattern: RegExp }

/**
 * 按顺序匹配，先写更具体的：医保外医疗的括号里有「第三者责任保险」「车上人员」，节假日翻倍里有「身故」，
 * 所以它们排在三者险、车上人员险、意外身故前面。名称先去掉空白再匹配（PDF 里常被断开）。
 */
export const CATALOG: CatalogEntry[] = [
  // 增值服务（附加机动车增值服务特约条款）
  { key: "rescue", short: "道路救援", group: "service", pattern: /道路救援/ },
  { key: "inspection", short: "车辆安全检测", group: "service", pattern: /安全检测/ },
  { key: "driver", short: "代为驾驶", group: "service", pattern: /代为驾驶/ },
  { key: "send_inspection", short: "代为送检", group: "service", pattern: /代为送检/ },
  // 附加险（2020 版示范条款）
  { key: "med_extra", short: "医保外医疗费用责任险", group: "addon", pattern: /医保外医疗/ },
  { key: "holiday_double", short: "节假日限额翻倍险", group: "addon", pattern: /节假日限额翻倍/ },
  { key: "deductible_rate", short: "绝对免赔率特约", group: "addon", pattern: /绝对免赔率/ },
  { key: "wheel", short: "车轮单独损失险", group: "addon", pattern: /车轮单独损失/ },
  { key: "new_equipment", short: "新增加设备损失险", group: "addon", pattern: /新增加?设备/ },
  { key: "scratch", short: "车身划痕险", group: "addon", pattern: /车身划痕/ },
  { key: "repair_comp", short: "修理期间费用补偿险", group: "addon", pattern: /修理期间费用补偿/ },
  { key: "engine_water_excl", short: "发动机进水损坏除外", group: "addon", pattern: /发动机进水损坏除外/ },
  { key: "cargo", short: "车上货物责任险", group: "addon", pattern: /车上货物/ },
  { key: "mental", short: "精神损害抚慰金责任险", group: "addon", pattern: /精神损害抚慰金/ },
  // 新能源车专属
  { key: "grid", short: "外部电网故障损失险", group: "ev", pattern: /外部电网故障/ },
  { key: "charger_loss", short: "自用充电桩损失险", group: "ev", pattern: /充电桩损失/ },
  { key: "charger_liability", short: "自用充电桩责任险", group: "ev", pattern: /充电桩责任/ },
  // 2020 年 9 月改革前的旧条款
  { key: "non_deductible", short: "不计免赔率险", group: "legacy", pattern: /不计免赔/ },
  { key: "theft", short: "全车盗抢险", group: "legacy", pattern: /全车盗抢/ },
  { key: "glass", short: "玻璃单独破碎险", group: "legacy", pattern: /玻璃单独破碎/ },
  { key: "self_ignition", short: "自燃损失险", group: "legacy", pattern: /自燃/ },
  { key: "wading", short: "发动机涉水险", group: "legacy", pattern: /涉水/ },
  { key: "designated_repair", short: "指定修理厂险", group: "legacy", pattern: /指定修理厂/ },
  { key: "no_third_party", short: "无法找到第三方特约", group: "legacy", pattern: /无法找到第三方/ },
  // 主险
  { key: "seat_driver", short: "车上人员险（司机）", group: "main", pattern: /车上人员.*司机/ },
  { key: "seat_passenger", short: "车上人员险（乘客）", group: "main", pattern: /车上人员.*乘客/ },
  { key: "damage", short: "车损险", group: "main", pattern: /(车辆|机动车)损失(保)?险/ },
  { key: "third_party", short: "三者险", group: "main", pattern: /第三者责任(保)?险/ },
  // 驾乘意外险
  { key: "over_age", short: "超龄人员", group: "accident", pattern: /超龄/ },
  { key: "accident_holiday", short: "节假日翻倍", group: "accident", pattern: /节假日|法定节日/ },
  { key: "hospital_allowance", short: "住院津贴", group: "accident", pattern: /住院津贴/ },
  { key: "accident_medical", short: "意外医疗", group: "accident", pattern: /医疗/ },
  { key: "accident_death", short: "意外身故", group: "accident", pattern: /身故/ },
  { key: "accident_disability", short: "意外伤残", group: "accident", pattern: /伤残|残疾/ },
  // 搭售的非车保障（家庭财产等）
  { key: "non_vehicle", short: "非车保障", group: "non_vehicle", pattern: /家庭|财产|房屋|装修|水暖管|盗抢|空调/ },
]

const KIND_GROUPS: Record<PolicyKind, CatalogGroup[]> = {
  compulsory: [],
  commercial: ["service", "addon", "ev", "legacy", "main"],
  accident: ["accident", "non_vehicle"],
  other: ["accident", "non_vehicle", "service"],
}

/** 保单上的名称 → 统一名称；按保单种类限定在相关的分组里 */
export function itemKey(name: string, kind: PolicyKind): string | null {
  const s = name.replace(/\s+/g, "")
  const groups = KIND_GROUPS[kind]
  const hit = CATALOG.find(e => groups.includes(e.group) && e.pattern.test(s))
  return hit ? hit.key : null
}

export function catalogEntry(key: string): CatalogEntry | null {
  return CATALOG.find(e => e.key === key) ?? null
}

/** 太平洋排在太平前面 */
const INSURERS: Array<{ pattern: RegExp; short: string }> = [
  { pattern: /中国平安|平安财产/, short: "中国平安" },
  { pattern: /中国人寿|国寿财/, short: "中国人寿" },
  { pattern: /中国人民财产|人保财/, short: "中国人保" },
  { pattern: /太平洋/, short: "太平洋" },
  { pattern: /太平/, short: "太平" },
  { pattern: /大地/, short: "大地" },
  { pattern: /阳光/, short: "阳光" },
  { pattern: /华安/, short: "华安" },
  { pattern: /天安/, short: "天安" },
  { pattern: /永安/, short: "永安" },
  { pattern: /众安/, short: "众安" },
]

export function insurerShort(full: string): string {
  const hit = INSURERS.find(i => i.pattern.test(full))
  if (hit) return hit.short
  return full.replace(/(财产)?保险(股份)?有限公司.*$/, "").trim() || full
}
