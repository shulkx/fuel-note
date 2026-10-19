// 记加油 / 编辑加油。最上面的「自动填写」组（设计文档第 16 节）：
// - 选一张付款截图或拍一张小票：识别金额、油品和时间，再按付款时间匹配加油停车，填好里程和油站；
// - 不选图片时：从加油停车提示的「记一笔」进入直接用这次停车；其他入口只给建议，点「填入」才填。
// 自动填的字段在字段名后面标出来源；手动改过的字段不再被自动覆盖。
import {
  Button, DatePicker, Form, HStack, Image, Navigation, NavigationStack, Picker, ProgressView, ScrollView, Section, Spacer, Text, TextField,
  Toggle, VirtualNode, VStack, useEffect, useMemo, useRef, useState,
} from "scripting"
import {
  amountFixes, AppData, cachedStops, canReadTrips, checkFuel, completeTriple, decideGrade, derivedEvidence, errorText, FieldSource,
  fillFromReceipt, fillWarnings, findDuplicate, fmtShort, FuelData, fuelRecords, GradeDecision, gradeEvidence, GRADES, gradeText,
  ImageOrigin, isInferred, keptNumber, MoneyField, numText, openStopIn, parseNum, priceCityFor, priceRefFor, ReceiptFill, ReceiptResult, recognizeImage,
  SOURCE_TITLES, Station, Stop, StopChoice, stopForPayment, Triple, TripleField, usualGrade, Vehicle, vehicleStops,
} from "../common/model"
import { FieldLabel, FieldRow, joinWhen, km, money, showError, SourceTag, stopWhen, stopWhere } from "./components"
import { StationPicker } from "./station_picker"
import { StopPicker } from "./stop_picker"

export type FuelFormResult = { fuel: FuelData; newStation: Station | null }

export type FuelFormProps = {
  data: AppData
  vehicle: Vehicle
  /** 编辑时的原记录 */
  record: (FuelData & { id: string }) | null
  /** 从加油停车提示的「记一笔」进入时，直接用这次停车填入里程、时间和油站 */
  initialStop?: Stop | null
}

type Field = "ts" | "odometer" | "station" | MoneyField | "grade"
/** 自动填的字段从哪里来（显示来源标记）；手动改过后去掉 */
type Sources = Partial<Record<Field, FieldSource>>
type Photo = { image: UIImage; thumb: UIImage }
type Recognition =
  | { state: "running"; step: string }
  | { state: "done"; summary: string; detail: string; checked: boolean }
  | { state: "failed"; error: string }

const text = (n: number | null | undefined, digits = 2) => numText(n ?? null, digits)
const minute = (ts: number) => Math.floor(ts / 60e3)
const thumbOf = (img: UIImage): UIImage => img.preparingThumbnail({ width: 96, height: Math.round(96 * img.height / Math.max(1, img.width)) }) || img

function TripRow({ title, detail, button }: { title: string; detail: string; button: VirtualNode }) {
  return <HStack spacing={12}>
    <Image systemName="car.side" foregroundStyle="systemGreen" />
    <VStack alignment="leading" spacing={2}>
      <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{title}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
    </VStack>
    <Spacer />
    {button}
  </HStack>
}

function ImageRow({ photo, title, detail, busy, button }: { photo: Photo; title: string; detail: string; busy: boolean; button: VirtualNode | null }) {
  return <HStack spacing={12}>
    <Image image={photo.thumb} resizable scaleToFill frame={{ width: 34, height: 72 }} clipShape={{ type: "rect", cornerRadius: 6 }} />
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={6}>
        {busy ? <ProgressView controlSize="small" /> : null}
        <Text font="subheadline" fontWeight="semibold" lineLimit={2}>{title}</Text>
      </HStack>
      {detail ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{detail}</Text> : null}
    </VStack>
    <Spacer />
    {button}
  </HStack>
}

function Tile({ title, systemImage, action }: { title: string; systemImage: string; action: () => void }) {
  return <Button action={action} buttonStyle="plain">
    <VStack spacing={6} frame={{ width: 56, height: 100 }} background={{ style: "tertiarySystemFill", shape: { type: "rect", cornerRadius: 12 } }}>
      <Image systemName={systemImage} font="title3" foregroundStyle="systemBlue" />
      <Text font="caption" foregroundStyle="systemBlue">{title}</Text>
    </VStack>
  </Button>
}

const stopDetail = (s: Stop) => [stopWhere(s), km(Math.floor(s.odometer_km))].join(" · ")

function docTitle(f: ReceiptFill, r: ReceiptResult): string {
  if (f.source === "screenshot") return "付款截图"
  return r.doc_type === "pump_display" ? "加油机照片" : "小票"
}

export function FuelForm({ data, vehicle, record, initialStop }: FuelFormProps) {
  const dismiss = Navigation.useDismiss()
  const others = useMemo(() => fuelRecords(data, vehicle).filter(r => !record || r.id !== record.id), [data, vehicle, record])
  const [tripsOn] = useState(() => canReadTrips(vehicle))
  const fromStop = !record && initialStop ? initialStop : null

  const [ts, setTs] = useState(record?.ts ?? fromStop?.end_ts ?? Date.now())
  const [odometer, setOdometer] = useState(record ? String(record.odometer) : fromStop ? String(Math.floor(fromStop.odometer_km)) : "")
  const [price, setPrice] = useState(text(record?.price))
  const [liters, setLiters] = useState(text(record?.liters))
  const [amount, setAmount] = useState(text(record?.amount))
  const [paid, setPaid] = useState(text(record?.paid))
  const [paidEdited, setPaidEdited] = useState(!!record && record.paid !== record.amount)
  const [edited, setEdited] = useState<TripleField[]>(record ? ["price", "liters"] : [])
  const [grade, setGrade] = useState<number>(record?.grade ?? usualGrade(data, vehicle) ?? 95)
  const [full, setFull] = useState(record ? record.full : data.ledger.settings.default_full)
  const [lightOn, setLightOn] = useState(record?.light_on ?? false)
  const [missed, setMissed] = useState(record?.missed_before ?? false)
  const [station, setStation] = useState<{ station: Station; isNew: boolean } | null>(() => {
    if (fromStop?.candidate) return { station: fromStop.candidate.station, isNew: fromStop.candidate.kind === "new" }
    if (!record?.station_id) return null
    const list = vehicle.xxyh_car && data.xxyh.base ? data.mirror.stations : data.ledger.stations
    const s = list.find(x => x.id === record.station_id)
    return s ? { station: s, isNew: false } : null
  })
  const [remark, setRemark] = useState(record?.remark ?? "")
  const [stopPoint, setStopPoint] = useState<[number, number] | null>(fromStop?.place ? [fromStop.place.lng, fromStop.place.lat] : null)

  // 行程：已填入的停车、读到的停车（先用缓存，再用最新的）、读取失败的原因
  const [applied, setApplied] = useState<Stop | null>(fromStop)
  const [stops, setStops] = useState<Stop[] | null>(() => (!record && tripsOn ? cachedStops(data, vehicle) : null))
  const [tripError, setTripError] = useState<string | null>(null)
  const [sources, setSources] = useState<Sources>(() => (fromStop ? { ts: "trip", odometer: "trip", ...(fromStop.candidate ? { station: "trip" as const } : {}) } : {}))

  // 图片：最近的照片、能不能粘贴、选中的图片、识别状态和结果
  const [recent, setRecent] = useState<Photo[] | null>(null)
  const [canPaste, setCanPaste] = useState(false)
  const [picked, setPicked] = useState<Photo | null>(null)
  const [recog, setRecog] = useState<Recognition | null>(null)
  const [fill, setFill] = useState<ReceiptFill | null>(null)
  const [gradeInfo, setGradeInfo] = useState<GradeDecision | null>(null)
  const [notes, setNotes] = useState<string[]>([])

  /** 打开时各输入框的内容：编辑记录时，与它相同的字段算没改过 */
  const opened = useRef({ odometer, price, liters, amount, paid, grade, remark, station: station ? station.station.id : null })

  /** 手动改过的字段：之后的自动填写不覆盖 */
  const touched = useRef(new Set<Field>())
  /** 程序填入的值：输入框回调同样的值时不算手动修改 */
  const filled = useRef<Partial<Record<Field, string | number>>>(fromStop ? { ts: fromStop.end_ts, odometer: String(Math.floor(fromStop.odometer_km)) } : {})
  /** 识别的序号：换了图片后，旧的识别结果不再使用 */
  const run = useRef(0)

  useEffect(() => {
    if (record) return
    let alive = true
    // 与记录页共用同一次读取：App 启动时已经开始的请求不会重复发
    if (tripsOn) {
      vehicleStops(data, vehicle).then(
        s => { if (alive) { setStops(s); setTripError(null) } },
        e => { if (alive) setTripError(errorText(e)) },
      )
    }
    Photos.getLatestPhotos(6).then(list => {
      if (alive && list && list.length) setRecent(list.map(image => ({ image, thumb: thumbOf(image) })))
    }).catch(() => undefined)
    Pasteboard.hasImages.then(v => { if (alive) setCanPaste(v) }).catch(() => undefined)
    return () => { alive = false }
  }, [])

  const suggestion = !record && !applied && stops ? openStopIn(data, vehicle, stops) : null
  const prev = others.filter(r => r.ts <= ts).sort((a, b) => b.ts - a.ts)[0] || null

  function drop(field: Field) {
    setSources(s => {
      if (!s[field]) return s
      const n = { ...s }
      delete n[field]
      return n
    })
  }

  /** 输入框、选择器的回调：值与程序填入的不同才算手动修改 */
  function userSet(field: Field, value: string | number) {
    const f = filled.current[field]
    const same = f !== undefined && (field === "ts" ? minute(Number(value)) === minute(Number(f)) : String(value) === String(f))
    if (same) return
    touched.current.add(field)
    drop(field)
  }

  /** 用一次停车填入里程、时间、油站。auto 为 true 时（识别图片后）不覆盖手动改过的字段 */
  function applyStop(stop: Stop, opts: { keepTime?: boolean; auto?: boolean } = {}) {
    const can = (f: Field) => !(opts.auto && touched.current.has(f))
    const next: Sources = {}
    if (can("odometer")) {
      const odo = String(Math.floor(stop.odometer_km))
      setOdometer(odo)
      filled.current.odometer = odo
      next.odometer = "trip"
    }
    if (!record && !opts.keepTime && can("ts")) {
      setTs(stop.end_ts)
      filled.current.ts = stop.end_ts
      next.ts = "trip"
    }
    if (stop.place) setStopPoint([stop.place.lng, stop.place.lat])
    if (stop.candidate && can("station")) {
      setStation({ station: stop.candidate.station, isNew: stop.candidate.kind === "new" })
      next.station = "trip"
    }
    if (!opts.auto) for (const f of Object.keys(next) as Field[]) touched.current.delete(f)
    setSources(s => ({ ...s, ...(stop.candidate || opts.auto ? {} : { station: undefined }), ...next }))
    setApplied(stop)
  }

  /** 识别结果填入金额、时间（不覆盖手动改过的字段） */
  function applyFill(f: ReceiptFill) {
    const can = (field: Field) => !touched.current.has(field)
    const next: Sources = {}
    const setters: Record<MoneyField, (v: string) => void> = { price: setPrice, liters: setLiters, amount: setAmount, paid: setPaid }
    for (const field of ["price", "liters", "amount", "paid"] as MoneyField[]) {
      const v = f[field]
      if (v == null || !can(field)) continue
      const s = text(v)
      setters[field](s)
      filled.current[field] = s
      next[field] = f.derived.includes(field) ? "derived" : f.source
    }
    if (next.price || next.liters || next.amount) setEdited(["price", "liters"])
    if (next.paid) setPaidEdited(!f.derived.includes("paid"))
    if (f.ts != null && f.tsSource && !record && can("ts")) {
      setTs(f.ts)
      filled.current.ts = f.ts
      next.ts = f.tsSource
    }
    setSources(s => ({ ...s, ...next }))
  }

  async function recognizePhoto(photo: Photo, origin: ImageOrigin, captureTs: number | null) {
    const id = ++run.current
    setPicked(photo)
    setRecog({ state: "running", step: "正在识别…" })
    setNotes([])
    const settings = data.ledger.settings
    setRecog({ state: "running", step: settings.ocr_engine === "local" ? "正在识别…" : "正在用大模型识别…" })
    const out = await recognizeImage(photo.image, settings)
    if (run.current !== id) return
    const f = out.result ? fillFromReceipt(out.result, origin, captureTs, Date.now()) : null
    if (!f || !out.result) {
      setRecog({ state: "failed", error: out.error || "图片里没有读到加油信息" })
      return
    }
    applyFill(f)
    setFill(f)
    const when = f.ts != null ? `${f.tsSource === "camera" ? "拍照" : "交易时间"} ${fmtShort(f.ts)}` : "图上没有时间"
    setRecog({ state: "done", summary: out.summary, detail: [docTitle(f, out.result), when].join(" · "), checked: out.checked })
    await afterFill(f, id)
  }

  /** 填入识别结果之后：有付款时间时匹配加油停车，判断标号，列出提醒 */
  async function afterFill(f: ReceiptFill, id: number) {
    // 有付款时间：直接用付款前最近的一次加油停车（设计文档 16.5 节）
    let list = stops
    let choice: StopChoice = null
    if (tripsOn && f.payTs != null) {
      try {
        list = await vehicleStops(data, vehicle, { needAfter: f.payTs })
        if (run.current === id) { setStops(list); setTripError(null) }
      } catch (e) {
        if (run.current === id) setTripError(errorText(e))
      }
      if (run.current !== id) return
      choice = list ? stopForPayment(list, f.payTs) : null
      if (choice) applyStop(choice.stop, { keepTime: f.tsSource != null, auto: true })
    }

    // 标号：图上印的 → 当天油价 → 近期最常加的
    const st = choice?.stop.candidate?.station ?? station?.station ?? null
    const { city, province } = priceCityFor(data, vehicle, st, choice?.stop ?? applied)
    const ref = f.price != null ? await priceRefFor(city, province, f.ts ?? Date.now()).catch(() => null) : null
    if (run.current !== id) return
    const g = decideGrade(f.printedGrade, f.source, f.price, ref, usualGrade(data, vehicle) ?? 95)
    if (!touched.current.has("grade")) {
      setGrade(g.grade)
      filled.current.grade = g.grade
      setSources(s => ({ ...s, grade: g.source }))
    }
    setGradeInfo(g)
    setNotes(fillWarnings({ fill: f, choice, stops: list, tripsOn, stationName: st?.name ?? null, grade: g }))
  }

  async function takePhoto() {
    try {
      const img = await Photos.takePhoto()
      if (img) await recognizePhoto({ image: img, thumb: thumbOf(img) }, "camera", Date.now())
    } catch (e) { await showError("无法拍照", e) }
  }

  async function pickPhoto() {
    try {
      const list = await Photos.pickPhotos(1)
      if (list && list[0]) await recognizePhoto({ image: list[0], thumb: thumbOf(list[0]) }, "library", null)
    } catch (e) { await showError("无法读取照片", e) }
  }

  async function paste() {
    const img = await Pasteboard.getImage().catch(() => null)
    if (img) await recognizePhoto({ image: img, thumb: thumbOf(img) }, "paste", null)
    else await Dialog.alert({ title: "剪贴板里没有图片", message: "请先在相册或截图里点「拷贝」。" })
  }

  function onTs(v: number) {
    setTs(v)
    userSet("ts", v)
  }

  function onOdometer(v: string) {
    setOdometer(v)
    userSet("odometer", v)
  }

  /** 单价、升数、金额：记下手动改过的顺序，自动算第三项 */
  function onTriple(field: TripleField, value: string) {
    if (filled.current[field] === value && sources[field]) return // 程序填入的值回调回来
    userSet(field, value)
    const nextEdited = [...edited.filter(f => f !== field), field]
    setEdited(nextEdited)
    const values: Triple = {
      price: parseNum(field === "price" ? value : price),
      liters: parseNum(field === "liters" ? value : liters),
      amount: parseNum(field === "amount" ? value : amount),
    }
    if (field === "price") setPrice(value)
    if (field === "liters") setLiters(value)
    if (field === "amount") setAmount(value)
    const r = completeTriple(values, nextEdited)
    let nextAmount = field === "amount" ? value : amount
    if (r.computed === "price") { setPrice(text(r.values.price)); drop("price") }
    if (r.computed === "liters") { setLiters(text(r.values.liters)); drop("liters") }
    if (r.computed === "amount") { nextAmount = text(r.values.amount); setAmount(nextAmount); drop("amount") }
    if (!paidEdited) setPaid(nextAmount)
  }

  /** 金额核对不通过时的改法 */
  function fixAmount(v: number) {
    const s = text(v)
    setAmount(s)
    touched.current.add("amount")
    drop("amount")
    if (!paidEdited) setPaid(s)
  }

  function fixLiters(v: number) {
    setLiters(text(v))
    touched.current.add("liters")
    drop("liters")
  }

  async function showInfo(field: Field) {
    const s = sources[field]
    if (!s) return
    if (field === "grade" && gradeInfo) {
      const options = GRADES.filter(g => g !== grade)
      const i = await Dialog.actionSheet({
        title: `标号：${SOURCE_TITLES[s]}`,
        message: gradeEvidence(gradeInfo, parseNum(price)),
        actions: options.map(g => ({ label: `改为 ${gradeText(g)}` })),
      })
      if (i != null && i >= 0 && options[i] != null) {
        setGrade(options[i])
        touched.current.add("grade")
        drop("grade")
      }
      return
    }
    if (fill && (field === "price" || field === "liters" || field === "amount" || field === "paid")) {
      await Dialog.alert({ title: "推算", message: derivedEvidence(field, fill) })
    }
  }

  const tag = (field: Field): VirtualNode | null => {
    const s = sources[field]
    if (!s) return null
    return <SourceTag title={SOURCE_TITLES[s]} onInfo={isInferred(s) ? () => { void showInfo(field) } : undefined} />
  }

  // 编辑记录：没改过的字段用原值（输入框只显示两位小数；标号没填、油站已不在列表里时也照原样）
  const o = opened.current
  const stationId = station ? station.station.id : null
  const amountValue = keptNumber(amount, o.amount, record?.amount)
  const draft: FuelData = {
    ts,
    odometer: keptNumber(odometer, o.odometer, record?.odometer) ?? 0,
    liters: keptNumber(liters, o.liters, record?.liters) ?? 0,
    price: keptNumber(price, o.price, record?.price) ?? 0,
    amount: amountValue ?? 0,
    paid: keptNumber(paid, o.paid, record?.paid) ?? amountValue ?? 0,
    grade: record && grade === o.grade ? record.grade : grade,
    full,
    light_on: lightOn,
    missed_before: missed,
    station_id: record && stationId === o.station ? record.station_id : stationId,
    remark: record && remark === o.remark ? record.remark : remark.trim(),
  }
  const check = checkFuel(draft, others, record?.id)
  const fixes = amountFixes(draft.price, draft.liters, draft.amount)
  // 有改动时禁止下滑关闭，避免误操作丢掉已填的内容（编辑记录：与打开时比；新记录：填过内容）
  const dirty = record
    ? draft.ts !== record.ts || draft.odometer !== record.odometer || draft.liters !== record.liters || draft.price !== record.price
      || draft.amount !== record.amount || draft.paid !== record.paid || draft.grade !== record.grade || draft.full !== record.full
      || draft.light_on !== record.light_on || draft.missed_before !== record.missed_before || draft.station_id !== record.station_id
      || draft.remark !== record.remark
    : !!(odometer || price || liters || amount || remark.trim() || picked)
  const discount = draft.amount > 0 && draft.paid > 0 ? draft.amount - draft.paid : 0
  const odo = parseNum(odometer)
  const footer = prev
    ? `上一次 ${fmtShort(prev.ts)} · ${km(prev.odometer)}${odo != null && odo > prev.odometer ? `，本次行驶 ${km(odo - prev.odometer)}` : ""}`
    : null

  async function pickStop() {
    const stop = await Navigation.present<Stop | null>({ element: <StopPicker data={data} vehicle={vehicle} /> })
    if (stop) applyStop(stop)
  }

  async function pickStation() {
    const picked = await Navigation.present<{ station: Station; isNew: boolean } | null>({
      element: <StationPicker data={data} vehicle={vehicle} center={stopPoint} />,
    })
    if (picked) {
      setStation(picked)
      touched.current.add("station")
      drop("station")
    }
  }

  async function save() {
    // 编辑记录但什么都没改：直接关闭，不写数据
    if (record && !dirty) return dismiss(null)
    if (check.errors.length) {
      await Dialog.alert({ title: "还不能保存", message: check.errors.join("\n") })
      return
    }
    if (check.warnings.length) {
      const ok = await Dialog.confirm({ title: "请确认", message: check.warnings.join("\n"), confirmLabel: "仍然保存", cancelLabel: "返回修改" })
      if (!ok) return
    }
    if (!record) {
      const dup = findDuplicate(others, draft.ts, draft.amount)
      if (dup) {
        const i = await Dialog.actionSheet({
          title: "可能重复",
          message: `已有 ${fmtShort(dup.ts)} ${money(dup.amount)} 的加油记录。`,
          actions: [{ label: "仍然保存" }],
        })
        if (i !== 0) return
      }
    }
    const result: FuelFormResult = { fuel: draft, newStation: station && station.isNew ? station.station : null }
    dismiss(result)
  }

  // ---------- 自动填写 ----------

  let imageRow: VirtualNode | null = null
  if (!record) {
    if (picked && recog) {
      const change = <Button title="更换" action={() => { run.current++; setPicked(null); setRecog(null); setNotes([]) }} buttonStyle="bordered" controlSize="small" />
      imageRow = recog.state === "running"
        ? <ImageRow photo={picked} title={recog.step} detail="" busy button={null} />
        : recog.state === "done"
          ? <ImageRow photo={picked} title={`已识别 · ${recog.summary}`} detail={recog.detail} busy={false} button={change} />
          : <ImageRow photo={picked} title="未能识别" detail={recog.error} busy={false} button={change} />
    } else {
      imageRow = <ScrollView axes="horizontal" scrollIndicator="hidden">
        <HStack spacing={8}>
          <Tile title="拍照" systemImage="camera" action={() => { void takePhoto() }} />
          <Tile title="相册" systemImage="photo.on.rectangle" action={() => { void pickPhoto() }} />
          {canPaste ? <Tile title="粘贴" systemImage="doc.on.clipboard" action={() => { void paste() }} /> : null}
          {(recent || []).map((p, i) => <Button key={String(i)} action={() => { void recognizePhoto(p, "library", null) }} buttonStyle="plain">
            <Image image={p.thumb} resizable scaleToFill frame={{ width: 48, height: 100 }} clipShape={{ type: "rect", cornerRadius: 8 }} />
          </Button>)}
        </HStack>
      </ScrollView>
    }
  }

  // 读到的数字互相对不上（或缺少实付的依据）时，请用户对照图片
  const uncheckedRow = picked && recog && recog.state === "done" && !recog.checked
    ? <HStack spacing={6} alignment="top">
      <Image systemName="exclamationmark.triangle.fill" font="footnote" foregroundStyle="systemOrange" />
      <Text font="footnote" foregroundStyle="secondaryLabel">识别结果没能互相核对上，请对照图片检查单价、升数、金额和实付</Text>
    </HStack>
    : null

  // 行程：已填入 → 「更换」；有建议 → 「填入」；读取中 → 进度
  let tripRow: VirtualNode | null = null
  if (tripsOn && !record) {
    if (applied) {
      tripRow = <TripRow
        title={`${joinWhen("已填入", stopWhen(applied.end_ts))} 的${applied.refuel ? "加油停车" : "停车"}`}
        detail={stopDetail(applied)}
        button={<Button title="更换" action={pickStop} buttonStyle="bordered" controlSize="small" />}
      />
    } else if (suggestion) {
      tripRow = <TripRow
        title={`${joinWhen("发现", stopWhen(suggestion.end_ts))} 的加油停车`}
        detail={stopDetail(suggestion)}
        button={<Button title="填入" action={() => applyStop(suggestion)} buttonStyle="bordered" controlSize="small" tint="systemGreen" />}
      />
    } else if (!stops && !tripError) {
      tripRow = <HStack spacing={10}><ProgressView /><Text foregroundStyle="secondaryLabel">正在读取行程…</Text></HStack>
    }
  }

  const showAutofill = !record || tripsOn

  return <NavigationStack interactiveDismissDisabled={dirty}>
    <Form
      navigationTitle={record ? "编辑加油" : "记加油"}
      navigationBarTitleDisplayMode="inline"
      scrollDismissesKeyboard="interactively"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="保存" action={save} />,
        keyboard: <HStack><Spacer /><Button title="完成" action={() => Keyboard.hide()} /></HStack>,
      }}
    >
      {showAutofill ? <Section header={<Text>自动填写</Text>}>
        {imageRow}
        {uncheckedRow}
        {tripRow}
        {tripsOn && tripError && !applied ? <Text font="footnote" foregroundStyle="secondaryLabel" lineLimit={2}>{`读取行程失败：${tripError}`}</Text> : null}
        {tripsOn && (record || !applied) ? <Button title="从行程选择" systemImage="list.bullet" action={pickStop} /> : null}
        {notes.map((n, i) => <HStack key={String(i)} spacing={6} alignment="top">
          <Image systemName="exclamationmark.circle" font="footnote" foregroundStyle="systemOrange" />
          <Text font="footnote" foregroundStyle="secondaryLabel">{n}</Text>
        </HStack>)}
      </Section> : null}

      <Section header={<Text>时间与里程</Text>} {...(footer ? { footer: <Text>{footer}</Text> } : {})}>
        <HStack>
          <FieldLabel title="时间" source={tag("ts")} />
          <Spacer minLength={4} />
          <DatePicker title="时间" value={ts} onChanged={onTs} displayedComponents={["date", "hourAndMinute"]} labelsHidden />
        </HStack>
        <FieldRow title="里程" unit="公里" source={tag("odometer")}>
          <TextField title="里程" value={odometer} onChanged={onOdometer} prompt="表显里程" keyboardType="numberPad" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>

      <Section header={<Text>金额</Text>} footer={<Text>单价、升数、机显金额填任意两项，第三项自动算出</Text>}>
        <FieldRow title="单价" unit="元/升" source={tag("price")}>
          <TextField title="单价" value={price} onChanged={v => onTriple("price", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="升数" unit="升" source={tag("liters")}>
          <TextField title="升数" value={liters} onChanged={v => onTriple("liters", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="机显金额" unit="元" source={tag("amount")}>
          <TextField title="机显金额" value={amount} onChanged={v => onTriple("amount", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {fixes ? <VStack alignment="leading" spacing={8}>
          <HStack spacing={6} alignment="top">
            <Image systemName="exclamationmark.triangle.fill" font="footnote" foregroundStyle="systemOrange" />
            <Text font="footnote">{`${text(draft.price)} × ${text(draft.liters)} = ${fixes.amount.toFixed(2)}，与机显金额 ${draft.amount.toFixed(2)} 不符。请对照原图选择：`}</Text>
          </HStack>
          <HStack spacing={8}>
            <Button title={`金额改为 ${fixes.amount.toFixed(2)}`} action={() => fixAmount(fixes.amount)} buttonStyle="bordered" controlSize="small" />
            <Button title={`升数改为 ${fixes.liters.toFixed(2)}`} action={() => fixLiters(fixes.liters)} buttonStyle="bordered" controlSize="small" />
          </HStack>
        </VStack> : null}
        <FieldRow title="实付" unit="元" source={tag("paid")}>
          <TextField title="实付" value={paid} onChanged={v => { setPaid(v); setPaidEdited(true); userSet("paid", v) }} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {discount > 0.005 ? <HStack><Text foregroundStyle="secondaryLabel">优惠</Text><Spacer /><Text foregroundStyle="secondaryLabel">{money(discount)}</Text></HStack> : null}
      </Section>

      <Section title="油品">
        {sources.grade ? <HStack><FieldLabel title="标号" source={tag("grade")} /><Spacer /></HStack> : null}
        <Picker title="标号" value={grade} onChanged={(v: number) => { setGrade(v); userSet("grade", v) }} pickerStyle="segmented">
          {GRADES.map(g => <Text key={String(g)} tag={g}>{gradeText(g)}</Text>)}
        </Picker>
        <Toggle title="加满（跳枪）" value={full} onChanged={setFull} />
        <Toggle title="加油前油灯亮" value={lightOn} onChanged={setLightOn} />
        <Toggle title="上次加油漏记" value={missed} onChanged={setMissed} />
      </Section>

      <Section title="油站">
        <Button action={pickStation}>
          <HStack>
            <Text foregroundStyle={station ? "label" : "secondaryLabel"}>{station ? station.station.name : "选择油站"}</Text>
            <Spacer />
            {station ? tag("station") : null}
            {station?.isNew ? <Text font="caption" foregroundStyle="systemGreen">新油站</Text> : null}
            <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
          </HStack>
        </Button>
        {station ? <Button title="不填油站" role="destructive" action={() => { setStation(null); touched.current.add("station"); drop("station") }} /> : null}
      </Section>

      <Section title="备注">
        <TextField title="备注" value={remark} onChanged={setRemark} prompt="可选" axis="vertical" lineLimit={{ min: 1, max: 4 }} />
      </Section>

      {check.consumption != null ? <Section>
        <HStack><Text>本次油耗</Text><Spacer /><Text monospacedDigit>{`${check.consumption.toFixed(2)} L/100km`}</Text></HStack>
      </Section> : null}
    </Form>
  </NavigationStack>
}
