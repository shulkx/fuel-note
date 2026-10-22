// 保险页的历年保单（设计文档 20.6、22.7 节，画布「第七轮 · 1.6」）：正在保障的那一年展开成卡片，其余每年一行（合计、构成、比上一年的变化）；
// 中间缺的年份；小熊里只记了金额的车险费用（可以补充保单、编辑、删除，它们不在费用页）。1.6.0-beta.4 起在保险页（pages/insurance_tab.tsx）。
import { Button, HStack, Section, Spacer, Text, VirtualNode, VStack } from "scripting"
import {
  AppData, amountOnlyExpenses, currentInsurance, currentVehicle, ExpenseRecord, fmtDate, insuranceYears, InsuranceYear, LedgerRecord, vehicleRecords, yearGaps,
  yearMark, yearOf, yearPeriod, yearTotal,
} from "../common/model"
import { swipeToDelete } from "./components"
import { AMOUNT_ONLY, CurrentPolicy, SegmentBar, YearRow, yuan } from "./insurance_parts"

export type InsuranceHistoryActions = {
  /** 记保险；link 是「只有金额」的那笔费用（补充保单） */
  addInsurance: (link: (ExpenseRecord & LedgerRecord) | null) => void
  /** 推入保单详情 */
  openInsurance: (y: InsuranceYear) => void
  /** 「只有金额」的那笔费用：打开记费用编辑它，或删除 */
  editExpense: (r: ExpenseRecord & LedgerRecord) => void
  removeExpense: (r: ExpenseRecord & LedgerRecord) => void
}

/**
 * 展开成卡片的那一年：正在保障的那一年；都已到期时是最近的一年（同 1.5 的「最近的保单」）。
 * 下一年已经记下、还没开始时，卡片仍是正在保障的这一年，下一年排在它上面一行
 */
export function cardYear(years: InsuranceYear[], now: number): InsuranceYear | null {
  return currentInsurance(years, now) ?? years.find(y => (yearPeriod(y)?.start ?? 0) <= now) ?? years[0] ?? null
}

/** 两组：历年保单（含缺的年份）、只有金额；没有保险记录时为空 */
export function insuranceHistorySections(data: AppData, actions: InsuranceHistoryActions, now: number): VirtualNode[] {
  const vehicle = currentVehicle(data)
  if (!vehicle) return []
  const insurance = insuranceYears(data.ledger.insurance, vehicle.id)
  const amountOnly = amountOnlyExpenses(vehicleRecords(data, vehicle), insurance)
  const gaps = yearGaps(insurance, amountOnly)
  const max = Math.max(1, ...insurance.map(yearTotal), ...amountOnly.map(r => r.amount))
  const card = cardYear(insurance, now)
  const prevOf = (year: number) => insurance.find(y => yearOf(y) === year - 1) ?? null
  const rows: Array<{ year: number; item: InsuranceYear | null }> = [
    ...insurance.map(y => ({ year: yearOf(y), item: y })),
    ...gaps.map(g => ({ year: g, item: null })),
  ].sort((a, b) => b.year - a.year)
  const out: VirtualNode[] = []
  if (rows.length) {
    const notes = [
      "按保险期间开始的年份排列，金额是保单合计减去优惠，右边是比上一年的变化。点一年查看保单。",
      card && yearMark(card)?.file ? "轻点标志，全屏显示交强险标志原件。" : "",
    ]
    out.push(<Section key="insurance" header={<HStack><Text>历年保单</Text><Spacer /><Text>{`${insurance.length} 年`}</Text></HStack>} footer={<Text>{notes.join("")}</Text>}>
      {rows.map(r => {
        const y = r.item
        if (!y) {
          return <HStack key={`gap${r.year}`}>
            <Text font="headline" foregroundStyle="secondaryLabel">{String(r.year)}</Text>
            <Text foregroundStyle="secondaryLabel">没有记录</Text>
            <Spacer />
            <Button title="补记" buttonStyle="borderless" action={() => actions.addInsurance(null)} />
          </HStack>
        }
        return y === card
          ? <CurrentPolicy key={y.id} year={y} prev={prevOf(r.year)} max={max} now={now} open={() => actions.openInsurance(y)} />
          : <YearRow key={y.id} year={y} prev={prevOf(r.year)} max={max} open={() => actions.openInsurance(y)} />
      })}
    </Section>)
  }
  if (amountOnly.length) {
    out.push(<Section key="amount-only" header={<Text>只有金额（费用记录，没有保单）</Text>} footer={<Text>小熊里只记了金额的车险。轻点修改这笔费用，左滑删除；「补充保单」导入这一年的保单。</Text>}>
      {amountOnly.map(r => <VStack
        key={r.id}
        alignment="leading"
        spacing={7}
        trailingSwipeActions={swipeToDelete(() => actions.removeExpense(r))}
      >
        <Button action={() => actions.editExpense(r)} buttonStyle="plain">
          <HStack foregroundStyle="label">
            <Text>{fmtDate(r.ts)}</Text>
            <Text foregroundStyle="secondaryLabel" lineLimit={1}>{r.remark.split("\n")[0]}</Text>
            <Spacer />
            <Text>{yuan(r.amount)}</Text>
          </HStack>
        </Button>
        <HStack spacing={10}>
          <SegmentBar parts={[{ value: r.amount, color: AMOUNT_ONLY }]} max={max} />
          <Button title="补充保单" buttonStyle="borderless" font="caption" action={() => actions.addInsurance(r)} />
        </HStack>
      </VStack>)}
    </Section>)
  }
  return out
}
