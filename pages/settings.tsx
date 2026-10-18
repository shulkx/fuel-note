// 设置
import { Button, HStack, List, NavigationLink, NavigationStack, Picker, Script, Section, Spacer, Text, Toggle, VStack, useState } from "scripting"
import {
  addVehicle, amapKey, AppData, azureConfigured, errorText, exportData, maskSecret, PROVIDERS, providerCredential, searcherName, setAmapKey,
  StationSearchMode, testAmapKey, updateSettings, xxyhConnected,
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
  const [testing, setTesting] = useState(false)

  async function newVehicle() {
    const name = await Dialog.prompt({ title: "添加车辆", placeholder: "车辆名称，例如：S90" })
    if (name == null || !name.trim()) return
    app.setData(addVehicle(app.getData(), name.trim(), 95))
  }

  /** 填写高德 key：先实际查一次附近油站，能用才保存；不能用时可以选择仍然保存 */
  async function editAmapKey() {
    const key = await Dialog.prompt({ title: "高德 Web 服务 key", message: "用于查找附近的新油站。留空表示删除。", defaultValue: "", placeholder: "key" })
    if (key == null) return
    if (!key.trim()) {
      setAmapKey("")
      app.setData(app.getData())
      return
    }
    setTesting(true)
    try {
      const msg = await testAmapKey(key.trim())
      setAmapKey(key.trim())
      app.setData(app.getData()) // 刷新显示
      await Dialog.alert({ title: "已保存", message: `高德 key 可用：${msg}` })
    } catch (e) {
      const i = await Dialog.actionSheet({ title: "高德 key 无法使用", message: errorText(e), actions: [{ label: "仍然保存" }] })
      if (i === 0) {
        setAmapKey(key.trim())
        app.setData(app.getData())
      }
    } finally {
      setTesting(false)
    }
  }

  async function checkAmapKey() {
    const key = amapKey()
    if (!key) return
    setTesting(true)
    try {
      await Dialog.alert({ title: "测试成功", message: `高德 key 可用：${await testAmapKey(key)}` })
    } catch (e) {
      await Dialog.alert({ title: "测试失败", message: errorText(e) })
    } finally {
      setTesting(false)
    }
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
        <Button action={editAmapKey} disabled={testing}>
          <Detail title="高德 Web 服务 key" detail={testing ? "验证中…" : maskSecret(amapKey())} />
        </Button>
        {amapKey() ? <Button title={testing ? "测试中…" : "测试高德 key"} systemImage="bolt.horizontal" action={checkAmapKey} disabled={testing} /> : null}
      </Section>

      <Section title="识别">
        <NavigationLink destination={<RecognizeSettings data={data} app={app} />}>
          <Detail title="截图识别" detail={azureConfigured() ? (data.ledger.settings.ocr_review ? "本机 + Azure 复核" : "本机 + Azure") : "本机"} />
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
