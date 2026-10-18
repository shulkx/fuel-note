// 添加车辆（设计文档 17.4 节）：名称、车型（与小熊相同的品牌 → 车系 → 车型）、默认标号、购车日期、车辆数据。
// 1.1.7 只能保存在本机；1.1.8 加「保存位置」，连接小熊时默认存小熊。
import {
  Button, DatePicker, HStack, List, Navigation, NavigationStack, Picker, ProgressView, Section, Spacer, Text, TextField, useEffect, useState,
} from "scripting"
import {
  AppData, CarSpec, errorText, fmtDate, gradeOf, GRADES, gradeText, NewVehicle, profileFromSpec, ProviderId, PROVIDERS, providerCredential,
  providerVehicles, RemoteVehicle,
} from "../common/model"
import { FieldRow } from "./components"
import { ModelPicker } from "./model_picker"

function Info({ title, value }: { title: string; value: string }) {
  return <HStack>
    <Text foregroundStyle="secondaryLabel">{title}</Text>
    <Spacer />
    <Text multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

/** 车辆数据：每个已连接的提供方一项，可以选一辆远端车辆或不关联 */
function ProviderChoice({ data, providerId, value, onChanged }: {
  data: AppData; providerId: ProviderId; value: string; onChanged: (rv: RemoteVehicle | null) => void
}) {
  const provider = PROVIDERS.find(p => p.id === providerId)!
  const [list, setList] = useState<RemoteVehicle[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    providerVehicles(provider.id).then(v => { if (alive) setList(v) }, e => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [])
  if (error) return <Info title={provider.name} value={`读取失败：${error}`} />
  if (!list) return <HStack><Text>{provider.name}</Text><Spacer /><ProgressView /></HStack>
  const owner = (rv: RemoteVehicle) => data.ledger.vehicles.find(v => v.provider?.id === provider.id && v.provider.vehicle_id === rv.id)
  return <Picker title={provider.name} value={value} onChanged={(id: string) => onChanged(list.find(rv => rv.id === id) || null)} pickerStyle="menu">
    <Text tag="">不关联</Text>
    {list.map(rv => {
      const o = owner(rv)
      return <Text key={rv.id} tag={rv.id}>{o ? `${rv.name}（现在关联「${o.name}」）` : rv.name}</Text>
    })}
  </Picker>
}

export function VehicleAdd({ data }: { data: AppData }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState("")
  const [spec, setSpec] = useState<CarSpec | null>(null)
  const [grade, setGrade] = useState<number>(95)
  const [gradeTouched, setGradeTouched] = useState(false)
  const [buyTs, setBuyTs] = useState(Date.now())
  // 一辆车只能关联一辆远端车辆
  const connected = PROVIDERS.filter(p => providerCredential(p.id))
  const [link, setLink] = useState<{ providerId: ProviderId; rv: RemoteVehicle } | null>(null)

  async function chooseModel() {
    const picked = await Navigation.present<CarSpec | null>({ element: <ModelPicker /> })
    if (!picked) return
    setSpec(picked)
    const g = gradeOf(picked.gas_type, picked.fuel_type)
    if (g != null && !gradeTouched) setGrade(g)
  }

  function save() {
    const result: NewVehicle = {
      name: name.trim(),
      grade,
      profile: profileFromSpec(spec, fmtDate(buyTs)),
      provider: link ? { id: link.providerId, vehicle_id: link.rv.id, name: link.rv.name } : null,
    }
    dismiss(result)
  }

  return <NavigationStack>
    <List
      navigationTitle="添加车辆"
      navigationBarTitleDisplayMode="inline"
      toolbar={{
        cancellationAction: <Button title="取消" action={() => dismiss(null)} />,
        confirmationAction: <Button title="添加" action={save} disabled={!name.trim()} />,
      }}
    >
      <Section key="name">
        <FieldRow title="名称">
          <TextField title="名称" value={name} onChanged={setName} prompt="例如：S60" multilineTextAlignment="trailing" />
        </FieldRow>
      </Section>

      <Section key="model" header={<Text>车型</Text>} footer={<Text>与小熊油耗相同：品牌 → 车系 → 车型，可以不选。</Text>}>
        <Button action={chooseModel}>
          <HStack>
            <Text foregroundStyle="label">{spec ? spec.name : "选择车型"}</Text>
            <Spacer />
            <Text foregroundStyle="secondaryLabel">{spec ? "更换" : "未选择"}</Text>
          </HStack>
        </Button>
        {spec ? <Info title="燃料" value={[spec.fuel_type, spec.gas_type].filter(Boolean).join(" · ") || "—"} /> : null}
        {spec && spec.engine ? <Info title="发动机" value={spec.engine} /> : null}
        {spec && spec.gearbox ? <Info title="变速箱" value={spec.gearbox} /> : null}
        {spec && spec.tank ? <Info title="油箱" value={`${spec.tank} L`} /> : null}
        {spec ? <Button title="不选车型" role="destructive" action={() => setSpec(null)} /> : null}
      </Section>

      <Section key="profile" header={<Text>车辆资料</Text>} footer={<Text>默认标号按车型预填，可以修改。</Text>}>
        <Picker title="默认标号" value={grade} onChanged={(g: number) => { setGrade(g); setGradeTouched(true) }} pickerStyle="menu">
          {GRADES.map(g => <Text key={String(g)} tag={g}>{gradeText(g)}</Text>)}
        </Picker>
        <DatePicker title="购车日期" value={buyTs} onChanged={setBuyTs} displayedComponents={["date"]} />
      </Section>

      {connected.length ? <Section key="provider" header={<Text>车辆数据</Text>} footer={<Text>关联后，记加油时可以从行程填入里程、时间和油站。</Text>}>
        {connected.map(p => <ProviderChoice
          key={p.id}
          data={data}
          providerId={p.id}
          value={link && link.providerId === p.id ? link.rv.id : ""}
          onChanged={rv => setLink(rv ? { providerId: p.id, rv } : link && link.providerId === p.id ? null : link)}
        />)}
      </Section> : null}
    </List>
  </NavigationStack>
}
