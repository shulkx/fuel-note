// 识别权益（权益设计 5.2 节）：把销售发来的文字或套餐截图整理成几项权益。提示词、两种 JSON Schema（Azure 的 json_schema、Scripting 助手的），
// 结果整理成同一种形式，再变成「添加权益」里勾选的条目（保单自带的服务、同一来自里已有的默认不勾）。纯逻辑；调用在 platform/assistant.ts、readers/azure.ts。
import { normalizeName } from "../common/stores"

export type PerkScanKind = "balance" | "count"
export type PerkScanItem = {
  name: string
  kind: PerkScanKind
  total: number
  unit: string
  note: string
  /** 道路救援、代驾这类保单自带的服务 */
  policy_service: boolean
}
export type PerkScan = {
  /** 套餐、卡的名称；车险赠送为空 */
  source: string
  /** 有效期至 YYYY-MM-DD；原文没写时 null */
  end_date: string | null
  /** 原文里有效期的原话 */
  end_text: string
  /** 原文里门店的原话（「本店」照抄） */
  store: string
  /** 套餐的售价（实际要付的钱，不是价值、原价）；没写时 null */
  price: number | null
  items: PerkScanItem[]
  note: string
}

const ORIGIN_TEXT = { insurance: "随车险赠送的权益", package: "在 4S 店买的保养套餐", other: "其他权益（例如洗车卡）" } as const

/** 提示词。nulls：Azure 要求每个字段都在、没有的填 null；Scripting 助手没有 null，没有的省略 */
export function perkPrompt(origin: keyof typeof ORIGIN_TEXT, today: string, nulls: boolean): string {
  const none = nulls ? "填 null" : "省略不填"
  return `你是汽车权益清单的整理器。输入是销售发来的文字，或者 4S 店小程序、纸质清单的截图。把里面的每一项权益整理出来，只整理真实写着的内容，不要编造、不要推算没写的数量。
这一批是${ORIGIN_TEXT[origin]}。今天是 ${today}。
- source：套餐或卡的名称。原文没有明确的名称时，按标题和内容起一个简短的名称（例如「感恩特惠保养套餐」）；车险赠送${none}。
- price：买这个套餐实际要付的钱（售价、到手价、抢购价，例如「168元」），不是「价值」「原价」；车险赠送和没写时${none}。
- end_date：有效期至，格式 YYYY-MM-DD。原文只写「一年」「三年」这类说法时从今天推算；没写有效期时${none}。
- end_text：原文里关于有效期的原话（没有就${none}）。
- store：原文里关于门店的原话，「本店」照抄（没有就${none}）。
- items：每一项权益各一项：
  - name：名称照原文，去掉「一张」「一次」「3个」这类数量词和「免费」「赠送」「额外赠送」这类修饰词（「免费原厂喷漆一个面」→「原厂喷漆」）。balance 的金额填在 total，名称里不写（「赠送维修保养券800元」→「维修保养券」）；count 名称里的金额是券的一部分，要保留（「基础保养350元抵用券一张」→「基础保养350元抵用券」）。「价值」「原价」不写进名称。
  - kind：只有两种。
    - balance：一笔钱，可以分几次用掉。原文只写了金额、没写张数或次数，例如「赠送维修保养券800元」「保养基金2000元」。
    - count：一项服务或一张券，用一次就整次、整张用掉。原文写着「一张」「一次」「一个面」「一瓶」，例如「基础保养350元抵用券一张」「3个油漆面」「一次空调清洗」。带金额的抵用券、抵扣券也是 count。拿不准时填 count。
  - total：balance 填金额；count 填张数或次数（「一张」「一次」填 1，「3个油漆面」填 3）。
  - unit：count 的单位（张、次、面、瓶……）；balance 填「元」。
  - 「价值」「原价」「市场价」是宣传用的价格，不是能抵扣的钱：不要填进任何字段，也不要因为它把一项认成 balance。
  - note：使用条件（原文里有才填，没有就${none}）。
  - policy_service：道路救援、代驾（代为驾驶）、车辆安全检测、代为送检这类车险保单自带的服务填 true，其余填 false。
- note：其他需要说明的情况（没有就${none}）。`
}

const NUM = { type: ["number", "null"] }
const STR = { type: ["string", "null"] }

/** Azure OpenAI 的 json_schema（strict：每个字段都要有，没有的填 null） */
export const PERK_AZURE_SCHEMA = {
  name: "perks",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["source", "end_date", "end_text", "store", "price", "items", "note"],
    properties: {
      source: STR, end_date: STR, end_text: STR, store: STR, price: NUM, note: STR,
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "kind", "total", "unit", "note", "policy_service"],
          properties: {
            name: { type: "string" }, kind: { type: "string", enum: ["balance", "count"] }, total: NUM, unit: STR, note: STR,
            policy_service: { type: "boolean" },
          },
        },
      },
    },
  },
}

/** Scripting 助手的 JSON Schema（没有 null 和枚举，看不到的字段省略） */
type SchemaPrimitive = { type: "string" | "number" | "boolean"; required?: boolean; description: string }
type SchemaArray = { type: "array"; items: Schema; required?: boolean; description: string }
type SchemaObject = { type: "object"; properties: Record<string, Schema>; required?: boolean; description: string }
type Schema = SchemaPrimitive | SchemaArray | SchemaObject
const s = (description: string, required = false): SchemaPrimitive => ({ type: "string", description, ...(required ? { required } : {}) })
const n = (description: string, required = false): SchemaPrimitive => ({ type: "number", description, ...(required ? { required } : {}) })

export const PERK_ASSISTANT_SCHEMA: SchemaObject = {
  type: "object",
  description: "权益清单的识别结果",
  properties: {
    source: s("套餐或卡的名称"),
    end_date: s("有效期至 YYYY-MM-DD"),
    end_text: s("原文里有效期的原话"),
    store: s("原文里门店的原话"),
    price: n("套餐的售价（元），不是价值、原价"),
    items: {
      type: "array",
      required: true,
      description: "每一项权益",
      items: {
        type: "object",
        description: "一项权益",
        properties: {
          name: s("名称，去掉数量和单位", true),
          kind: s("balance 或 count", true),
          total: n("balance 的金额，或 count 的张数、次数", true),
          unit: s("单位"),
          note: s("使用条件"),
          policy_service: { type: "boolean", required: true, description: "道路救援、代驾等车险保单自带的服务" },
        },
      },
    },
    note: s("其他需要说明的情况"),
  },
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "")
const numOr = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(Number(v)) ? Number(v) : null)

/** 保单自带的服务：模型没认出时按名称再认一次 */
const POLICY_SERVICE = /救援|代驾|代为驾驶|安全检测|送检/

/** 两种接口返回的结果整理成同一种形式；名称为空、数量不对的项去掉 */
export function parsePerkScan(raw: unknown): PerkScan {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const items: PerkScanItem[] = []
  for (const it of Array.isArray(o.items) ? o.items : []) {
    const x = (it && typeof it === "object" ? it : {}) as Record<string, unknown>
    const name = text(x.name)
    if (!name) continue
    const kind: PerkScanKind = x.kind === "balance" ? "balance" : "count"
    const total = numOr(x.total)
    if (kind === "balance" && !(total != null && total > 0)) continue
    items.push({
      name, kind,
      total: kind === "balance" ? total! : total != null && total > 0 ? total : 1,
      unit: kind === "balance" ? "元" : text(x.unit) || "次",
      note: text(x.note),
      policy_service: x.policy_service === true || POLICY_SERVICE.test(name),
    })
  }
  const end = text(o.end_date)
  const price = numOr(o.price)
  return {
    source: text(o.source), end_date: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null, end_text: text(o.end_text), store: text(o.store),
    price: price != null && price > 0 ? price : null, items, note: text(o.note),
  }
}

/** 识别出的一项在「添加权益」里的样子：默认勾不勾、橙色的说明 */
export type ScanPick = PerkScanItem & { on: boolean; warn: string }

/** 保单自带的服务、和这一批已有的同名的默认不勾，写明原因 */
export function scanPicks(scan: PerkScan, existingNames: string[]): ScanPick[] {
  const have = new Set(existingNames.map(normalizeName))
  return scan.items.map(it => {
    if (it.policy_service) return { ...it, on: false, warn: "保单自带的服务，在保单详情里" }
    if (have.has(normalizeName(it.name))) return { ...it, on: false, warn: "已有，可能重复" }
    return { ...it, on: true, warn: "" }
  })
}
