// 设置
import { Button, HStack, List, NavigationLink, NavigationStack, Picker, Script, Section, Spacer, Text, Toggle, VStack } from "scripting"
import {
  addVehicle, amapKey, AppData, azureConfigured, exportData, maskSecret, PROVIDERS, providerCredential, searcherName, setAmapKey,
  StationSearchMode, updateSettings, xxyhConnected,
} from "../common/model"
import { AppActions, showError } from "./components"
import { ProviderSettings } from "./provider_settings"
import { RecognizeSettings } from "./recognize_settings"
import { VehicleEdit } from "./vehicle_edit"
import { XxyhSettings } from "./xxyh_settings"

const SEARCH_MODES: Array<{ value: StationSearchMode; title: string }> = [
  { value: "auto", title: "自动" },
  { value: "amap", title: "高德" },
  { value: "xxyh", title: "小熊油耗" },
  { value: "off", title: "关闭" },
]

function Detail({ title, detail }: { title: string; detail: string }) {
  return <HStack foregroundStyle="label">
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel">{detail}</Text>
  </HStack>
}

export function SettingsPage({ data, app }: { data: AppData; app: AppActions }) {
  async function newVehicle() {
    const name = await Dialog.prompt({ title: "添加车辆", placeholder: "车辆名称，例如：S90" })
    if (name == null || !name.trim()) return
    app.setData(addVehicle(app.getData(), name.trim(), 95))
  }

  async function editAmapKey() {
    const key = await Dialog.prompt({ title: "高德 Web 服务 key", message: "用于查找附近的新油站。留空表示删除。", defaultValue: "", placeholder: "key" })
    if (key == null) return
    setAmapKey(key)
    app.setData(app.getData()) // 刷新显示
  }

  async function doExport() {
    try {
      const path = exportData(app.getData())
      // 文件保存在 Scripting 的文稿目录（「文件」App 中可见），同时弹出分享面板，方便存到别处
      await ShareSheet.present([path])
    } catch (e) {
      await showError("导出失败", e)
    }
  }

  const x = data.xxyh
  const xxyhDetail = xxyhConnected(data) ? `v${x.base_version ?? "—"}${x.ops.length ? ` · ${x.ops.length} 条待上传` : ""}` : "未连接"

  return <NavigationStack>
    <List navigationTitle="设置">
      <Section title="车辆">
        {data.ledger.vehicles.map(v => <NavigationLink destination={<VehicleEdit data={data} app={app} vehicleId={v.id} />}>
          <VStack alignment="leading" spacing={3}>
            <Text>{v.name}</Text>
            <Text font="caption" foregroundStyle="secondaryLabel">{[v.xxyh_car ? "小熊油耗" : "本机", v.provider ? v.provider.name : ""].filter(Boolean).join(" · ")}</Text>
          </VStack>
        </NavigationLink>)}
        <Button title="添加车辆" systemImage="plus" action={newVehicle} />
      </Section>

      <Section title="同步">
        <NavigationLink destination={<XxyhSettings data={data} app={app} />}>
          <Detail title="小熊油耗" detail={xxyhDetail} />
        </NavigationLink>
      </Section>

      <Section title="车辆数据">
        {PROVIDERS.map(p => <NavigationLink destination={<ProviderSettings data={data} app={app} provider={p} />}>
          <Detail title={p.name} detail={providerCredential(p.id) ? "已连接" : "未连接"} />
        </NavigationLink>)}
      </Section>

      <Section header={<Text>油站搜索</Text>} footer={<Text>{`当前：${searcherName(data)}。「自动」在有高德 key 时用高德，否则用小熊油耗的附近油站。`}</Text>}>
        <Picker title="附近油站" value={data.ledger.settings.station_search} onChanged={(v: string) => app.setData(updateSettings(app.getData(), { station_search: v as StationSearchMode }))} pickerStyle="menu">
          {SEARCH_MODES.map(m => <Text tag={m.value}>{m.title}</Text>)}
        </Picker>
        <Button action={editAmapKey}>
          <Detail title="高德 Web 服务 key" detail={maskSecret(amapKey())} />
        </Button>
      </Section>

      <Section title="识别">
        <NavigationLink destination={<RecognizeSettings />}>
          <Detail title="截图识别" detail={azureConfigured() ? "本机 + Azure" : "本机"} />
        </NavigationLink>
      </Section>

      <Section title="默认值">
        <Toggle title="默认加满" value={data.ledger.settings.default_full} onChanged={v => app.setData(updateSettings(app.getData(), { default_full: v }))} />
      </Section>

      <Section title="数据">
        <Button title="导出 JSON" systemImage="square.and.arrow.up" action={doExport} />
      </Section>

      <Section>
        <Detail title="版本" detail={Script.metadata.version} />
      </Section>
    </List>
  </NavigationStack>
}
