// 设置
import { Button, HStack, List, NavigationLink, NavigationStack, Script, Section, Spacer, Text, Toggle, VStack } from "scripting"
import {
  addVehicle, AppData, exportData, OCR_ENGINE_TITLES, PROVIDERS, providerCredential, searcherName, updateSettings, xxyhConnected,
} from "../common/model"
import { AppActions, showError } from "./components"
import { ProviderSettings } from "./provider_settings"
import { RecognizeSettings } from "./recognize_settings"
import { StationSearchSettings } from "./station_search_settings"
import { VehicleEdit } from "./vehicle_edit"
import { XxyhSettings } from "./xxyh_settings"

function Detail({ title, detail }: { title: string; detail: string }) {
  return <HStack foregroundStyle="label">
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" lineLimit={1}>{detail}</Text>
  </HStack>
}

export function SettingsPage({ data, app }: { data: AppData; app: AppActions }) {
  async function newVehicle() {
    const name = await Dialog.prompt({ title: "添加车辆", placeholder: "车辆名称，例如：S90" })
    if (name == null || !name.trim()) return
    app.setData(addVehicle(app.getData(), name.trim(), 95))
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
        {data.ledger.vehicles.map(v => <NavigationLink key={v.id} destination={<VehicleEdit data={data} app={app} vehicleId={v.id} />}>
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
        {PROVIDERS.map(p => <NavigationLink key={p.id} destination={<ProviderSettings data={data} app={app} provider={p} />}>
          <Detail title={p.name} detail={providerCredential(p.id) ? "已连接" : "未连接"} />
        </NavigationLink>)}
      </Section>

      <Section title="记加油">
        <NavigationLink destination={<StationSearchSettings data={data} app={app} />}>
          <Detail title="油站搜索" detail={searcherName(data)} />
        </NavigationLink>
        <NavigationLink destination={<RecognizeSettings data={data} app={app} />}>
          <Detail title="截图识别" detail={OCR_ENGINE_TITLES[data.ledger.settings.ocr_engine]} />
        </NavigationLink>
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
