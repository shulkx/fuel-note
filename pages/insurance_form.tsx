// 记保险：新记、编辑、补充保单共用（设计文档 20.6 节，画布「3 记保险」）。
// 选保单 PDF 后自动填好（统一格式用规则读取；读不出文字的截图后在本机识别）；也可以手动添加保单。保存时新记或更新一笔「保险和交通规费」费用，或补到已有的费用。
import {
  Button, DatePicker, Form, HStack, Image, Navigation, NavigationStack, Picker, ProgressView, Section, Spacer, Text, TextField, VStack, useRef, useState,
} from "scripting"
import {
  AppData, catalogEntry, ExpenseRecord, expenseCandidates, fmtDate, insuranceYears, InsuranceYear, itemKey, KIND_TITLES, LedgerRecord, newId, parseNum,
  periodText, PickedPolicy, Policy, PolicyItem, PolicyKind, readPolicyFiles, savePolicyFile, toPolicy, Vehicle, vehicleRecords, vinWarning, yearInsurer, yearPeriod,
  yearTotal,
} from "../common/model"
import { FieldRow } from "./components"
import { ORANGE, yuan } from "./insurance_parts"
import { PolicyScan } from "./policy_scan"

export type InsuranceFormResult = { year: InsuranceYear; amount: "total" | "keep" }

/** 表单里的一份保单：新选的 PDF 先记下来源路径，保存时才复制进来；scanned 是截图识别读出的（扫描件） */
type FormPolicy = Policy & { src: string | null; srcName: string; vin: string | null; sign: number | null; scanned: boolean }

const KIND_ORDER: Record<PolicyKind, number> = { compulsory: 0, commercial: 1, accident: 2, other: 3 }
const sortPolicies = (list: FormPolicy[]) => [...list].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
const numText = (n: number | null) => (n == null ? "" : String(n))
const strip = (p: FormPolicy, file: string | null): Policy => {
  const { src: _src, srcName: _name, vin: _vin, sign: _sign, scanned: _scanned, ...rest } = p
  return { ...rest, file }
}
const firstLine = (s: string) => s.split("\n")[0]

/** 读出了什么：「交强险 · 保费、浮动比率、车船税」「扫描件 · 商业险 · 7 个险种，合计相符」 */
function readSummary(p: FormPolicy): string {
  const scanned = p.scanned ? "扫描件 · " : ""
  if (p.kind === "compulsory") return `${scanned}交强险 · 保费、浮动比率、车船税`
  if (p.kind === "commercial") return `${scanned}商业险 · ${p.items.length} 个险种${p.issues.length ? "" : "，合计相符"}`
  return `${scanned}${KIND_TITLES[p.kind]} · 名称、保费、期间`
}

export function InsuranceForm({ data, vehicle, year, link }: {
  data: AppData
  vehicle: Vehicle
  year: InsuranceYear | null
  /** 从「只有金额」的费用点「补充保单」进来时：补到这笔费用 */
  link: (ExpenseRecord & LedgerRecord) | null
}) {
  const dismiss = Navigation.useDismiss()
  const [id] = useState(() => year?.id ?? newId("i"))
  const [policies, setPolicies] = useState<FormPolicy[]>(() => (year?.policies ?? []).map(p => ({ ...p, src: null, srcName: "", vin: null, sign: null, scanned: false })))
  const [discount, setDiscount] = useState(year && year.discount ? String(year.discount) : "")
  const [paid, setPaid] = useState(year?.paid_ts ?? link?.ts ?? Date.now())
  const [remark, setRemark] = useState(year?.remark ?? "")
  const [linkId, setLinkId] = useState<string>(year?.expense_id ?? link?.id ?? "new")
  const [amountMode, setAmountMode] = useState<"total" | "keep">("keep")
  const [busy, setBusy] = useState(false)

  const records = vehicleRecords(data, vehicle)
  const years = insuranceYears(data.ledger.insurance, vehicle.id)
  const found = expenseCandidates(records, years, paid, year?.id ?? null)
  const linked = linkId === "new" ? null : records.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.id === linkId) ?? null
  const candidates = [...(linked && !found.some(r => r.id === linked.id) ? [linked] : []), ...found]

  const draft: InsuranceYear = {
    id, vehicle_id: vehicle.id, policies: policies.map(p => strip(p, p.file)), discount: parseNum(discount) ?? 0, paid_ts: paid,
    expense_id: linked ? linked.id : null, remark: remark.trim(),
  }
  const total = yearTotal(draft)
  const premiums = total + draft.discount
  const mismatch = linked != null && Math.abs(linked.amount - total) > 0.005
  const amount: "total" | "keep" = mismatch ? amountMode : "total"

  // 有改动时禁止下滑关闭；编辑时什么都没改，「保存」直接关闭
  const opened = useRef(JSON.stringify({ draft, linkId }))
  const dirty = JSON.stringify({ draft, linkId }) !== opened.current
  const warnings = [...new Set(policies.map(p => vinWarning(p.vin, vehicle.provider?.vehicle_id)).filter((w): w is string => !!w))]

  async function pick() {
    const paths = await DocumentPicker.pickFiles({ types: ["com.adobe.pdf"], allowsMultipleSelection: true })
    if (!paths || !paths.length) return
    setBusy(true)
    let res = await readPolicyFiles(paths)
    setBusy(false)
    // 读不出文字的（扫描件、特殊字体）：弹出一页逐页截图识别
    const textless = res.filter(r => r.textless)
    if (textless.length) {
      const scanned = await Navigation.present<PickedPolicy[] | null>({ element: <PolicyScan files={textless} /> })
      res = res.map(r => (r.textless ? scanned?.find(s => s.path === r.path) ?? { ...r, error: "没有识别（已取消），请重新选择或手动添加这份保单" } : r))
    }
    const added: FormPolicy[] = []
    const problems: string[] = []
    for (const r of res) {
      if (r.error) problems.push(`${r.name}：${r.error}`)
      else if (!r.parsed) problems.push(`${r.name}：不是保单（例如交强险标志），没有加入`)
      else added.push({ ...toPolicy(r.parsed, null), src: r.path, srcName: r.name, vin: r.parsed.vin, sign: r.parsed.sign_ts, scanned: r.textless })
    }
    // 同一份保单再选一次时替换
    const kept = policies.filter(p => !added.some(a => a.policy_no && a.policy_no === p.policy_no))
    setPolicies(sortPolicies([...kept, ...added]))
    // 新记时付款日期默认取签单日期；那几天已经有对得上的保险费用（例如小熊里记过金额）时，默认补到那笔费用，不重复记账
    const signs = added.map(a => a.sign).filter((t): t is number => t != null)
    if (!year && !link && signs.length) {
      const signed = Math.max(...signs)
      const match = linkId === "new" ? expenseCandidates(records, years, signed, null)[0] : undefined
      setPaid(match ? match.ts : signed)
      if (match) setLinkId(match.id)
    }
    if (problems.length) await Dialog.alert({ title: "有文件没有读入", message: problems.join("\n") })
  }

  async function editPolicy(index: number | null) {
    const current = index == null ? null : policies[index]
    const res = await Navigation.present<Policy | null>({ element: <PolicyEdit policy={current} /> })
    if (!res) return
    const next: FormPolicy = current ? { ...current, ...res } : { ...res, src: null, srcName: "", vin: null, sign: null, scanned: false }
    setPolicies(sortPolicies(index == null ? [...policies, next] : policies.map((p, i) => (i === index ? next : p))))
  }

  function chooseLink(v: string) {
    setLinkId(v)
    const r = records.find(x => x.id === v)
    // 补到已有的费用时，付款日期用那笔费用的日期
    if (r) setPaid(r.ts)
  }

  async function save() {
    if (year && !dirty) return dismiss(null)
    const problems: string[] = []
    if (!policies.length) problems.push("还没有保单：选择保单 PDF，或添加一份保单。")
    for (const p of policies) {
      const name = p.title || KIND_TITLES[p.kind]
      if (!p.start_ts || !p.end_ts || p.end_ts <= p.start_ts) problems.push(`请填写「${name}」的保险期间。`)
      if (!(p.premium > 0)) problems.push(`请填写「${name}」的保费。`)
    }
    if (draft.discount < 0 || draft.discount >= premiums) problems.push("优惠应小于保费合计。")
    if (problems.length) {
      await Dialog.alert({ title: "还不能保存", message: problems.join("\n") })
      return
    }
    // 复制原件失败时照常保存保险，只是这份没有原件
    const failed: string[] = []
    const saved = policies.map(p => {
      if (!p.src) return strip(p, p.file)
      try {
        return strip(p, savePolicyFile(id, p.src, p.srcName))
      } catch (e) {
        failed.push(`${p.srcName}：${e instanceof Error ? e.message : String(e)}`)
        return strip(p, null)
      }
    })
    if (failed.length) await Dialog.alert({ title: "保单原件没有存进油记", message: `保险照常保存，以下文件没有原件：\n${failed.join("\n")}` })
    const result: InsuranceFormResult = { year: { ...draft, policies: saved }, amount }
    dismiss(result)
  }

  const fileRows = policies.map((p, i) => ({ p, i })).filter(x => x.p.src || x.p.file)
  const period = yearPeriod(draft)

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle={year ? "编辑保险" : "记保险"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      <Section
        header={<Text>保单文件</Text>}
        footer={<Text>交强险、商业险是统一格式，逐项读出；其他保单读出名称、保费和期间。读不出文字的 PDF 逐页截图后在本机识别。原件保存在油记里，不在备份文件里。</Text>}
      >
        {fileRows.map(({ p, i }) => <HStack key={`f${i}`} spacing={12}>
          <Image systemName="doc.text" foregroundStyle="secondaryLabel" />
          <VStack alignment="leading" spacing={2}>
            <Text lineLimit={1}>{p.srcName || (p.file ? p.file.split("/").pop() : "") || p.title}</Text>
            <Text font="caption" foregroundStyle={p.issues.length ? ORANGE : "secondaryLabel"}>{p.issues.length ? `需要核对：${p.issues[0]}` : readSummary(p)}</Text>
          </VStack>
          <Spacer />
          {p.issues.length ? null : <Image systemName="checkmark.circle" foregroundStyle="systemGreen" />}
        </HStack>)}
        {warnings.map(w => <Text key={w} font="footnote" foregroundStyle={ORANGE}>{w}</Text>)}
        {busy ? <ProgressView /> : <Button title="选择保单 PDF" systemImage="plus" action={pick} />}
      </Section>

      <Section header={<Text>保险</Text>}>
        <HStack><Text>保险公司</Text><Spacer /><Text foregroundStyle="secondaryLabel">{yearInsurer(draft) || "—"}</Text></HStack>
        <HStack><Text>保险期间</Text><Spacer /><Text foregroundStyle="secondaryLabel">{periodText(period)}</Text></HStack>
        <DatePicker title="付款日期" value={paid} onChanged={setPaid} displayedComponents={["date"]} />
      </Section>

      {policies.map((p, i) => <Section key={`p${i}`} header={<Text>{KIND_TITLES[p.kind]}</Text>}>
        <Button
          action={() => editPolicy(i)}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setPolicies(policies.filter((_, j) => j !== i))} />] }}
        >
          <HStack foregroundStyle="label">
            <VStack alignment="leading" spacing={3}>
              <Text>{p.title || KIND_TITLES[p.kind]}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">
                {[periodText(p.start_ts && p.end_ts ? { start: p.start_ts, end: p.end_ts } : null), p.items.length ? `${p.items.length} 项` : "", p.vehicle_tax ? `车船税 ${yuan(p.vehicle_tax)}` : ""].filter(Boolean).join(" · ")}
              </Text>
            </VStack>
            <Spacer />
            <Text>{p.premium > 0 ? yuan(p.premium) : "未填保费"}</Text>
            <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
          </HStack>
        </Button>
      </Section>)}

      <Section footer={<Text>没有 PDF 时可以手动添加：交强险、商业险、驾乘意外险或其他保单。</Text>}>
        <Button title="添加保单" systemImage="plus" action={() => editPolicy(null)} />
      </Section>

      <Section header={<Text>付款</Text>}>
        <HStack><Text>保费合计</Text><Spacer /><Text foregroundStyle="secondaryLabel">{yuan(premiums)}</Text></HStack>
        <FieldRow title="优惠" unit="元">
          <TextField title="优惠" value={discount} onChanged={setDiscount} prompt="返现、礼品折算" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <HStack><Text>实付</Text><Spacer /><Text fontWeight="semibold">{yuan(total)}</Text></HStack>
      </Section>

      <Section
        header={<Text>费用</Text>}
        footer={<Text>{linked ? "保单明细挂到这笔费用上，不再新记一笔。" : `保存后在记录里记一笔「保险和交通规费」${yuan(total)}，日期为付款日期。`}</Text>}
      >
        <Picker title="记到" value={linkId} onChanged={(v: string) => chooseLink(v)} pickerStyle="menu">
          <Text tag="new">新记一笔</Text>
          {candidates.map(r => <Text key={r.id} tag={r.id}>{`补到 ${fmtDate(r.ts)} ${yuan(r.amount)}${r.remark ? ` · ${firstLine(r.remark)}` : ""}`}</Text>)}
        </Picker>
        {mismatch && linked ? <Picker title="金额" value={amountMode} onChanged={(v: string) => setAmountMode(v === "total" ? "total" : "keep")} pickerStyle="menu">
          <Text tag="keep">{`保留原金额 ${yuan(linked.amount)}`}</Text>
          <Text tag="total">{`改成保单合计 ${yuan(total)}`}</Text>
        </Picker> : null}
      </Section>

      <Section header={<Text>备注</Text>}>
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="例如：续保送了保养" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>
    </Form>
  </NavigationStack>
}

// ---------- 一份保单 ----------

const KINDS: PolicyKind[] = ["compulsory", "commercial", "accident", "other"]
const BJ_OFFSET = 8 * 3600e3

/** 日期选择器给的是设备时区的时刻；保单按北京时间的整天算 */
const dayStart = (ts: number) => { const d = new Date(ts); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - BJ_OFFSET }
const dayEnd = (ts: number) => dayStart(ts) + 86400e3 - 1
/** 北京时间的整天 → 设备时区同一天的中午（给日期选择器显示） */
const pickerValue = (ts: number) => { const d = new Date(ts + BJ_OFFSET); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12).getTime() }

function PolicyEdit({ policy }: { policy: Policy | null }) {
  const dismiss = Navigation.useDismiss()
  const nextYear = Date.now() + 365 * 86400e3
  const [kind, setKind] = useState<PolicyKind>(policy?.kind ?? "commercial")
  const [title, setTitle] = useState(policy?.title ?? "")
  const [insurer, setInsurer] = useState(policy?.insurer ?? "")
  const [no, setNo] = useState(policy?.policy_no ?? "")
  const [start, setStart] = useState(policy && policy.start_ts ? pickerValue(policy.start_ts) : Date.now())
  const [end, setEnd] = useState(policy && policy.end_ts ? pickerValue(policy.end_ts) : nextYear)
  const [premium, setPremium] = useState(policy ? numText(policy.premium || null) : "")
  const [rate, setRate] = useState(policy ? numText(policy.float_rate) : "")
  const [tax, setTax] = useState(policy ? numText(policy.vehicle_tax) : "")
  const [phone, setPhone] = useState(policy?.phone ?? "")
  const [items, setItems] = useState<PolicyItem[]>(policy?.items ?? [])

  const build = (): Policy => ({
    kind,
    title: title.trim() || (kind === "compulsory" ? "机动车交通事故责任强制保险单" : kind === "commercial" ? "机动车商业保险保险单" : ""),
    insurer: insurer.trim(),
    policy_no: no.trim(),
    start_ts: dayStart(start),
    end_ts: dayEnd(end),
    premium: parseNum(premium) ?? 0,
    premium_ex_tax: policy?.premium_ex_tax ?? null,
    tax: policy?.tax ?? null,
    float_rate: kind === "compulsory" ? parseNum(rate) : null,
    vehicle_tax: kind === "compulsory" ? parseNum(tax) : null,
    phone: phone.trim() || null,
    items: kind === "compulsory" ? [] : items,
    file: policy?.file ?? null,
    issues: policy?.issues ?? [],
  })
  const opened = useRef(JSON.stringify(build()))
  const dirty = JSON.stringify(build()) !== opened.current

  async function editItem(index: number | null) {
    const res = await Navigation.present<PolicyItem | null>({ element: <ItemEdit item={index == null ? null : items[index]} kind={kind} /> })
    if (!res) return
    setItems(index == null ? [...items, res] : items.map((x, i) => (i === index ? res : x)))
  }

  function save() {
    if (policy && !dirty) return dismiss(null)
    // 改过的保单当作已经核对过，不再显示识别时的提示
    dismiss({ ...build(), issues: dirty ? [] : build().issues })
  }

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle={policy ? "保单" : "添加保单"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="完成" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      {policy?.issues.length ? <Section header={<Text>需要核对</Text>} footer={<Text>改过这份保单后，这些提示不再显示。</Text>}>
        {policy.issues.map(s => <Text key={s} font="footnote" foregroundStyle={ORANGE}>{s}</Text>)}
      </Section> : null}
      <Section>
        <Picker title="种类" value={kind} onChanged={(v: string) => setKind(v as PolicyKind)} pickerStyle="menu">
          {KINDS.map(k => <Text key={k} tag={k}>{KIND_TITLES[k]}</Text>)}
        </Picker>
        <FieldRow title="名称">
          <TextField title="名称" value={title} onChanged={setTitle} prompt={KIND_TITLES[kind]} multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="保险公司">
          <TextField title="保险公司" value={insurer} onChanged={setInsurer} prompt="保单上的公司全称" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="保单号">
          <TextField title="保单号" value={no} onChanged={setNo} prompt="可不填" autocorrectionDisabled textInputAutocapitalization="never" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>
      <Section header={<Text>保险期间</Text>}>
        <DatePicker title="起保" value={start} onChanged={setStart} displayedComponents={["date"]} />
        <DatePicker title="到期" value={end} onChanged={setEnd} displayedComponents={["date"]} />
      </Section>
      <Section header={<Text>保费</Text>}>
        <FieldRow title="保费（含税）" unit="元">
          <TextField title="保费" value={premium} onChanged={setPremium} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {kind === "compulsory" ? <FieldRow title="浮动比率" unit="%">
          <TextField title="浮动比率" value={rate} onChanged={setRate} prompt="例如 -10" keyboardType="numbersAndPunctuation" multilineTextAlignment="trailing" />
        </FieldRow> : null}
        {kind === "compulsory" ? <FieldRow title="代收车船税" unit="元">
          <TextField title="车船税" value={tax} onChanged={setTax} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow> : null}
        <FieldRow title="报案电话">
          <TextField title="报案电话" value={phone} onChanged={setPhone} prompt="例如 95511" keyboardType="phonePad" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>
      {kind !== "compulsory" ? <Section header={<Text>险种和保障</Text>}>
        {items.map((it, i) => <Button
          key={`i${i}`}
          action={() => editItem(i)}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setItems(items.filter((_, j) => j !== i))} />] }}
        >
          <HStack foregroundStyle="label">
            <VStack alignment="leading" spacing={2}>
              <Text>{(it.key && catalogEntry(it.key)?.short) || it.name}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{[it.amount != null ? `保额 ${it.amount}` : "", it.amount_text].filter(Boolean).join(" · ") || " "}</Text>
            </VStack>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{it.premium != null ? yuan(it.premium) : ""}</Text>
          </HStack>
        </Button>)}
        <Button title="添加险种" systemImage="plus" action={() => editItem(null)} />
      </Section> : null}
    </Form>
  </NavigationStack>
}

// ---------- 一个险种 ----------

function ItemEdit({ item, kind }: { item: PolicyItem | null; kind: PolicyKind }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(item?.name ?? "")
  const [amount, setAmount] = useState(item ? numText(item.amount) : "")
  const [text, setText] = useState(item?.amount_text ?? "")
  const [premium, setPremium] = useState(item ? numText(item.premium) : "")

  async function save() {
    if (!name.trim()) {
      await Dialog.alert({ title: "还不能保存", message: "请填写名称。" })
      return
    }
    const times = /(\d+)\s*次/.exec(text)
    const result: PolicyItem = {
      key: itemKey(name, kind), name: name.trim(), amount: parseNum(amount), amount_text: text.trim(), premium: parseNum(premium), times: times ? Number(times[1]) : null,
    }
    dismiss(result)
  }

  return <NavigationStack>
    <Form
      navigationTitle={item ? "险种" : "添加险种"}
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="完成" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      <Section footer={<Text>名称照保单填写，例如「机动车损失保险」「道路救援服务特约条款」；油记按名称和往年对上。</Text>}>
        <FieldRow title="名称">
          <TextField title="名称" value={name} onChanged={setName} prompt="保单上的名称" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="保额或限额" unit="元">
          <TextField title="保额" value={amount} onChanged={setAmount} prompt="可不填" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="其他写法">
          <TextField title="其他写法" value={text} onChanged={setText} prompt="共享保额、12次" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="保费" unit="元">
          <TextField title="保费" value={premium} onChanged={setPremium} prompt="可不填" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>
    </Form>
  </NavigationStack>
}
