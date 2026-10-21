// 「保障」标签（设计文档 20.3、20.6 节，画布「保险和权益放在新标签页『保障』」）：当前保单和报案、历年保险、只记了金额的保险费用。
// 1.6 起加「权益」一组。左上角车辆菜单，右上角「+」记保险。
import { Button, ContentUnavailableView, HStack, Image, List, NavigationStack, ProgressView, Section, Spacer, Text, VStack } from "scripting"
import {
  AppData, amountOnlyExpenses, changeText, composition, currentInsurance, currentVehicle, daysLeft, ExpenseRecord, fmtDate, insuranceYears, InsuranceYear,
  LedgerRecord, periodText, policyFilePath, vehicleRecords, yearGaps, yearInsurer, yearMark, yearOf, yearPeriod, yearPhone, yearTotal,
} from "../common/model"
import { AMOUNT_ONLY, compositionParts, GREEN, MarkBadge, ORANGE, SegmentBar, yuan } from "./insurance_parts"
import { VehicleMenu, VehicleMenuActions } from "./vehicle_menu"

export type CoverageActions = {
  /** 记保险；link 是「只有金额」的那笔费用（补充保单） */
  addInsurance: (link: (ExpenseRecord & LedgerRecord) | null) => void
  openInsurance: (y: InsuranceYear) => void
}

/**
 * 卡片下面的按钮：各占一半宽，图标和文字挨在一起、居中。
 * 直接用 title + systemImage 时，frame 把标签撑宽，图标留在左边、文字居中，中间空出一截；frame 放在按钮上时底色只包住内容，所以放在里面这组上
 */
function CardButton({ icon, title, action }: { icon: string; title: string; action: () => void }) {
  return <Button action={action} buttonStyle="bordered">
    <HStack spacing={6} frame={{ maxWidth: "infinity" }}>
      <Image systemName={icon} />
      <Text>{title}</Text>
    </HStack>
  </Button>
}

/**
 * 当前保单：左边是交强险标志徽章（画布「交强险标志」，轻点全屏显示标志原件），保险公司、实付、期间和剩余天数，进度；
 * 报案、保单原件两个按钮（一行里有多个按钮，每个都要指定 buttonStyle）
 */
function CurrentPolicy({ year, now, open }: { year: InsuranceYear; now: number; open: () => void }) {
  const p = yearPeriod(year)
  const left = p ? daysLeft(p.end, now) : null
  const elapsed = p ? Math.min(1, Math.max(0, (now - p.start) / (p.end - p.start))) : 0
  const phone = yearPhone(year)
  const files = year.policies.map(x => x.file).filter((f): f is string => !!f)
  const mark = yearMark(year)
  const markFile = mark?.file ?? null
  return <VStack alignment="leading" spacing={12}>
    <HStack spacing={14}>
      {mark && markFile
        ? <Button action={() => QuickLook.previewURLs([policyFilePath(markFile)])} buttonStyle="plain"><MarkBadge end={mark.end} now={now} size={72} /></Button>
        : mark ? <MarkBadge end={mark.end} now={now} size={72} /> : null}
      <Button action={open} buttonStyle="plain">
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={3}>
            <Text font="subheadline" foregroundStyle="secondaryLabel">{yearInsurer(year) || "保险"}</Text>
            <Text font="title2" fontWeight="bold">{yuan(yearTotal(year))}</Text>
            <Text font="caption" foregroundStyle={left != null && left < 0 ? ORANGE : "secondaryLabel"}>
              {`${periodText(p)}${left == null ? "" : left >= 0 ? ` · 还有 ${left} 天` : ` · 已到期 ${-left} 天`}`}
            </Text>
          </VStack>
          <Spacer />
          <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </HStack>
    <ProgressView value={elapsed} total={1} progressViewStyle="linear" tint={GREEN} />
    <HStack spacing={10}>
      {phone ? <CardButton icon="phone" title={`报案 ${phone}`} action={() => Safari.openURL(`tel:${phone}`)} /> : null}
      {files.length ? <CardButton icon="doc.text" title={`保单 ${files.length} 份`} action={() => QuickLook.previewURLs(files.map(policyFilePath))} /> : null}
    </HStack>
  </VStack>
}


function YearRow({ year, prev, max, open }: { year: InsuranceYear; prev: InsuranceYear | null; max: number; open: () => void }) {
  const total = yearTotal(year)
  const up = prev ? total > yearTotal(prev) * 1.1 : false
  return <Button action={open}>
    <VStack alignment="leading" spacing={7} foregroundStyle="label">
      <HStack>
        <Text font="headline">{String(yearOf(year))}</Text>
        <Text foregroundStyle="secondaryLabel">{yearInsurer(year)}</Text>
        <Spacer />
        <Text>{yuan(total)}</Text>
      </HStack>
      <HStack spacing={10}>
        <SegmentBar parts={compositionParts(composition(year))} max={max} />
        {prev ? <Text font="caption" foregroundStyle={up ? ORANGE : "secondaryLabel"}>{changeText(total, yearTotal(prev))}</Text> : null}
      </HStack>
    </VStack>
  </Button>
}

export function CoveragePage({ data, vehicleActions, actions }: { data: AppData; vehicleActions: VehicleMenuActions; actions: CoverageActions }) {
  const vehicle = currentVehicle(data)
  const now = Date.now()
  const years = vehicle ? insuranceYears(data.ledger.insurance, vehicle.id) : []
  const amountOnly = vehicle ? amountOnlyExpenses(vehicleRecords(data, vehicle), years) : []
  const gaps = yearGaps(years, amountOnly)
  const current = currentInsurance(years, now) ?? years[0] ?? null
  const max = Math.max(1, ...years.map(yearTotal), ...amountOnly.map(r => r.amount))
  const sum = years.reduce((s, y) => s + yearTotal(y), 0) + amountOnly.reduce((s, r) => s + r.amount, 0)
  // 年份和缺的年份按年份从新到旧排在一起
  const rows: Array<{ year: number; item: InsuranceYear | null }> = [
    ...years.map(y => ({ year: yearOf(y), item: y })),
    ...gaps.map(g => ({ year: g, item: null })),
  ].sort((a, b) => b.year - a.year)

  const toolbar = {
    topBarLeading: <VehicleMenu data={data} actions={vehicleActions} />,
    ...(vehicle ? { topBarTrailing: <Button title="记保险" systemImage="plus" action={() => actions.addInsurance(null)} /> } : {}),
  }
  const empty = !vehicle
    ? <ContentUnavailableView title="还没有车辆" systemImage="car" description="点左上角的车辆按钮添加车辆。" />
    : !years.length && !amountOnly.length
      ? <ContentUnavailableView title="还没有保险记录" systemImage="checkmark.shield" description="点右上角的「+」，选择保单 PDF 记下这一年的保险。" />
      : null

  return <NavigationStack>
    <List
      navigationTitle="保障"
      {...(vehicle ? { navigationSubtitle: vehicle.name } : {})}
      toolbar={toolbar}
      {...(empty ? { overlay: empty } : {})}
    >
      {current ? <Section
        key="current"
        header={<Text>{current === currentInsurance(years, now) ? "当前保单" : "最近的保单"}</Text>}
        {...(yearMark(current)?.file ? { footer: <Text>轻点标志，全屏显示交强险标志原件。</Text> } : {})}
      >
        <CurrentPolicy year={current} now={now} open={() => actions.openInsurance(current)} />
      </Section> : null}

      {rows.length ? <Section
        key="years"
        header={<HStack><Text>历年保险</Text><Spacer /><Text>{`共 ${yuan(sum)}`}</Text></HStack>}
        footer={<Text>按保险期间开始的年份排列，点一年查看保单。保费在付款当天计入花费。</Text>}
      >
        {rows.map(r => r.item
          ? <YearRow key={r.item.id} year={r.item} prev={years.find(y => yearOf(y) === r.year - 1) ?? null} max={max} open={() => actions.openInsurance(r.item!)} />
          : <HStack key={`gap${r.year}`}>
            <Text font="headline" foregroundStyle="secondaryLabel">{String(r.year)}</Text>
            <Text foregroundStyle="secondaryLabel">没有记录</Text>
            <Spacer />
            <Button title="补记" buttonStyle="borderless" action={() => actions.addInsurance(null)} />
          </HStack>)}
      </Section> : null}

      {amountOnly.length ? <Section key="amount-only" header={<Text>只有金额（费用记录，没有保单）</Text>}>
        {amountOnly.map(r => <VStack key={r.id} alignment="leading" spacing={7}>
          <HStack>
            <Text>{fmtDate(r.ts)}</Text>
            <Text foregroundStyle="secondaryLabel" lineLimit={1}>{r.remark.split("\n")[0]}</Text>
            <Spacer />
            <Text>{yuan(r.amount)}</Text>
          </HStack>
          <HStack spacing={10}>
            <SegmentBar parts={[{ value: r.amount, color: AMOUNT_ONLY }]} max={max} />
            <Button title="补充保单" buttonStyle="borderless" font="caption" action={() => actions.addInsurance(r)} />
          </HStack>
        </VStack>)}
      </Section> : null}
    </List>
  </NavigationStack>
}
