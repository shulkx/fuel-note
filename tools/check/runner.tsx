// 手机上的自动检查（开发用，不随油记发布）。电脑端是 tools/device_check.ts，说明见 tools/check/README.md。
// 启动时把数据文件夹换成 FuelNoteCheck：账本、保单原件、小组件文件都在那里，不碰油记的真实数据；
// 不读写钥匙串、不同步小熊，只向电脑上的采样服务（tools/ocr_bridge.mjs）取保单文件。
// 在 3200 端口等电脑的请求：/ping、/run/recognize、/run/ledger、/shot。识别扫描件要用这一页上的 WebView，所以这一页要留在屏幕上。
import {
  Button, fetch, List, Navigation, NavigationStack, ScreenshotMaker, ScrollView, Section, Text, TextField, VirtualNode, WebView, ZStack, useEffect, useRef,
  useState,
} from "scripting"
import {
  addVehicle, AppData, currentInsurance, deleteInsurance, deleteRecord, ExpenseRecord, InsuranceYear, insuranceYears, LedgerRecord, loadData, markMatch, newId,
  ParsedMark, PickedPolicy, Policy, policyFilePath, readPolicyFiles, renewalDue, restoreBackup, saveInsurance, saveExpense, savePolicyFile, savePolicyMark,
  scanPolicyFile, toPolicy, updateSettings, upgradeInsuranceMarks, Vehicle, vehicleRecords, yearFiles, yearTotal,
} from "../../common/model"
import { makeBackup, parseBackup } from "../../common/backup"
import { dataDirectory, saveLedger, setDataRoot } from "../../platform/storage"
import { CoveragePage } from "../../pages/coverage"
import { InsuranceDetail } from "../../pages/insurance_detail"
import { InsuranceForm } from "../../pages/insurance_form"
import { RecordsPage } from "../../pages/records"

const SANDBOX = "FuelNoteCheck"
setDataRoot(SANDBOX)

/** 改了这个值，手机重新运行后报到的 STAMP 跟着变（确认跑的是新代码） */
export const STAMP = "7"
const PORT = 3200
const DAY = 86400e3
const BJ_OFFSET = 8 * 3600e3
const INSURANCE_CATEGORY = 100002

type Scheme = "light" | "dark"
type Step = { name: string; ok: boolean; detail: string }

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))
const query = (req: HttpRequest, key: string) => req.queryParams.find(q => q.key === key)?.value ?? ""
const jsonResponse = (value: unknown) => HttpResponse.ok(HttpResponseBody.text(JSON.stringify(value)))
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
const money = (n: number) => n.toFixed(2)

function bodyJson<T>(req: HttpRequest): T {
  return JSON.parse(req.body.toRawString() ?? "{}") as T
}

function pngResponse(image: UIImage | null): HttpResponse {
  const data = image?.toPNGData() ?? null
  return data ? HttpResponse.raw(200, "OK", { headers: { "Content-Type": "image/png" }, body: data }) : HttpResponse.internalServerError()
}

/** 只清空检查用的文件夹；数据文件夹不是它时直接报错 */
function resetSandbox(): void {
  const dir = dataDirectory()
  if (!dir.endsWith(`/${SANDBOX}`)) throw new Error(`数据文件夹不是 ${SANDBOX}，不清空：${dir}`)
  if (FileManager.existsSync(dir)) FileManager.removeSync(dir)
}

/** 从电脑上的采样服务取保单文件，存到检查用的文件夹 inputs/ 下；返回 id → 本机路径 */
async function fetchInputs(bridge: string, ids: string[]): Promise<Map<string, string>> {
  const dir = `${dataDirectory()}/inputs`
  FileManager.createDirectorySync(dir, true)
  const out = new Map<string, string>()
  for (const id of ids) {
    const res = await fetch(`${bridge}/pdf?id=${encodeURIComponent(id)}`, { timeout: 60 })
    if (res.status !== 200) throw new Error(`取不到 ${id}：HTTP ${res.status}`)
    const path = `${dir}/${id.split("/").pop()}`
    FileManager.writeAsDataSync(path, await res.data())
    out.set(id, path)
  }
  return out
}

/** 与记保险相同：先取文字，读不出文字的逐页截图识别 */
async function readAll(paths: string[], web: WebViewController): Promise<PickedPolicy[]> {
  const out: PickedPolicy[] = []
  for (const p of await readPolicyFiles(paths)) out.push(p.textless ? await scanPolicyFile(p, web, () => undefined) : p)
  return out
}

const expenses = (data: AppData, v: Vehicle) => vehicleRecords(data, v).filter((r): r is ExpenseRecord & LedgerRecord => r.kind === "expense")

function add(steps: Step[], name: string, ok: boolean, detail = ""): void {
  steps.push({ name, ok, detail })
}

// ---------- 识别 ----------

/** 每个文件读出的保单和标志，由电脑和 expected.json 比较 */
async function runRecognize(bridge: string, ids: string[], web: WebViewController): Promise<unknown> {
  const inputs = await fetchInputs(bridge, ids)
  const picked = await readAll(ids.map(id => inputs.get(id) ?? ""), web)
  return { results: picked.map((p, i) => ({ id: ids[i], textless: p.textless, image: p.image, error: p.error, parsed: p.parsed, mark: p.mark })) }
}

// ---------- 记账 ----------

/** 电脑给的计划：小熊里已有的保险费用（真实数据只在电脑上，不进仓库），每年的保单文件和对应方式 */
type Plan = {
  seeds: Array<{ ts: number; amount: number; remark: string }>
  years: Array<{ label: string; files: string[]; link: number | null; amount: "total" | "keep" }>
}

type Imported = { label: string; id: string; link: number | null; amount: "total" | "keep"; markFrom: "file" | "page" | null; markText: boolean }

/** 本机北京时间某天结束（距今 days 天） */
const dayEndFromNow = (now: number, days: number) => Math.floor((now + BJ_OFFSET) / DAY) * DAY - BJ_OFFSET + (days + 1) * DAY - 1

function manualPolicy(start: number, end: number, file: string | null): Policy {
  return {
    kind: "compulsory", title: "机动车交通事故责任强制保险单", insurer: "示例财产保险股份有限公司", policy_no: "", start_ts: start, end_ts: end, premium: 950,
    premium_ex_tax: null, tax: null, float_rate: null, vehicle_tax: 360, phone: null, items: [], file, issues: [],
  }
}

/** 一年：与记保险表单相同的做法——保单原件复制进来，标志挂到对得上的交强险上，都不是的作为附件；补到已有费用或新记 */
async function importYear(data: AppData, v: Vehicle, y: Plan["years"][number], inputs: Map<string, string>, seedIds: string[], web: WebViewController, steps: Step[]): Promise<{ data: AppData; info: Imported }> {
  const id = newId("i")
  const picked = await readAll(y.files.map(f => inputs.get(f) ?? ""), web)
  const policies: Policy[] = []
  const marks: Array<{ path: string; page: number | null; name: string; info: ParsedMark; text: boolean }> = []
  const attachments: string[] = []
  const signs: number[] = []
  for (const r of picked) {
    if (r.mark) marks.push({ path: r.path, page: r.mark.page, name: r.name, info: r.mark.info, text: !r.textless && !r.image })
    if (r.parsed) {
      policies.push(toPolicy(r.parsed, savePolicyFile(id, r.path, r.name)))
      if (r.parsed.sign_ts) signs.push(r.parsed.sign_ts)
    } else if (!r.mark) attachments.push(savePolicyFile(id, r.path, r.name))
  }
  let markFrom: Imported["markFrom"] = null
  let markText = false
  for (const m of marks) {
    const i = policies.findIndex(p => !p.mark && markMatch(m.info, p) != null)
    if (i >= 0) {
      policies[i] = { ...policies[i], mark: await savePolicyMark(id, m) }
      markFrom = m.page == null ? "file" : "page"
      markText = m.text && /\.pdf$/i.test(m.path)
    } else if (m.page == null) attachments.push(savePolicyFile(id, m.path, m.name))
  }
  const seedId = y.link != null ? seedIds[y.link] : null
  const seed = seedId ? expenses(data, v).find(e => e.id === seedId) ?? null : null
  const year: InsuranceYear = {
    id, vehicle_id: v.id, policies, discount: 0, paid_ts: seed ? seed.ts : signs.length ? Math.max(...signs) : Date.now(), expense_id: seed ? seed.id : null,
    remark: "", ...(attachments.length ? { attachments } : {}),
  }
  const before = expenses(data, v)
  const r = saveInsurance(data, v, year, y.amount)
  const after = expenses(r.data, v)
  const exp = after.find(e => e.id === r.year.expense_id) ?? null
  const total = yearTotal(r.year)
  const label = y.label
  add(steps, `${label}：读出 ${policies.length} 份保单`, policies.length > 0, policies.map(p => `${p.kind} ${money(p.premium)}`).join("、"))
  if (seed) {
    add(steps, `${label}：补到已有的费用，不新增`, after.length === before.length && exp?.id === seed.id, `费用 ${after.length} 笔`)
    const want = y.amount === "keep" ? seed.amount : total
    add(steps, `${label}：费用金额${y.amount === "keep" ? "保留原金额" : "改成保单合计"}`, !!exp && Math.abs(exp.amount - want) < 0.005, `费用 ${money(exp?.amount ?? 0)}，应为 ${money(want)}`)
  } else {
    add(steps, `${label}：新记一笔费用`, after.length === before.length + 1 && !!exp, `费用 ${after.length} 笔`)
    add(steps, `${label}：金额是合计、类别保险和交通规费、日期是签单日期`,
      !!exp && Math.abs(exp.amount - total) < 0.005 && exp.category_id === INSURANCE_CATEGORY && exp.ts === year.paid_ts, `费用 ${money(exp?.amount ?? 0)}，合计 ${money(total)}`)
  }
  const files = yearFiles(r.year)
  const missing = files.filter(f => !FileManager.existsSync(policyFilePath(f)))
  add(steps, `${label}：原件都存进来了（${files.length} 个）`, missing.length === 0, missing.join("、"))
  if (marks.length) {
    const c = r.year.policies.find(p => p.kind === "compulsory")
    add(steps, `${label}：交强险标志挂到交强险上（${markFrom === "page" ? "保单里的一页" : "单独的文件"}）`, !!c?.mark && FileManager.existsSync(policyFilePath(c.mark)), c?.mark ?? "没有")
  }
  return { data: r.data, info: { label, id, link: y.link, amount: y.amount, markFrom, markText } }
}

async function runLedger(bridge: string, plan: Plan, web: WebViewController): Promise<{ steps: Step[] }> {
  const steps: Step[] = []
  resetSandbox()
  let data = loadData().data
  data = addVehicle(data, { name: "检查用车", grade: 95, profile: null, provider: null, location: "local" })
  const v = data.ledger.vehicles[data.ledger.vehicles.length - 1]
  // 小熊里已有的保险费用（本机车辆上照样记一笔）
  const seedIds: string[] = []
  for (const s of plan.seeds) {
    data = saveExpense(data, v, null, { ts: s.ts, category_id: INSURANCE_CATEGORY, amount: s.amount, remark: s.remark }).data
    seedIds.push(expenses(data, v).find(e => e.ts === s.ts && e.amount === s.amount)?.id ?? "")
  }
  const inputs = await fetchInputs(bridge, plan.years.flatMap(y => y.files))
  const imported: Imported[] = []
  for (const y of plan.years) {
    const r = await importYear(data, v, y, inputs, seedIds, web, steps)
    data = r.data
    imported.push(r.info)
  }
  const yearOf = (id: string) => (data.ledger.insurance ?? []).find(y => y.id === id) ?? null
  const expenseOf = (y: InsuranceYear | null) => (y ? expenses(data, v).find(e => e.id === y.expense_id) ?? null : null)

  // 第 141 项：金额相符的那一年改优惠，费用跟着改；保留原金额的那一年改付款日期，费用跟着改日期、金额不变
  const follow = imported.find(i => i.link != null && i.amount === "total")
  const followYear = follow ? yearOf(follow.id) : null
  if (follow && followYear) {
    const original = expenseOf(followYear)?.amount ?? 0
    data = saveInsurance(data, v, { ...followYear, discount: 10 }, "total").data
    const changed = expenseOf(yearOf(follow.id))?.amount ?? 0
    data = saveInsurance(data, v, { ...(yearOf(follow.id) ?? followYear), discount: 0 }, "total").data
    const back = expenseOf(yearOf(follow.id))?.amount ?? 0
    add(steps, `${follow.label}：改优惠后费用跟着改，改回来恢复原样`, Math.abs(changed - (original - 10)) < 0.005 && Math.abs(back - original) < 0.005,
      `${money(original)} → ${money(changed)} → ${money(back)}`)
  }
  const keep = imported.find(i => i.link != null && i.amount === "keep")
  const keepYear = keep ? yearOf(keep.id) : null
  if (keep && keepYear) {
    const before = expenseOf(keepYear)
    const moved = keepYear.paid_ts + DAY
    data = saveInsurance(data, v, { ...keepYear, paid_ts: moved }, "keep").data
    const after = expenseOf(yearOf(keep.id))
    add(steps, `${keep.label}：保留原金额时改付款日期，费用跟着改日期、金额不变、关联还在`,
      !!before && !!after && after.ts === moved && Math.abs(after.amount - before.amount) < 0.005, `${money(before?.amount ?? 0)} → ${money(after?.amount ?? 0)}`)
  }

  // 第 142 项：升级前存进来的标志——单独的标志 PDF 当时是附件、交强险 PDF 里的标志页没拆出来；升级后都挂到交强险上
  const sep = imported.find(i => i.markFrom === "file" && i.markText)
  const emb = imported.find(i => i.markFrom === "page" && i.markText)
  if (sep || emb) {
    const ledger = JSON.parse(JSON.stringify(data.ledger)) as typeof data.ledger
    let sepMark = ""
    for (const y of ledger.insurance ?? []) {
      const c = y.policies.find(p => p.kind === "compulsory")
      if (!c?.mark) continue
      if (sep && y.id === sep.id) {
        sepMark = c.mark
        y.attachments = [...(y.attachments ?? []), c.mark]
        delete c.mark
      } else if (emb && y.id === emb.id) {
        FileManager.removeSync(policyFilePath(c.mark))
        delete c.mark
      }
    }
    ledger.settings = { ...ledger.settings, insurance_marks_checked: false }
    saveLedger(ledger)
    const upgraded = await upgradeInsuranceMarks(loadData().data)
    if (upgraded) data = upgraded
    if (sep) {
      const y = yearOf(sep.id)
      const c = y?.policies.find(p => p.kind === "compulsory")
      add(steps, `${sep.label}：升级后附件里的标志 PDF 挂到交强险上`, c?.mark === sepMark && !(y?.attachments ?? []).includes(sepMark), c?.mark ?? "没有")
    }
    if (emb) {
      const c = yearOf(emb.id)?.policies.find(p => p.kind === "compulsory")
      const doc = c?.mark ? PDFDocument.fromFilePath(policyFilePath(c.mark)) : null
      add(steps, `${emb.label}：升级后交强险 PDF 里的标志页拆出来（一页）`, !!doc && doc.pageCount === 1, c?.mark ?? "没有")
    }
    add(steps, "升级只做一次", data.ledger.settings.insurance_marks_checked === true)
  }

  // 第 135 项：另一辆车 20 天后到期，出现续保提醒
  data = addVehicle(data, { name: "检查用车（续保提醒）", grade: 95, profile: null, provider: null, location: "local" })
  const v2 = data.ledger.vehicles[data.ledger.vehicles.length - 1]
  const now = Date.now()
  const renew: InsuranceYear = {
    id: newId("i"), vehicle_id: v2.id, policies: [manualPolicy(dayEndFromNow(now, -345) - DAY + 1, dayEndFromNow(now, 20), null)], discount: 0, paid_ts: now - 350 * DAY,
    expense_id: null, remark: "",
  }
  data = saveInsurance(data, v2, renew, "total").data
  const due = renewalDue(insuranceYears(data.ledger.insurance, v2.id), now, [])
  add(steps, "续保提醒：20 天后到期的出现提醒", due?.daysLeft === 20, due ? `还有 ${due.daysLeft} 天` : "没有提醒")

  // 第 136 项：只删明细保留费用；删费用连明细一起删；原件都删掉
  const anyInput = [...inputs.values()].find(p => /\.pdf$/i.test(p)) ?? ""
  const makeOld = (y: number): InsuranceYear => {
    const id = newId("i")
    return {
      id, vehicle_id: v2.id, policies: [manualPolicy(Date.parse(`${y}-01-07T00:00:00+08:00`), Date.parse(`${y + 1}-01-06T23:59:59.999+08:00`), savePolicyFile(id, anyInput, "保单.pdf"))],
      discount: 0, paid_ts: Date.parse(`${y - 1}-12-20T12:00:00+08:00`), expense_id: null, remark: "",
    }
  }
  const a = saveInsurance(data, v2, makeOld(2017), "total")
  data = a.data
  const aExpense = a.year.expense_id
  data = deleteInsurance(data, v2, a.year.id, false).data
  add(steps, "删除：只删保单明细，费用还在，原件删掉",
    !yearOf(a.year.id) && expenses(data, v2).some(e => e.id === aExpense) && !FileManager.existsSync(`${dataDirectory()}/insurance/${a.year.id}`))
  const b = saveInsurance(data, v2, makeOld(2018), "total")
  data = b.data
  const bExpense = expenses(data, v2).find(e => e.id === b.year.expense_id)
  if (bExpense) data = deleteRecord(data, v2, bExpense).data
  add(steps, "删除：在记录里删保险费用，保单明细和原件一起删掉", !!bExpense && !yearOf(b.year.id) && !FileManager.existsSync(`${dataDirectory()}/insurance/${b.year.id}`))

  // 第 138 项：备份后恢复，保险明细都在，原件还在本机
  const before = JSON.stringify(data.ledger.insurance)
  const backup = parseBackup(JSON.stringify(makeBackup(data.ledger, data.xxyh, "check", Date.now(), null)))
  data = (await restoreBackup(backup, { password: null, keepOps: false })).data
  const files = (data.ledger.insurance ?? []).flatMap(yearFiles)
  add(steps, "备份后恢复：保险明细一样，原件都还在", JSON.stringify(data.ledger.insurance) === before && files.every(f => FileManager.existsSync(policyFilePath(f))),
    `${(data.ledger.insurance ?? []).length} 年、${files.length} 个原件`)

  // 截图时显示第一辆车
  updateSettings(data, { current_vehicle_id: v.id })
  return { steps }
}

// ---------- 截图 ----------

/**
 * 弹出的页面外面包一层，出现后把「截图」「关闭」交给调用方。
 * height 不为 0 时把页面撑到这么高（放在 ScrollView 里），一张截图里看到整页
 */
function ShotHost({ scheme, page, height, ready }: { scheme: Scheme; page: VirtualNode; height: number; ready: (take: () => UIImage | null, close: () => void) => void }) {
  const dismiss = Navigation.useDismiss()
  const ref = useRef<ScreenshotMaker>(null)
  useEffect(() => {
    ready(() => ref.current?.screenshot() ?? null, () => dismiss())
  }, [])
  if (!height) return <ZStack screenshotRef={ref} environments={{ colorScheme: scheme }}>{page}</ZStack>
  return <ScrollView environments={{ colorScheme: scheme }}>
    <ZStack screenshotRef={ref} frame={{ maxWidth: "infinity", minHeight: height, maxHeight: height }}>{page}</ZStack>
  </ScrollView>
}

const noop = () => undefined
const vehicleStub = { switchVehicle: noop, addVehicle: noop, manageVehicles: noop }

/** 用检查用的账本渲染真实页面：保障页、当前保单的详情和编辑表单、另一辆车的记录页（续保提醒） */
function screenElement(screen: string): VirtualNode | null {
  let data = loadData().data
  const v = data.ledger.vehicles.find(x => x.name === "检查用车")
  const v2 = data.ledger.vehicles.find(x => x.name === "检查用车（续保提醒）")
  if (!v) return null
  const years = insuranceYears(data.ledger.insurance, v.id)
  const current = currentInsurance(years, Date.now()) ?? years[0] ?? null
  if (screen === "coverage") return <CoveragePage data={data} vehicleActions={vehicleStub} actions={{ addInsurance: noop, openInsurance: noop }} />
  if (screen === "detail" && current) {
    return <InsuranceDetail get={() => data} yearId={current.id} actions={{ edit: async () => undefined, remove: async () => false, recordExpense: async () => undefined }} />
  }
  if (screen === "form" && current) return <InsuranceForm data={data} vehicle={v} year={current} link={null} />
  if (screen === "records" && v2) {
    data = { ...data, ledger: { ...data.ledger, settings: { ...data.ledger.settings, current_vehicle_id: v2.id } } }
    return <RecordsPage data={data} subtitle={null} stop={null} status={null} openStatus={noop} actions={{
      ...vehicleStub, addFuel: noop, addExpense: noop, edit: noop, remove: noop, sync: async () => undefined, recordStop: noop, dismissStop: noop, addInsurance: noop,
      dismissRenewal: noop,
    }} />
  }
  return null
}

async function takeShot(screen: string, scheme: Scheme, height: number): Promise<UIImage | null> {
  const page = screenElement(screen)
  if (!page) return null
  let take: (() => UIImage | null) | null = null
  let close: (() => void) | null = null
  const done = Navigation.present({
    element: <ShotHost scheme={scheme} page={page} height={height} ready={(t, c) => { take = t; close = c }} />,
    modalPresentationStyle: "fullScreen",
  })
  await wait(2600)
  const image = take ? (take as () => UIImage | null)() : null
  if (close) (close as () => void)()
  await done
  await wait(300)
  return image
}

// ---------- 页面和端口 ----------

export function CheckPage() {
  const dismiss = Navigation.useDismiss()
  const [web] = useState(() => new WebViewController())
  const [bridge, setBridge] = useState("http://192.168.10.100:3100")
  const bridgeRef = useRef(bridge)
  const [status, setStatus] = useState("启动中")
  const [last, setLast] = useState("")
  const busy = useRef(false)

  useEffect(() => {
    bridgeRef.current = bridge
  }, [bridge])

  useEffect(() => {
    const server = new HttpServer()
    const guarded = (name: string, run: (req: HttpRequest) => Promise<HttpResponse>) => async (req: HttpRequest) => {
      if (busy.current) return jsonResponse({ error: "正在做别的检查" })
      busy.current = true
      setLast(`${name}：进行中`)
      const t0 = Date.now()
      try {
        const res = await run(req)
        setLast(`${name}：完成（${Math.round((Date.now() - t0) / 1000)} 秒）`)
        return res
      } catch (e) {
        setLast(`${name}：出错 ${errorText(e)}`)
        return jsonResponse({ error: errorText(e) })
      } finally {
        busy.current = false
      }
    }
    server.registerAsyncHandler("/ping", async () => jsonResponse({ stamp: STAMP, data: dataDirectory() }))
    server.registerAsyncHandler("/run/recognize", guarded("识别", async req => {
      const body = bodyJson<{ ids: string[] }>(req)
      return jsonResponse(await runRecognize(bridgeRef.current, body.ids, web))
    }))
    server.registerAsyncHandler("/run/ledger", guarded("记账", async req => jsonResponse(await runLedger(bridgeRef.current, bodyJson<Plan>(req), web))))
    server.registerAsyncHandler("/shot", guarded("截图", async req =>
      pngResponse(await takeShot(query(req, "screen"), query(req, "scheme") === "dark" ? "dark" : "light", Number(query(req, "height")) || 0))))
    const error = server.start({ port: PORT, forceIPv4: true })
    setStatus(error ? `启动失败：${error}` : `在 ${PORT} 端口等电脑的请求（STAMP ${STAMP}）`)
    console.log(`[check] ${error ? `启动失败：${error}` : `端口 ${server.port}，STAMP ${STAMP}，数据 ${dataDirectory()}`}`)
    void fetch(`${bridgeRef.current}/check_hello`, {
      method: "POST", headers: { "Content-Type": "application/json" }, timeout: 10, body: JSON.stringify({ port: server.port ?? PORT, stamp: STAMP, error }),
    }).catch(e => console.log(`[check] 报到失败：${errorText(e)}`))
    return () => {
      server.stop()
      web.dispose()
    }
  }, [])

  return <NavigationStack>
    <List navigationTitle="FuelNote Check" navigationBarTitleDisplayMode="inline" toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}>
      <Section header={<Text>状态</Text>} footer={<Text>保持这一页在屏幕上，屏幕不要锁。电脑会自己发请求，不用点任何东西；数据在单独的文件夹 FuelNoteCheck，不碰油记的数据。</Text>}>
        <Text>{status}</Text>
        {last ? <Text font="footnote" foregroundStyle="secondaryLabel">{last}</Text> : null}
        <TextField title="电脑地址" value={bridge} onChanged={setBridge} autocorrectionDisabled textInputAutocapitalization="never" keyboardType="URL" />
      </Section>
      <Section header={<Text>识别扫描件用（要留在屏幕上）</Text>}>
        <WebView controller={web} frame={{ width: 320, height: 453 }} />
      </Section>
    </List>
  </NavigationStack>
}
