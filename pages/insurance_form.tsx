// 记保险：新记、编辑、补充保单共用（设计文档 20.6 节，画布「3 记保险」）。
// 选保单 PDF 或图片后自动填好（统一格式用规则读取；读不出文字的 PDF、图片在本机识别）；也可以手动添加保单。保存时新记或更新一笔「保险和交通规费」费用，或补到已有的费用。
// 交强险标志（单独的 PDF、图片，或交强险保单里的一页）按保单号挂到交强险上（画布「交强险标志」第 3 张）。
// 补到哪笔费用、保不保留那笔的金额，只在第一次决定（新记、补充保单）；编辑时都不再改。
import {
  Button, DatePicker, Form, HStack, Image, Navigation, NavigationStack, Picker, ProgressView, Section, Spacer, Text, TextField, Toggle, VStack, useEffect, useRef,
  useState,
} from "scripting"
import {
  AppData, BJ_OFFSET, catalogEntry, expenseCandidates, ExpenseRecord, fmtDate, InsuranceYear, insuranceYears, itemKey, KIND_TITLES, LedgerRecord, markLook,
  markMatch, newId, ParsedMark, parseNum, periodText, PickedPolicy, Policy, policyFilePath, PolicyItem, PolicyKind, readPolicyFiles, savePolicyFile,
  savePolicyMark, toPolicy, Vehicle, vehicleRecords, vinWarning, yearInsurer, yearPeriod, yearTotal, yuan,
} from "../common/model"
import { FieldRow } from "./components"
import { MarkBadge, ORANGE } from "./insurance_parts"
import { PolicyScan } from "./policy_scan"

export type InsuranceFormResult = { year: InsuranceYear; amount: "total" | "keep" }

/** 新选的交强险标志：原件路径；page 为 null 时整份是标志，否则是那份保单里的一页；scanned 是截图识别读出的 */
type MarkSrc = { path: string; page: number | null; name: string; info: ParsedMark; scanned: boolean }

/**
 * 表单里的一份保单：新选的 PDF 先记下来源路径，保存时才复制进来；scanned 是截图识别读出的（扫描件）。
 * markSrc：新选的、挂到这份交强险上的标志（markHow 是怎么对上的）；已存的标志在 mark
 */
type FormPolicy = Policy & {
  src: string | null; srcName: string; vin: string | null; sign: number | null; scanned: boolean
  markSrc: MarkSrc | null; markHow: "no" | "period" | null
}
const FORM_EXTRA = { src: null, srcName: "", vin: null, sign: null, scanned: false, markSrc: null, markHow: null }

/** 附件：没认出是保单的 PDF（交强险标志、读不出内容的文件），只存原件。新选的先记下来源路径；reason 是这次没认出的原因 */
type FormAttachment = { file: string | null; src: string | null; name: string; reason: string }

const KIND_ORDER: Record<PolicyKind, number> = { compulsory: 0, commercial: 1, accident: 2, other: 3 }
const sortPolicies = (list: FormPolicy[]) => [...list].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
const numText = (n: number | null) => (n == null ? "" : String(n))
const strip = (p: FormPolicy, file: string | null, mark: string | null): Policy => {
  const { src: _src, srcName: _name, vin: _vin, sign: _sign, scanned: _scanned, markSrc: _ms, markHow: _mh, mark: _mark, ...rest } = p
  return { ...rest, file, ...(mark ? { mark } : {}) }
}
/** 去掉这份保单的标志（已存的和新选的） */
const dropMark = (p: FormPolicy): FormPolicy => {
  const { mark: _mark, ...rest } = p
  return { ...rest, markSrc: null, markHow: null }
}

/** 标志挂到对得上的交强险上（保单号相同，读错时保险期间相同）；对不上的先放着，选了那份交强险以后再对 */
function attachMarks(list: FormPolicy[], marks: MarkSrc[]): { list: FormPolicy[]; rest: MarkSrc[] } {
  const rest: MarkSrc[] = []
  let out = list
  for (const m of marks) {
    const i = out.findIndex(p => markMatch(m.info, p) != null)
    if (i < 0) rest.push(m)
    else out = out.map((p, j) => (j === i ? { ...p, markSrc: m, markHow: markMatch(m.info, p) } : p))
  }
  return { list: out, rest }
}

/** 「扫描件 · 交强险标志 · 2027 年 1 月到期 · 保单号相符」 */
function markSummary(end: number, now: number, scanned: boolean, how: "no" | "period" | null): string {
  const look = markLook(end, now)
  const matched = how === "no" ? " · 保单号相符" : how === "period" ? " · 保险期间相符" : ""
  return `${scanned ? "扫描件 · " : ""}交强险标志 · ${look.year} 年 ${look.month} 月到期${matched}`
}
/** 「2021/11/24 · ¥5,800.00 · 2022年示例车险」 */
const expenseText = (r: ExpenseRecord, withRemark: boolean) => `${fmtDate(r.ts)} · ${yuan(r.amount)}${withRemark && r.remark ? ` · ${firstLine(r.remark)}` : ""}`
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
  const [policies, setPolicies] = useState<FormPolicy[]>(() => sortPolicies((year?.policies ?? []).map(p => ({ ...p, ...FORM_EXTRA }))))
  // 选了但还没对上交强险的标志：保存时作为附件
  const [marks, setMarks] = useState<MarkSrc[]>([])
  const now = Date.now()
  const [attachments, setAttachments] = useState<FormAttachment[]>(() => (year?.attachments ?? []).map(f => ({ file: f, src: null, name: f.split("/").pop() || f, reason: "" })))
  const [discount, setDiscount] = useState(year && year.discount ? String(year.discount) : "")
  const [paid, setPaid] = useState(year?.paid_ts ?? link?.ts ?? Date.now())
  const [remark, setRemark] = useState(year?.remark ?? "")
  const [useExisting, setUseExisting] = useState(true)
  const [amountMode, setAmountMode] = useState<"total" | "keep">("keep")
  const [busy, setBusy] = useState(false)

  const records = vehicleRecords(data, vehicle)
  const years = insuranceYears(data.ledger.insurance, vehicle.id)
  // 已经定下的费用：补充保单时是那一笔，编辑时是已关联的那一笔，不能再改
  const fixed = link ?? (year?.expense_id ? records.find((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense" && r.id === year.expense_id) ?? null : null)
  // 还没有对应的费用时（新记，或那笔在别处删了）：付款日期前后 45 天内有没关联的保险费用，提示补到那笔，不重复记账
  const suggestion = fixed ? null : expenseCandidates(records, years, paid, year?.id ?? null)[0] ?? null
  const linked = fixed ?? (useExisting ? suggestion : null)
  // 编辑时金额也按当初的决定：打开时费用金额与保单合计不同，就是当初选了「保留原金额」
  const settled = !!year && !!fixed
  const [settledKeep] = useState(() => !!year && !!fixed && Math.abs(fixed.amount - yearTotal(year)) > 0.005)

  // 提示补到一笔费用时，付款日期用那笔的日期
  useEffect(() => {
    if (suggestion && useExisting) setPaid(suggestion.ts)
  }, [suggestion?.id])

  const draft: InsuranceYear = {
    id, vehicle_id: vehicle.id, policies: policies.map(p => strip(p, p.file, p.mark ?? null)), discount: parseNum(discount) ?? 0, paid_ts: paid,
    expense_id: linked ? linked.id : null, remark: remark.trim(),
  }
  const total = yearTotal(draft)
  const premiums = total + draft.discount
  const mismatch = linked != null && Math.abs(linked.amount - total) > 0.005
  const amount: "total" | "keep" = settled ? (settledKeep ? "keep" : "total") : mismatch ? amountMode : "total"
  const shortBy = linked ? Math.round((total - linked.amount) * 100) / 100 : 0
  const expenseFooter = !linked
    ? `保存后在记录里记一笔「保险和交通规费」${yuan(total)}，日期为付款日期。`
    : amount === "keep"
      ? `保单明细挂到这笔费用上，费用保留原金额 ${yuan(linked.amount)}，日期跟着付款日期。${!settled && shortBy > 0 ? `相差 ${yuan(shortBy)}，如果是返现或优惠，填到上面的「优惠」里就对上了。` : ""}`
      : `保单明细挂到这笔费用上，费用的金额${mismatch ? `改成保单合计 ${yuan(total)}` : "与保单合计相符"}，以后跟着保单改。`

  // 有改动时禁止下滑关闭；编辑时什么都没改，「保存」直接关闭
  const state = JSON.stringify({ draft, amount, files: attachments.map(a => a.file ?? a.src), marks: [...policies.map(p => p.markSrc?.path ?? null), ...marks.map(m => m.path)] })
  const opened = useRef(state)
  const dirty = state !== opened.current
  const warnings = [...new Set(policies.map(p => vinWarning(p.vin, vehicle.provider?.vehicle_id)).filter((w): w is string => !!w))]

  async function pick() {
    const paths = await DocumentPicker.pickFiles({ types: ["com.adobe.pdf", "public.image"], allowsMultipleSelection: true })
    if (!paths || !paths.length) return
    setBusy(true)
    let res = await readPolicyFiles(paths)
    setBusy(false)
    // 读不出文字的（扫描件、特殊字体）：弹出一页逐页截图识别
    const textless = res.filter(r => r.textless)
    if (textless.length) {
      const scanned = await Navigation.present<PickedPolicy[] | null>({ element: <PolicyScan files={textless} /> })
      res = res.map(r => (r.textless ? scanned?.find(s => s.path === r.path) ?? { ...r, error: "没有识别（已取消）" } : r))
    }
    // 保单和交强险标志分开；都不是的不拒绝，作为附件保存原件
    const added: FormPolicy[] = []
    const found: MarkSrc[] = []
    const extra: FormAttachment[] = []
    for (const r of res) {
      if (r.mark) found.push({ path: r.path, page: r.mark.page, name: r.name, info: r.mark.info, scanned: r.textless })
      if (r.parsed) added.push({ ...toPolicy(r.parsed, null), ...FORM_EXTRA, src: r.path, srcName: r.name, vin: r.parsed.vin, sign: r.parsed.sign_ts, scanned: r.textless })
      else if (!r.mark) extra.push({ file: null, src: r.path, name: r.name, reason: r.error ?? "没认出保单内容" })
    }
    // 同一份保单再选一次时替换；同名的附件、标志也替换（例如上次取消了识别，这次认出了）
    const picked = new Set(res.map(r => r.name))
    const kept = policies.filter(p => !added.some(a => a.policy_no && a.policy_no === p.policy_no))
    const matched = attachMarks(sortPolicies([...kept, ...added]), [...marks.filter(m => !picked.has(m.name)), ...found])
    setPolicies(matched.list)
    setMarks(matched.rest)
    setAttachments([...attachments.filter(a => !picked.has(a.name)), ...extra])
    // 新记时付款日期默认取签单日期；那几天已经有保险费用（例如小熊里记过金额）时，提示补到那笔（见 suggestion）
    const signs = added.map(a => a.sign).filter((t): t is number => t != null)
    if (!year && !link && signs.length) setPaid(Math.max(...signs))
  }

  async function editPolicy(index: number | null) {
    const current = index == null ? null : policies[index]
    const res = await Navigation.present<Policy | null>({ element: <PolicyEdit policy={current} /> })
    if (!res) return
    const next: FormPolicy = current ? { ...current, ...res } : { ...res, ...FORM_EXTRA }
    setPolicies(sortPolicies(index == null ? [...policies, next] : policies.map((p, i) => (i === index ? next : p))))
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
    const fail = (name: string, e: unknown) => failed.push(`${name}：${e instanceof Error ? e.message : String(e)}`)
    const saved: Policy[] = []
    for (const p of policies) {
      let file = p.file
      if (p.src) {
        try {
          file = savePolicyFile(id, p.src, p.srcName)
        } catch (e) {
          fail(p.srcName, e)
          file = null
        }
      }
      let mark = p.mark ?? null
      if (p.markSrc) {
        try {
          mark = await savePolicyMark(id, p.markSrc)
        } catch (e) {
          fail(p.markSrc.name, e)
        }
      }
      saved.push(strip(p, file, mark))
    }
    const files: string[] = []
    // 没对上交强险的标志作为附件（整份是标志的才存；保单里的一页随那份保单存着）
    for (const m of marks) {
      if (m.page != null) continue
      try {
        files.push(savePolicyFile(id, m.path, m.name))
      } catch (e) {
        fail(m.name, e)
      }
    }
    for (const a of attachments) {
      if (a.file) files.push(a.file)
      else if (a.src) {
        try {
          files.push(savePolicyFile(id, a.src, a.name))
        } catch (e) {
          failed.push(`${a.name}：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
    if (failed.length) await Dialog.alert({ title: "有原件没有存进油记", message: `保险照常保存，以下文件没有存进来：\n${failed.join("\n")}` })
    const result: InsuranceFormResult = { year: { ...draft, policies: saved, ...(files.length ? { attachments: files } : {}) }, amount }
    dismiss(result)
  }

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
        footer={<Text>交强险、商业险是统一格式，逐项读出；其他保单读出名称、保费和期间。交强险标志（单独的 PDF、图片，或交强险保单里的一页）按保单号挂到交强险上。读不出文字的 PDF 和图片在本机识别；都没认出的作为附件保存。原件保存在油记里，不在备份文件里。</Text>}
      >
        {policies.flatMap((p, i) => [
          ...(p.src || p.file ? [<HStack key={`f${i}`} spacing={12}>
            <Image systemName="doc.text" foregroundStyle="secondaryLabel" frame={{ width: 28 }} />
            <VStack alignment="leading" spacing={2}>
              <Text lineLimit={1}>{p.srcName || (p.file ? p.file.split("/").pop() : "") || p.title}</Text>
              <Text font="caption" foregroundStyle={p.issues.length ? ORANGE : "secondaryLabel"}>
                {p.issues.length ? `需要核对：${p.issues[0]}` : `${readSummary(p)}${p.markSrc && p.markSrc.page != null ? " · 含标志" : ""}`}
              </Text>
            </VStack>
            <Spacer />
            {p.issues.length ? null : <Image systemName="checkmark.circle" foregroundStyle="systemGreen" />}
          </HStack>] : []),
          // 单独的标志文件（新选的，或编辑时已存的）
          ...((p.markSrc && p.markSrc.page == null) || (p.mark && !p.markSrc) ? [<HStack
            key={`m${i}`}
            spacing={12}
            trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setPolicies(policies.map((x, j) => (j === i ? dropMark(x) : x)))} />] }}
          >
            <MarkBadge end={p.end_ts} now={now} size={28} label={false} />
            <VStack alignment="leading" spacing={2}>
              <Text lineLimit={1}>{p.markSrc ? p.markSrc.name : (p.mark ?? "").split("/").pop() ?? ""}</Text>
              <Text font="caption" foregroundStyle="secondaryLabel">{markSummary(p.end_ts, now, !!p.markSrc?.scanned, p.markHow)}</Text>
            </VStack>
            <Spacer />
            <Image systemName="checkmark.circle" foregroundStyle="systemGreen" />
          </HStack>] : []),
        ])}
        {marks.map((m, i) => <HStack
          key={`pm${i}`}
          spacing={12}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setMarks(marks.filter((_, j) => j !== i))} />] }}
        >
          <MarkBadge end={m.info.end_ts} now={now} size={28} label={false} />
          <VStack alignment="leading" spacing={2}>
            <Text lineLimit={1}>{m.name}</Text>
            <Text font="caption" foregroundStyle={ORANGE}>{`${markSummary(m.info.end_ts, now, m.scanned, null)} · 还没有对应的交强险，保存后作为附件`}</Text>
          </VStack>
          <Spacer />
        </HStack>)}
        {attachments.map((a, i) => <HStack
          key={`a${i}`}
          spacing={12}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" role="destructive" action={() => setAttachments(attachments.filter((_, j) => j !== i))} />] }}
        >
          <Image systemName="paperclip" foregroundStyle="secondaryLabel" />
          <VStack alignment="leading" spacing={2}>
            <Text lineLimit={1}>{a.name}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{a.reason ? `附件 · ${a.reason}` : "附件"}</Text>
          </VStack>
          <Spacer />
        </HStack>)}
        {warnings.map(w => <Text key={w} font="footnote" foregroundStyle={ORANGE}>{w}</Text>)}
        {busy ? <ProgressView /> : <Button title="选择保单 PDF 或图片" systemImage="plus" action={pick} />}
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
        {p.markSrc || p.mark ? <MarkField policy={p} now={now} /> : null}
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

      <Section header={<Text>费用</Text>} footer={<Text>{expenseFooter}</Text>}>
        {fixed ? <HStack><Text>对应费用</Text><Spacer /><Text foregroundStyle="secondaryLabel">{expenseText(fixed, false)}</Text></HStack> : null}
        {suggestion ? <Toggle value={useExisting} onChanged={setUseExisting}>
          <VStack alignment="leading" spacing={2}>
            <Text>补到已有的费用</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{expenseText(suggestion, true)}</Text>
          </VStack>
        </Toggle> : null}
        {!settled && mismatch && linked ? <Picker title="金额" value={amountMode} onChanged={(v: string) => setAmountMode(v === "total" ? "total" : "keep")} pickerStyle="menu">
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

/** 交强险一组里的「交强险标志」：小徽章、到期年月，轻点预览原件（新选的、保单里的一页时预览整份） */
function MarkField({ policy, now }: { policy: FormPolicy; now: number }) {
  const look = markLook(policy.end_ts, now)
  const path = policy.markSrc ? policy.markSrc.path : policyFilePath(policy.mark ?? "")
  return <Button action={() => QuickLook.previewURLs([path])}>
    <HStack spacing={10} foregroundStyle="label">
      <Text>交强险标志</Text>
      <Spacer />
      <MarkBadge end={policy.end_ts} now={now} size={28} label={false} />
      <Text foregroundStyle="secondaryLabel">{`${look.year} 年 ${look.month} 月到期`}</Text>
      <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
    </HStack>
  </Button>
}

// ---------- 一份保单 ----------

const KINDS: PolicyKind[] = ["compulsory", "commercial", "accident", "other"]

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
