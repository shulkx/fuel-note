// 记加油 / 编辑加油
import {
  Button, DatePicker, Form, HStack, Image, Navigation, NavigationStack, Picker, Section, Spacer, Text, TextField, Toggle, useMemo, useState,
} from "scripting"
import {
  AppData, checkFuel, completeTriple, fmtShort, FuelData, fuelRecords, GRADES, gradeText, numText, parseNum, Station, Stop,
  Triple, TripleField, usualGrade, Vehicle,
} from "../common/model"
import { FieldRow, km, money } from "./components"
import { StationPicker } from "./station_picker"
import { StopPicker } from "./stop_picker"

export type FuelFormResult = { fuel: FuelData; newStation: Station | null }

export type FuelFormProps = {
  data: AppData
  vehicle: Vehicle
  /** 编辑时的原记录 */
  record: (FuelData & { id: string }) | null
  /** 从加油停车提示或「+」进入时，用这次加油停车预填里程、时间和油站 */
  initialStop?: Stop | null
}

const text = (n: number | null | undefined, digits = 2) => numText(n ?? null, digits)

export function FuelForm({ data, vehicle, record, initialStop }: FuelFormProps) {
  const dismiss = Navigation.useDismiss()
  const others = useMemo(() => fuelRecords(data, vehicle).filter(r => !record || r.id !== record.id), [data, vehicle, record])
  const prev = others.filter(r => r.ts <= (record?.ts ?? Date.now())).sort((a, b) => b.ts - a.ts)[0] || null

  const [ts, setTs] = useState(record?.ts ?? initialStop?.end_ts ?? Date.now())
  const [odometer, setOdometer] = useState(record ? String(record.odometer) : initialStop ? String(Math.floor(initialStop.odometer_km)) : "")
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
    if (!record && initialStop?.candidate) return { station: initialStop.candidate.station, isNew: initialStop.candidate.kind === "new" }
    if (!record?.station_id) return null
    const list = vehicle.xxyh_car && data.xxyh.base ? data.mirror.stations : data.ledger.stations
    const s = list.find(x => x.id === record.station_id)
    return s ? { station: s, isNew: false } : null
  })
  const [remark, setRemark] = useState(record?.remark ?? "")
  const [stopPoint, setStopPoint] = useState<[number, number] | null>(initialStop?.place ? [initialStop.place.lng, initialStop.place.lat] : null)

  /** 单价、升数、金额：记下手动改过的顺序，自动算第三项 */
  function onTriple(field: TripleField, value: string) {
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
    if (r.computed === "price") setPrice(text(r.values.price))
    if (r.computed === "liters") setLiters(text(r.values.liters))
    if (r.computed === "amount") { nextAmount = text(r.values.amount); setAmount(nextAmount) }
    if (!paidEdited) setPaid(nextAmount)
  }

  const draft: FuelData = {
    ts,
    odometer: parseNum(odometer) ?? 0,
    liters: parseNum(liters) ?? 0,
    price: parseNum(price) ?? 0,
    amount: parseNum(amount) ?? 0,
    paid: parseNum(paid) ?? parseNum(amount) ?? 0,
    grade,
    full,
    light_on: lightOn,
    missed_before: missed,
    station_id: station ? station.station.id : null,
    remark: remark.trim(),
  }
  const check = checkFuel(draft, others, record?.id)
  // 填过内容后禁止下滑关闭，避免误操作丢掉已填的内容
  const dirty = record
    ? draft.ts !== record.ts || draft.odometer !== record.odometer || draft.liters !== record.liters || draft.price !== record.price
      || draft.amount !== record.amount || draft.paid !== record.paid || draft.grade !== record.grade || draft.full !== record.full
      || draft.light_on !== record.light_on || draft.missed_before !== record.missed_before || draft.station_id !== record.station_id
      || draft.remark !== record.remark.trim()
    : !!(odometer || price || liters || amount || remark.trim())
  const discount = draft.amount > 0 && draft.paid > 0 ? draft.amount - draft.paid : 0

  async function pickStop() {
    const stop = await Navigation.present<Stop | null>({ element: <StopPicker data={data} vehicle={vehicle} /> })
    if (!stop) return
    setOdometer(String(Math.floor(stop.odometer_km)))
    if (!record) setTs(stop.end_ts)
    if (stop.place) setStopPoint([stop.place.lng, stop.place.lat])
    if (stop.candidate) setStation({ station: stop.candidate.station, isNew: stop.candidate.kind === "new" })
  }

  async function pickStation() {
    const picked = await Navigation.present<{ station: Station; isNew: boolean } | null>({
      element: <StationPicker data={data} vehicle={vehicle} center={stopPoint} />,
    })
    if (picked) setStation(picked)
  }

  async function save() {
    if (check.errors.length) {
      await Dialog.alert({ title: "还不能保存", message: check.errors.join("\n") })
      return
    }
    if (check.warnings.length) {
      const ok = await Dialog.confirm({ title: "请确认", message: check.warnings.join("\n"), confirmLabel: "仍然保存", cancelLabel: "返回修改" })
      if (!ok) return
    }
    const result: FuelFormResult = { fuel: draft, newStation: station && station.isNew ? station.station : null }
    dismiss(result)
  }

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
      <Section header={<Text>时间与里程</Text>} {...(prev ? { footer: <Text>{`上一次 ${fmtShort(prev.ts)} · ${km(prev.odometer)}`}</Text> } : {})}>
        <DatePicker title="时间" value={ts} onChanged={setTs} displayedComponents={["date", "hourAndMinute"]} />
        <FieldRow title="里程" unit="公里">
          <TextField title="里程" value={odometer} onChanged={setOdometer} prompt="表显里程" keyboardType="numberPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {vehicle.provider ? <Button title="从行程选择" systemImage="car.side" action={pickStop} /> : null}
      </Section>

      <Section header={<Text>金额</Text>} footer={<Text>单价、升数、机显金额填任意两项，第三项自动算出</Text>}>
        <FieldRow title="单价" unit="元/升">
          <TextField title="单价" value={price} onChanged={v => onTriple("price", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="升数" unit="升">
          <TextField title="升数" value={liters} onChanged={v => onTriple("liters", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="机显金额" unit="元">
          <TextField title="机显金额" value={amount} onChanged={v => onTriple("amount", v)} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        <FieldRow title="实付" unit="元">
          <TextField title="实付" value={paid} onChanged={v => { setPaid(v); setPaidEdited(true) }} prompt="0.00" keyboardType="decimalPad" multilineTextAlignment="trailing" />
        </FieldRow>
        {discount > 0.005 ? <HStack><Text foregroundStyle="secondaryLabel">优惠</Text><Spacer /><Text foregroundStyle="secondaryLabel">{money(discount)}</Text></HStack> : null}
      </Section>

      <Section title="油品">
        <Picker title="标号" value={grade} onChanged={(v: number) => setGrade(v)} pickerStyle="segmented">
          {GRADES.map(g => <Text tag={g}>{gradeText(g)}</Text>)}
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
            {station?.isNew ? <Text font="caption" foregroundStyle="systemGreen">新油站</Text> : null}
            <Image systemName="chevron.right" font="footnote" foregroundStyle="tertiaryLabel" />
          </HStack>
        </Button>
        {station ? <Button title="不填油站" role="destructive" action={() => setStation(null)} /> : null}
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
