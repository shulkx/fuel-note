// 费用 › 记录（设计文档 21.4 节）：最上面是当前保单（1.5 保障页的卡片）和续保提醒；下面是费用，按月分组，月合计只算费用。
// 费用和小熊的保养合成一笔一行（common/expense_stats.ts 的 expenseEntries），保养只算一次。保险行点开是保单详情；
// 保养只能查看，不能左滑删除。下拉同步。只读费用、保养和保险：加油在「油耗」标签（pages/fuel_records.tsx）。
import { Button, ContentUnavailableView, HStack, Image, List, Section, ShapeStyle, Spacer, Text, VStack, useMemo, useState } from "scripting"
import {
  AppData, categoryName, currentInsurance, currentVehicle, ExpenseEntry, expenseEntries, fmtDay, insuranceForRecord, insuranceYears, InsuranceYear, monthDayText,
  monthKey, monthTitle, monthTotals, periodText, renewalDue, vehicleRecords, yearInsurer, yearMark, yearPeriod,
} from "../common/model"
import { km, PendingTag, TabNav, topBar } from "./components"
import { CurrentPolicy, yuan } from "./insurance_parts"

const PAGE = 120

export type ExpenseRecordsActions = {
  /** 打开一笔：保险打开保单详情，保养显示说明，其他费用打开记费用 */
  open: (e: ExpenseEntry) => void
  remove: (e: ExpenseEntry) => void
  sync: () => Promise<void>
  /** 记保险（续保提醒里的按钮） */
  renew: () => void
  openInsurance: (y: InsuranceYear) => void
  dismissRenewal: (y: InsuranceYear) => void
}

/** 续保提醒：到期前 45 天起（设计文档 20.6 节）。「×」本期不再提醒。行内有多个按钮，每个都要指定 buttonStyle */
function RenewalRow({ year, left, onRecord, onDismiss }: { year: InsuranceYear; left: number; onRecord: () => void; onDismiss: () => void }) {
  const p = yearPeriod(year)
  const day = p ? monthDayText(p.end) : ""
  const insurer = yearInsurer(year)
  return <HStack spacing={10}>
    <Button action={onRecord} buttonStyle="plain">
      <HStack spacing={10}>
        <Image systemName="exclamationmark.shield.fill" foregroundStyle="systemOrange" />
        <VStack alignment="leading" spacing={1}>
          <Text font="subheadline" fontWeight="semibold" lineLimit={1}>{left >= 0 ? `车险 ${day}到期` : `车险已于 ${day}到期`}</Text>
          <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{[left >= 0 ? `还有 ${left} 天` : `已过 ${-left} 天`, insurer].filter(Boolean).join(" · ")}</Text>
        </VStack>
      </HStack>
    </Button>
    <Spacer />
    <Button title="记保险" action={onRecord} buttonStyle="borderedProminent" tint="systemOrange" />
    <Button action={onDismiss} buttonStyle="plain">
      <Image systemName="xmark" font="footnote" foregroundStyle="secondaryLabel" />
    </Button>
  </HStack>
}

/** 一笔的一行：左边图标，标题和说明，右边金额 */
function EntryRow({ icon, color, title, detail, amount, pending }: { icon: string; color: ShapeStyle; title: string; detail: string; amount: string; pending: boolean }) {
  return <HStack spacing={12} foregroundStyle="label">
    <Image systemName={icon} foregroundStyle={color} frame={{ width: 24 }} />
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={6}>
        <Text font="body" lineLimit={1}>{title}</Text>
        {pending ? <PendingTag /> : null}
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer />
    <Text font="body" monospacedDigit>{amount}</Text>
  </HStack>
}

/**
 * 一笔费用的一行：
 * - 有保单明细的费用：盾牌图标、「车险 · 中国平安」、付款日期和保险期间；
 * - 保养（小熊的保养记录，和同一时刻的费用合成一行）：「保养 · 第五次保养」、日期 · 里程 · 项目；
 * - 其他费用：类别名、日期和备注
 */
function ExpenseRow({ data, entry, year }: { data: AppData; entry: ExpenseEntry; year: InsuranceYear | null }) {
  const pending = !!(entry.expense?.pending || entry.maintenance?.pending)
  const m = entry.maintenance
  if (year) {
    const insurer = yearInsurer(year)
    return <EntryRow icon="checkmark.shield.fill" color="systemBlue" title={`车险${insurer ? ` · ${insurer}` : ""}`}
      detail={`${fmtDay(entry.ts)} · ${periodText(yearPeriod(year))}`} amount={yuan(entry.amount)} pending={pending} />
  }
  if (m) {
    const name = m.remark.split("\n")[0].trim()
    return <EntryRow icon="wrench.and.screwdriver.fill" color="systemPurple" title={name ? `保养 · ${name}` : "保养"}
      detail={[fmtDay(m.ts), m.odometer > 0 ? km(m.odometer) : "", m.items].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} pending={pending} />
  }
  const e = entry.expense
  return <EntryRow icon="yensign.circle.fill" color="systemBlue" title={categoryName(data, entry.category_id)}
    detail={[fmtDay(entry.ts), e ? e.remark.split("\n")[0] : ""].filter(Boolean).join(" · ")} amount={yuan(entry.amount)} pending={pending} />
}

export function ExpenseRecords({ data, nav, subtitle, actions }: { data: AppData; nav: TabNav; subtitle: string | null; actions: ExpenseRecordsActions }) {
  const vehicle = currentVehicle(data)
  const now = Date.now()
  const [limit, setLimit] = useState(PAGE)
  const entries = useMemo(() => (vehicle ? expenseEntries(vehicleRecords(data, vehicle)) : []), [data, vehicle?.id])
  const totals = useMemo(() => monthTotals(entries), [entries])
  const insurance = data.ledger.insurance
  const years = vehicle ? insuranceYears(insurance, vehicle.id) : []
  const current = currentInsurance(years, now) ?? years[0] ?? null
  const renewal = renewalDue(years, now, data.ledger.settings.dismissed_renewals ?? [])
  const months = useMemo(() => {
    const out: Array<{ key: string; items: ExpenseEntry[] }> = []
    for (const e of entries.slice(0, limit)) {
      const key = monthKey(e.ts)
      let m = out[out.length - 1]
      if (!m || m.key !== key) { m = { key, items: [] }; out.push(m) }
      m.items.push(e)
    }
    return out
  }, [entries, limit])

  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆，或在「设置 › 小熊油耗」连接小熊导入已有数据。" />
    : !entries.length && !current
      ? <ContentUnavailableView title="还没有费用" systemImage="yensign.circle" description="点右上角的「+」记费用；长按可以记保险。" />
      : null

  return <List
    navigationTitle={nav.title}
    {...(subtitle ? { navigationSubtitle: subtitle } : {})}
    refreshable={actions.sync}
    toolbar={nav.toolbar}
    {...topBar(nav)}
    {...(empty ? { overlay: empty } : {})}
  >
    {current ? <Section
      key="current"
      header={<Text>{current === currentInsurance(years, now) ? "当前保单" : "最近的保单"}</Text>}
      {...(yearMark(current)?.file ? { footer: <Text>轻点标志，全屏显示交强险标志原件。</Text> } : {})}
    >
      <CurrentPolicy year={current} now={now} open={() => actions.openInsurance(current)} />
    </Section> : null}
    {renewal ? <Section key="renewal">
      <RenewalRow year={renewal.year} left={renewal.daysLeft} onRecord={actions.renew} onDismiss={() => actions.dismissRenewal(renewal.year)} />
    </Section> : null}
    {months.map(m => <Section key={m.key} header={<HStack><Text>{monthTitle(m.key)}</Text><Spacer /><Text monospacedDigit>{yuan(totals.get(m.key) ?? 0)}</Text></HStack>}>
      {m.items.map(e => <Button
        key={e.id}
        action={() => actions.open(e)}
        {...(e.maintenance ? {} : {
          trailingSwipeActions: {
            allowsFullSwipe: false,
            actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => actions.remove(e)} />],
          },
        })}
      >
        <ExpenseRow data={data} entry={e} year={e.expense ? insuranceForRecord(insurance, e.expense.id) : null} />
      </Button>)}
    </Section>)}
    {entries.length > limit ? <Section><Button title={`显示更早的记录（还有 ${entries.length - limit} 条）`} action={() => setLimit(limit + PAGE)} /></Section> : null}
  </List>
}
