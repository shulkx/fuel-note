// 权益几页共用的部件（权益设计第 6 节，画布第九轮）：一张卡的一行、组头、图标和颜色、有效期的写法，以及几页共用的动作。
// 页面之间不形成循环导入：要推入上层页面（保单详情、一批）时由上一层用 render prop 传进来。
import { DynamicShapeStyle, HStack, Image, RoundedRectangle, Spacer, Text, VStack, ZStack } from "scripting"
import { AppData, daysLeft, kindText, Perk, perkAmount, PerkGroup, PerkOrigin, PerkUse, policyDate, Store, yearInsurer, yearPeriod } from "../common/model"

/** 几页共用的动作（pages/app.tsx 实现）。只传 id，动作里按 id 从 getData() 重新取，不依赖推入页手里的旧对象 */
export type BenefitActions = {
  getData: () => AppData
  /** 添加一批；yearId：从保单详情「赠送」一行打开时预选那一年的车险 */
  addPerks: (yearId: string | null) => void
  /** 编辑一张卡（弹出编辑权益，保存即生效） */
  editPerk: (id: string) => void
  /** 删除一张卡（先确认）；删了返回 true */
  removePerk: (id: string) => Promise<boolean>
  /** 编辑一批：来自的名称、有效期、门店、原文写进每一张卡 */
  editBatch: (key: string) => void
  /** 给一批添加一项（弹出添加一项，保存即写进账本） */
  addToBatch: (key: string) => void
  /** 删除一批（先确认）；删了返回 true */
  removeBatch: (key: string) => Promise<boolean>
  /** 记一次使用（半屏）；use 是要修改的那一次，新记时 null */
  useOnce: (perkId: string, use: PerkUse | null) => void
  removeUse: (use: PerkUse) => void
  /** 用于记费用：打开记费用，勾上这一张 */
  useInExpense: (perkId: string) => void
  /** 打开某一刻的费用（记在费用上的使用） */
  openExpense: (ts: number) => void
  /** 选择门店页里新建、修改、删除门店（直接写进账本） */
  stores: StoreActions
}

export type StoreActions = {
  save: (s: Store) => Store
  remove: (id: string) => void
}

/** 来自的颜色：车险赠送青色、套餐橙色、其他灰色（与画布第九轮相同；白色图标在上面对比度都够） */
export const ORIGIN_COLORS: Record<PerkOrigin, DynamicShapeStyle> = {
  insurance: { light: "#0A84A0", dark: "#2AA9C4" },
  package: { light: "#C2410C", dark: "#E07B1A" },
  other: { light: "#6C6C70", dark: "#636366" },
}
export const EXPIRING: DynamicShapeStyle = { light: "#C2410C", dark: "#FB923C" }

/** 一张卡的图标：储值是卡片，按张算的（抵用券）是票券，套餐里的是盒子，其余是礼物 */
export function perkIcon(p: Perk): string {
  if (p.kind === "balance") return "creditcard.fill"
  if (p.unit === "张") return "ticket.fill"
  return p.origin === "package" ? "shippingbox.fill" : "gift.fill"
}

/** 圆角方块里的白色图标 */
export function IconTile({ icon, color }: { icon: string; color: DynamicShapeStyle }) {
  return <ZStack frame={{ width: 30, height: 30 }}>
    <RoundedRectangle cornerRadius={8} fill={color} />
    <Image systemName={icon} font="footnote" foregroundStyle="white" />
  </ZStack>
}

/** 一张卡的一行：图标、名称、类型（储值、次数），右边是剩余；right 可以换成别的字（「已用完」「过期未用 · 剩 …」） */
export function PerkRow({ perk, left, right, sub }: { perk: Perk; left: number; right?: string; sub?: string }) {
  return <HStack spacing={12} foregroundStyle="label">
    <IconTile icon={perkIcon(perk)} color={ORIGIN_COLORS[perk.origin]} />
    <VStack alignment="leading" spacing={1}>
      <Text lineLimit={1}>{perk.name}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{sub ?? kindText(perk)}</Text>
    </VStack>
    <Spacer />
    {right != null
      ? <Text font="subheadline" foregroundStyle="secondaryLabel">{right}</Text>
      : <Text font="headline">{perkAmount(perk, left)}</Text>}
  </HStack>
}

/** 用完、过期的卡右边的字；可用的返回 undefined（显示剩余） */
export function stateText(p: Perk, left: number, now: number): string | undefined {
  if (left <= 0) return "已用完"
  if (p.end_ts != null && p.end_ts < now) return `过期未用 · 剩 ${perkAmount(p, left)}`
  return undefined
}

/** 有效期的写法：车险赠送「2026/1/7 – 2027/1/6 · 还有 76 天」，其余「至 2028/9/23 · 还有 701 天」「不限期」 */
export function periodLine(end: number | null, year: { start: number } | null, now: number): string {
  if (end == null) return "不限期"
  const left = daysLeft(end, now)
  const range = year ? `${policyDate(year.start)} – ${policyDate(end)}` : `至 ${policyDate(end)}`
  return `${range} · ${left >= 0 ? `还有 ${left} 天` : "已过期"}`
}

/** 组头第二行：保险公司 · 门店 · 至 日期 */
export function groupSubtitle(g: Pick<PerkGroup, "year" | "store" | "end">): string {
  return [g.year ? yearInsurer(g.year) : "", g.store, g.end != null ? `至 ${policyDate(g.end)}` : ""].filter(Boolean).join(" · ")
}

/** 这一年保险的期间开始（车险赠送的有效期写法用） */
export const yearStart = (y: PerkGroup["year"]) => (y ? yearPeriod(y) : null)

/** 组头：标题和第二行；快到期时第二行换成橙色的提示（「1月6日到期 · 5 项未使用」） */
export function GroupHeader({ title, subtitle, note }: { title: string; subtitle: string; note: string | null }) {
  return <VStack alignment="leading" spacing={2} foregroundStyle="label">
    <Text font="headline">{title}</Text>
    <Text font="caption" foregroundStyle={note ? EXPIRING : "secondaryLabel"} lineLimit={1}>{note ?? subtitle}</Text>
  </VStack>
}
