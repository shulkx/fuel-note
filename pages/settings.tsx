// 设置
import { Button, Capsule, HStack, List, NavigationLink, NavigationStack, Script, Section, Spacer, Text, Toggle, VStack } from "scripting"
import {
  AppData, currentVehicle, OCR_ENGINE_TITLES, PROVIDERS, providerCredential, searcherName, updateSettings, Vehicle, xxyhConnected,
} from "../common/model"
import { BackupSettings } from "./backup_settings"
import { AppActions } from "./components"
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

function VehicleRow({ data, app, vehicle, current }: { data: AppData; app: AppActions; vehicle: Vehicle; current: boolean }) {
  return <NavigationLink destination={<VehicleEdit data={data} app={app} vehicleId={vehicle.id} />}>
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={8}>
        <Text foregroundStyle={vehicle.hidden ? "secondaryLabel" : "label"}>{vehicle.name}</Text>
        {current ? <Text font="caption" fontWeight="semibold" foregroundStyle="systemGreen" padding={{ horizontal: 8, vertical: 2 }} background={<Capsule fill="rgba(52,199,89,0.16)" />}>当前</Text> : null}
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel">{[vehicle.xxyh_car ? "小熊油耗" : "只在本机", vehicle.provider ? vehicle.provider.name : ""].filter(Boolean).join(" · ")}</Text>
    </VStack>
  </NavigationLink>
}

export function SettingsPage({ data, app }: { data: AppData; app: AppActions }) {
  const current = currentVehicle(data)
  const shown = data.ledger.vehicles.filter(v => !v.hidden)
  const hidden = data.ledger.vehicles.filter(v => v.hidden)

  const x = data.xxyh
  const xxyhDetail = xxyhConnected(data) ? `v${x.base_version ?? "—"}${x.ops.length ? ` · ${x.ops.length} 条待上传` : ""}` : "未连接"

  return <NavigationStack>
    <List navigationTitle="设置">
      <Section title="车辆">
        {shown.map(v => <VehicleRow key={v.id} data={data} app={app} vehicle={v} current={v.id === current?.id} />)}
        <Button title="添加车辆" systemImage="plus" action={() => { app.addVehicle() }} />
      </Section>

      {hidden.length ? <Section key="hidden" header={<Text>已隐藏</Text>} footer={<Text>隐藏的车辆不出现在车辆菜单、统计和小组件里，记录照常保留和同步。点进去可以取消隐藏。</Text>}>
        {hidden.map(v => <VehicleRow key={v.id} data={data} app={app} vehicle={v} current={false} />)}
      </Section> : null}

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
        <NavigationLink destination={<BackupSettings data={data} app={app} />}>
          <Text>备份与恢复</Text>
        </NavigationLink>
      </Section>

      <Section>
        <Detail title="版本" detail={Script.metadata.version} />
      </Section>
    </List>
  </NavigationStack>
}
