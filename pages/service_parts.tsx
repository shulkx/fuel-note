// 养修页面共用的部件（2.1 设计第 8 节，画布第十五轮）：一次进店的一行、来源一行、沃尔沃结算一组。
import { DynamicShapeStyle, HStack, Image, Section, Spacer, Text, VirtualNode, VStack } from "scripting"
import { BJ_OFFSET, prefLabel, ServiceTicket, ServiceVisit, settlementOf, TicketNaming, visitItems, visitTitle, yuan } from "../common/model"
import { km } from "./components"

/** 维修保养的颜色（同费用页、费用统计） */
const MAINTENANCE_COLOR: DynamicShapeStyle = { light: "#AF52DE", dark: "#BF5AF2" }

/** 「2026/4/3」（北京时间） */
export function serviceDay(ts: number): string {
  const d = new Date(ts + BJ_OFFSET)
  return `${d.getUTCFullYear()}/${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** 第二行：到店里程 · 保养项目（没有保养工单时写工单的项目名） */
export function visitSub(v: ServiceVisit, naming: TicketNaming): string {
  const items = visitItems(v.tickets.filter(t => t.type === "保养"), naming).items.map(i => i.name)
  const what = items.length ? items.join("、") : v.tickets.flatMap(t => t.projects).join("、")
  return [v.odometer ? km(v.odometer) : "", what].filter(Boolean).join(" · ")
}

/** 一次进店的一行：扳手图标（维修保养的颜色）、日期 · 叫法、第二行里程和项目，右边由调用方给（「记下」、金额、箭头） */
export function VisitRow({ visit, naming, right }: { visit: ServiceVisit; naming: TicketNaming; right: VirtualNode | null }) {
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName="wrench.and.screwdriver.fill" foregroundStyle={MAINTENANCE_COLOR} frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <Text font="body">{`${serviceDay(visit.arrive_ts)} · ${visit.tickets.length ? visitTitle(visit) : visit.state}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{visit.tickets.length ? visitSub(visit, naming) : visit.dealer?.short ?? ""}</Text>
    </VStack>
    <Spacer />
    {right}
  </HStack>
}

/** 表单最上面：这次是从哪一次养修填的 */
export function SourceRow({ title, arrive, tickets, dealer }: { title: string; arrive: number; tickets: number; dealer: string }) {
  return <HStack spacing={12}>
    <Image systemName="list.clipboard" foregroundStyle="accentColor" font="title3" />
    <VStack alignment="leading" spacing={2}>
      <Text>{`来自${title}`}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{[`${serviceDay(arrive)} 到店`, `工单 ${tickets} 张`, dealer].filter(Boolean).join(" · ")}</Text>
    </VStack>
  </HStack>
}

function MoneyLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <HStack>
    <Text>{label}</Text>
    <Spacer />
    <Text {...(strong ? { font: "headline" } : {})}>{value}</Text>
  </HStack>
}

const minus = (n: number) => `−${yuan(n)}`

/** 沃尔沃结算一组（只读）：原价、工时优惠、其他减免、每一条券和活动优惠、抹零、自付，下面是结算备注 */
export function SettlementSection({ title, tickets, note }: { title: string; tickets: ServiceTicket[]; note: string }) {
  const s = settlementOf(tickets)
  return <Section key="settlement" header={<HStack><Text>{title}</Text><Spacer /><Text>{`工单 ${tickets.length} 张`}</Text></HStack>}
    footer={<Text>{[note, s.remark ? `结算备注：${s.remark}` : ""].filter(Boolean).join("")}</Text>}>
    <MoneyLine label="原价" value={yuan(s.total)} />
    {s.labour_discount ? <MoneyLine label="工时优惠" value={minus(s.labour_discount)} /> : null}
    {s.discounts.map((d, i) => <MoneyLine key={`d${i}`} label={d.name} value={minus(d.amount)} />)}
    {s.prefs.map((p, i) => <MoneyLine key={`p${i}`} label={prefLabel(p.name)} value={minus(p.amount)} />)}
    {s.rounding ? <MoneyLine label="抹零" value={s.rounding > 0 ? minus(s.rounding) : `+${yuan(-s.rounding)}`} /> : null}
    <MoneyLine label="自付" value={yuan(s.own)} strong />
  </Section>
}
