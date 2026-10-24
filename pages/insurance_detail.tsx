// 一年的保单详情（设计文档 20.6、22.8 节）：实付和构成、保险期间、各险种与上一年对比、保单号、原件、报案电话。
// 1.6.0-beta.4 起是保险页推入的一页（1.5 是半屏弹出）：左上角返回，右上角编辑（弹出记保险），最下面删除，删除后回到保险页。
// 返回用 EnvironmentValuesReader 的 dismiss；Navigation.useDismiss 关的是最外层弹出的页面，也就是整个油记。
import { Button, ContentUnavailableView, EnvironmentValuesReader, HStack, Image, List, NavigationLink, ProgressView, Section, Spacer, Text, VirtualNode, VStack, useState } from "scripting"
import {
  amountText, AppData, catalogEntry, changeText, composition, daysLeft, fileCountText, floatText, fmtDate, giftLine, InsuranceYear, insuranceYears,
  isImageFile, itemCompare, ItemPrev, KIND_TITLES, markLook, periodText, perkBook, Policy, policyFilePath, PolicyItem, previousInsurance,
  yearFiles, yearInsurer, yearLabel, yearOf, yearPeriod, yearPhone, yearTotal, yuan,
} from "../common/model"
import { compositionParts, CompositionLegend, GREEN, MarkBadge, ORANGE, SegmentBar } from "./insurance_parts"

export type InsuranceDetailActions = {
  /** 打开记保险表单编辑这一年 */
  edit: (y: InsuranceYear) => Promise<void>
  /** 删除（问只删明细还是连费用一起）；删了返回 true */
  remove: (y: InsuranceYear) => Promise<boolean>
  /** 对应的费用找不到时重新记一笔 */
}

/** 限额类的险种写「限额」，其余写「保额」 */
const LIMIT_KEYS = new Set(["third_party", "holiday_double", "med_extra", "seat_driver", "seat_passenger", "cargo", "mental"])

function itemTitle(i: PolicyItem): string {
  return (i.key && catalogEntry(i.key)?.short) || i.name
}

function itemSub(i: PolicyItem, prev: ItemPrev | undefined): string {
  const label = i.key && LIMIT_KEYS.has(i.key) ? "限额" : "保额"
  const now = i.amount != null ? `${label} ${amountText(i.amount)}` : i.amount_text
  const before = prev && prev.amount != null ? `去年 ${amountText(prev.amount)}` : ""
  return [now, before].filter(Boolean).join(" · ")
}

function ItemRow({ item, prev }: { item: PolicyItem; prev: ItemPrev | undefined }) {
  const legacy = item.key && catalogEntry(item.key)?.group === "legacy"
  const sub = itemSub(item, prev)
  return <HStack>
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={6}>
        <Text>{itemTitle(item)}</Text>
        {legacy ? <Text font="caption2" foregroundStyle="secondaryLabel">改革前条款</Text> : null}
      </HStack>
      {sub ? <Text font="caption" foregroundStyle="secondaryLabel">{sub}</Text> : null}
    </VStack>
    <Spacer />
    <VStack alignment="trailing" spacing={3}>
      {item.premium != null ? <Text>{yuan(item.premium)}</Text> : null}
      {prev && prev.premium != null ? <Text font="caption" foregroundStyle="secondaryLabel">{`去年 ${yuan(prev.premium)}`}</Text> : null}
    </VStack>
  </HStack>
}

/** 增值服务合成一行：「道路救援 12 次 · 代为驾驶 1 次」（「/」表示没有，不列） */
function servicesText(items: PolicyItem[]): string {
  return items
    .filter(i => i.key && catalogEntry(i.key)?.group === "service" && i.amount_text !== "/")
    .map(i => `${itemTitle(i)}${i.times != null ? ` ${i.times} 次` : ""}`)
    .join(" · ")
}

function Issues({ policy }: { policy: Policy }) {
  return policy.issues.length ? <Text font="footnote" foregroundStyle={ORANGE}>{policy.issues.join("\n")}</Text> : null
}

/** 这一年的赠送（1.7，权益设计第 5 节）：有赠送时列出名称和使用情况，轻点推入这一批；还没有时「添加」，打开添加权益并预选这一年 */
type Gift = { names: string; status: string; page: VirtualNode } | { add: () => void }

function CommercialSection({ policy, cmp, gift }: { policy: Policy; cmp: Map<string, ItemPrev>; gift: Gift | null }) {
  const rows = policy.items.filter(i => !(i.key && catalogEntry(i.key)?.group === "service"))
  const services = servicesText(policy.items)
  return <Section header={<HStack><Text>商业险</Text><Spacer /><Text>{yuan(policy.premium)}</Text></HStack>}
    {...(gift ? { footer: <Text>{"page" in gift ? "点「赠送」查看这一批的剩余。保单自带的服务只读。" : "保单自带的服务只读；销售另外送的东西在「赠送」里添加。"}</Text> } : {})}>
    {rows.map((i, n) => <ItemRow key={String(n)} item={i} prev={i.key ? cmp.get(i.key) : undefined} />)}
    {services ? <VStack alignment="leading" spacing={3}>
      <Text>服务</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{services}</Text>
    </VStack> : null}
    {gift && "page" in gift ? <NavigationLink destination={gift.page}>
      <HStack spacing={10}>
        <VStack alignment="leading" spacing={3}>
          <Text>赠送</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">{gift.names}</Text>
        </VStack>
        <Spacer />
        <Text foregroundStyle="secondaryLabel">{gift.status}</Text>
      </HStack>
    </NavigationLink> : null}
    {gift && "add" in gift ? <Button action={gift.add}>
      <HStack foregroundStyle="label">
        <Text>赠送</Text>
        <Spacer />
        <Image systemName="plus" foregroundStyle="accentColor" />
        <Text foregroundStyle="accentColor">添加</Text>
      </HStack>
    </Button> : null}
    {!rows.length && !services ? <Text foregroundStyle="secondaryLabel">没有险种明细</Text> : null}
    <Issues policy={policy} />
  </Section>
}

function CompulsorySection({ policy, prev }: { policy: Policy; prev: Policy | null }) {
  const vt = policy.vehicle_tax ?? 0
  const rateNow = policy.float_rate != null ? `浮动比率 ${floatText(policy.float_rate)}` : ""
  const rateBefore = prev && prev.float_rate != null ? `去年 ${floatText(prev.float_rate)}` : ""
  return <Section header={<HStack><Text>交强险和车船税</Text><Spacer /><Text>{yuan(policy.premium + vt)}</Text></HStack>}>
    <HStack>
      <VStack alignment="leading" spacing={3}>
        <Text>交强险</Text>
        {rateNow || rateBefore ? <Text font="caption" foregroundStyle="secondaryLabel">{[rateNow, rateBefore].filter(Boolean).join(" · ")}</Text> : null}
      </VStack>
      <Spacer />
      <VStack alignment="trailing" spacing={3}>
        <Text>{yuan(policy.premium)}</Text>
        {prev ? <Text font="caption" foregroundStyle="secondaryLabel">{`去年 ${yuan(prev.premium)}`}</Text> : null}
      </VStack>
    </HStack>
    {policy.vehicle_tax != null ? <HStack>
      <Text>代收车船税</Text>
      <Spacer />
      <VStack alignment="trailing" spacing={3}>
        <Text>{yuan(vt)}</Text>
        {prev && prev.vehicle_tax != null ? <Text font="caption" foregroundStyle="secondaryLabel">{`去年 ${yuan(prev.vehicle_tax)}`}</Text> : null}
      </VStack>
    </HStack> : null}
    <Issues policy={policy} />
  </Section>
}

function OtherSection({ policy }: { policy: Policy }) {
  const splitLess = policy.items.length > 0 && policy.items.every(i => i.premium == null)
  return <Section
    header={<HStack><Text>{KIND_TITLES[policy.kind]}</Text><Spacer /><Text>{yuan(policy.premium)}</Text></HStack>}
    {...(splitLess ? { footer: <Text>这份保单只写总保费，不拆分到各项。</Text> } : {})}
  >
    <VStack alignment="leading" spacing={3}>
      <Text>{policy.title || KIND_TITLES[policy.kind]}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel">{periodText({ start: policy.start_ts, end: policy.end_ts })}</Text>
    </VStack>
    {policy.items.map((i, n) => <HStack key={String(n)}>
      <Text>{itemTitle(i)}</Text>
      <Spacer />
      <Text foregroundStyle="secondaryLabel">{i.amount != null ? amountText(i.amount) : i.amount_text}</Text>
    </HStack>)}
    <Issues policy={policy} />
  </Section>
}

const KIND_ORDER: Record<Policy["kind"], number> = { commercial: 0, compulsory: 1, accident: 2, other: 3 }

/** 「保单」一组交强险下面的标志（画布「交强险标志」第 2 张）：小徽章、到期年月，轻点全屏显示原件 */
function MarkRow({ policy, file, now }: { policy: Policy; file: string; now: number }) {
  const look = markLook(policy.end_ts, now)
  return <Button action={() => QuickLook.previewURLs([policyFilePath(file)])}>
    <HStack spacing={12} foregroundStyle="label">
      <MarkBadge end={policy.end_ts} now={now} size={36} label={false} />
      <VStack alignment="leading" spacing={2}>
        <Text>交强险标志</Text>
        <Text font="caption" foregroundStyle="secondaryLabel">{`${look.year} 年 ${look.month} 月到期${isImageFile(file) ? " · 图片" : ""}`}</Text>
      </VStack>
      <Spacer />
      <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
    </HStack>
  </Button>
}

export function InsuranceDetail({ get, yearId, actions, giftPage, addGift }: {
  get: () => AppData
  yearId: string
  actions: InsuranceDetailActions
  /** 「赠送」一行推入的这一批（1.7）；不传时没有这一行 */
  giftPage?: (key: string) => VirtualNode
  /** 还没有赠送时「添加」：打开添加权益并预选这一年，保存后返回 */
  addGift?: (yearId: string) => Promise<void>
}) {
  const [data, setData] = useState<AppData>(get)
  const year = data.ledger.insurance.find(y => y.id === yearId)
  const refresh = () => setData(get())

  if (!year) {
    return <List navigationTitle="保险" navigationBarTitleDisplayMode="inline" overlay={<ContentUnavailableView title="这一年的保险已删除" systemImage="checkmark.shield" />}>
    </List>
  }

  const now = Date.now()
  const years = insuranceYears(data.ledger.insurance, year.vehicle_id)
  const prev = previousInsurance(years, year)
  const cmp = itemCompare(year, prev)
  const total = yearTotal(year)
  const comp = composition(year)
  const period = yearPeriod(year)
  const left = period ? daysLeft(period.end, now) : null
  const elapsed = period ? Math.min(1, Math.max(0, (now - period.start) / (period.end - period.start))) : 0
  const phone = yearPhone(year)
  const files = yearFiles(year)
  const policies = [...year.policies].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
  const prevOf = (p: Policy) => prev?.policies.find(x => x.kind === p.kind) ?? null
  const line = giftPage ? giftLine(perkBook(data.ledger), year) : null
  const gift: Gift | null = line && giftPage
    ? { names: line.names, status: line.status, page: giftPage(line.key) }
    : giftPage && addGift ? { add: () => { void addGift(year.id).then(refresh) } } : null

  let change: { text: string; up: boolean } | null = null
  if (prev) {
    const d = total - yearTotal(prev)
    change = { text: `比 ${yearOf(prev)} 年（${yearInsurer(prev)}）${d >= 0 ? "多" : "少"} ${yuan(Math.abs(d))} · ${changeText(total, yearTotal(prev))}`, up: total > yearTotal(prev) * 1.1 }
  }

  async function copy(no: string) {
    await Pasteboard.setString(no)
    await Dialog.alert({ title: "已复制保单号", message: no })
  }

  /** 删了以后回到保险页（goBack 来自 EnvironmentValuesReader，只返回上一页） */
  async function remove(goBack: () => void) {
    if (await actions.remove(year!)) goBack()
  }

  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <List
      navigationTitle={yearLabel(year)}
      navigationBarTitleDisplayMode="inline"
      toolbar={{ primaryAction: <Button title="编辑" action={async () => { await actions.edit(year); refresh() }} /> }}
      onAppear={refresh}
    >
      <Section key="hero">
        <VStack alignment="leading" spacing={6}>
          <Text font="caption" foregroundStyle="secondaryLabel">{`实付 · ${fmtDate(year.paid_ts)} 付款`}</Text>
          <Text font="largeTitle" fontWeight="bold">{yuan(total)}</Text>
          {change ? <Text font="footnote" foregroundStyle={change.up ? ORANGE : "secondaryLabel"}>{change.text}</Text> : null}
          {year.discount ? <Text font="footnote" foregroundStyle="secondaryLabel">{`已减优惠 ${yuan(year.discount)}`}</Text> : null}
          <SegmentBar parts={compositionParts(comp)} max={comp.commercial + comp.compulsory + comp.other} height={10} />
          <CompositionLegend c={comp} />
        </VStack>
      </Section>

      <Section key="period" header={<Text>保险期间</Text>}>
        <HStack>
          <Text>{periodText(period)}</Text>
          <Spacer />
          {left != null ? <Text foregroundStyle={left < 0 ? ORANGE : "secondaryLabel"}>{left >= 0 ? `还有 ${left} 天` : `已到期 ${-left} 天`}</Text> : null}
        </HStack>
        <ProgressView value={elapsed} total={1} progressViewStyle="linear" tint={GREEN} />
      </Section>

      {policies.map((p, n) => p.kind === "commercial" ? <CommercialSection key={`p${n}`} policy={p} cmp={cmp} gift={gift} />
        : p.kind === "compulsory" ? <CompulsorySection key={`p${n}`} policy={p} prev={prevOf(p)} />
          : <OtherSection key={`p${n}`} policy={p} />)}

      <Section key="policies" header={<Text>保单</Text>}>
        {policies.flatMap((p, n) => [
          <Button key={`no${n}`} action={() => copy(p.policy_no)} disabled={!p.policy_no}>
            <HStack foregroundStyle="label">
              <Text lineLimit={1}>{p.kind === "commercial" || p.kind === "compulsory" ? KIND_TITLES[p.kind] : p.title || KIND_TITLES[p.kind]}</Text>
              <Spacer />
              {/* 保单号不折行：放不下时让左边的名称省略 */}
              <Text foregroundStyle="secondaryLabel" lineLimit={1} layoutPriority={1}>{p.policy_no || "没有保单号"}</Text>
            </HStack>
          </Button>,
          ...(p.mark ? [<MarkRow key={`mark${n}`} policy={p} file={p.mark} now={now} />] : []),
        ])}
        {files.length ? <Button title={`查看保单原件（${fileCountText(files)}）`} systemImage="doc.text" action={() => QuickLook.previewURLs(files.map(policyFilePath))} /> : null}
      </Section>

      {phone ? <Section key="phone">
        <Button title={`出险报案 ${phone}`} systemImage="phone" action={() => Safari.openURL(`tel:${phone}`)} />
      </Section> : null}


      <Section key="delete">
        <Button title="删除这一年的保险" role="destructive" action={() => remove(env.dismiss)} />
      </Section>
    </List>}</EnvironmentValuesReader>
}
