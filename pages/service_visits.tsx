// 养修记录（2.1 设计第 8 节，画布 YsVisits，从费用页「全部养修记录」推入）：「没记」「已记」两组，按进店时间倒排。
// 轻点没记的打开填好的记费用，已记的打开那条记录；没记的不写金额（沃尔沃的自付不一定是实付），已记的写油记里记的金额。
// 已取消的预约不列出；还没结算的单独一组，只显示状态。下拉重新读一次；上次读取失败时顶部写原因。
import { Button, ContentUnavailableView, HStack, Image, List, Section, Spacer, Text } from "scripting"
import { AppData, ServiceView, ServiceVisit, Vehicle, visitState, VisitState, yuan } from "../common/model"
import { VisitRow } from "./service_parts"

export type ServiceActions = {
  /** 打开从这次养修填好的记费用 */
  record: (v: ServiceVisit) => void
  /** 打开一条记录（费用或保养） */
  open: (recordId: string) => void
  /** 下拉：重新读一次 */
  refresh: () => Promise<void>
}

const chevron = <Image systemName="chevron.right" foregroundStyle="tertiaryLabel" font="footnote" />

export function ServiceVisitsPage({ data, vehicle, view, actions }: { data: AppData; vehicle: Vehicle; view: ServiceView; actions: ServiceActions }) {
  const rows = view.visits.map(v => ({ v, s: visitState(data.ledger, vehicle.id, v) }))
  const of = (kind: VisitState["kind"]) => rows.filter(r => r.s.kind === kind)
  const todo = of("todo")
  const done = of("recorded")
  const unsettled = of("unsettled")
  const settled = todo.length + done.length
  return <List
    navigationTitle={view.title}
    navigationSubtitle={settled ? `${settled} 次进店` : ""}
    refreshable={actions.refresh}
    {...(!rows.length && !view.error ? { overlay: <ContentUnavailableView title="还没有读到养修记录" systemImage="wrench.and.screwdriver" description="下拉重新读取。" /> } : {})}
  >
    {view.error ? <Section key="error"><Text foregroundStyle="systemOrange">{`上次读取失败：${view.error}。下面是之前读到的。`}</Text></Section> : null}
    {unsettled.length ? <Section key="unsettled" header={<Text>还没结算</Text>} footer={<Text>结算以后才能记下。</Text>}>
      {unsettled.map(({ v }) => <VisitRow key={v.order_id} visit={v} naming={view.naming} right={null} />)}
    </Section> : null}
    {todo.length ? <Section key="todo" header={<HStack><Text>没记</Text><Spacer /><Text>{`${todo.length} 次`}</Text></HStack>}
      footer={<Text>轻点打开填好的记费用。每张工单都记；保险公司付款、赠送抵扣的工单记 0 元。</Text>}>
      {todo.map(({ v }) => <Button key={v.order_id} action={() => actions.record(v)}>
        <VisitRow visit={v} naming={view.naming} right={chevron} />
      </Button>)}
    </Section> : null}
    {done.length ? <Section key="done" header={<HStack><Text>已记</Text><Spacer /><Text>{`${done.length} 次`}</Text></HStack>}
      footer={<Text>右边是油记里记的金额；进店那几天手动记过的也算已记。取消的预约不列出；2021 年 1 月及更早的工单沃尔沃已不保留。</Text>}>
      {done.map(({ v, s }) => <Button key={v.order_id} action={() => { if (s.kind === "recorded" && s.open) actions.open(s.open) }}>
        <VisitRow visit={v} naming={view.naming} right={<Text monospacedDigit>{s.kind === "recorded" ? yuan(s.amount) : ""}</Text>} />
      </Button>)}
    </Section> : null}
  </List>
}
