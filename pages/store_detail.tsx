// 门店详情（2.1 设计第 10 节，画布 StDetail，从选择门店的 ⓘ 推入）：名称可改，改了到处跟着变；高德的全称、地址、电话、营业时间只读，
// 在地图中打开、重新定位（id 不变）；用到这家店的费用和权益卡；删除后它们变成不选门店。
import { Button, HStack, Image, List, NavigationLink, Section, Spacer, Text, useState } from "scripting"
import { AppData, canSearchStores, relocatedStore, storeUsage } from "../common/model"
import { StoreActions } from "./benefit_parts"
import { StoreSearchPage } from "./store_search"

function Info({ title, value }: { title: string; value: string }) {
  return <HStack alignment="top">
    <Text>{title}</Text>
    <Spacer />
    <Text foregroundStyle="secondaryLabel" multilineTextAlignment="trailing">{value}</Text>
  </HStack>
}

export function StoreDetail({ getData, storeId, stores, close }: { getData: () => AppData; storeId: string; stores: StoreActions; close: () => void }) {
  const [, setVersion] = useState(0)
  const data = getData()
  const s = data.ledger.stores.find(x => x.id === storeId)
  if (!s) return <List navigationTitle="门店"><Text foregroundStyle="secondaryLabel">这家门店已经删除。</Text></List>
  const store = s
  const usage = storeUsage(data.ledger, store.id)

  async function rename() {
    const name = (await Dialog.prompt({ title: "门店名称", message: "费用页和导出到小熊的费用备注里写的名称。", defaultValue: store.name, selectAll: true, confirmLabel: "保存" }))?.trim()
    if (!name || name === store.name) return
    stores.save({ ...store, name })
    setVersion(x => x + 1)
  }

  async function remove() {
    const choice = await Dialog.actionSheet({
      title: `删除「${store.name}」？`,
      message: `用到它的 ${usage.expenses} 笔费用和 ${usage.perks} 张权益卡变成不选门店，别的不变。`,
      actions: [{ label: "删除", destructive: true }],
    })
    if (choice !== 0) return
    stores.remove(store.id)
    close()
  }

  const openMap = () => Safari.openURL(`https://uri.amap.com/marker?position=${store.lng},${store.lat}&name=${encodeURIComponent(store.full_name || store.name)}&coordinate=wgs84&callnative=1`)
  return <List navigationTitle={store.name} navigationSubtitle="我的门店">
    <Section key="name" footer={<Text>费用页和导出到小熊的费用备注里写的都是这个名称，改了以后到处跟着变。</Text>}>
      <Button action={rename}>
        <HStack foregroundStyle="label">
          <Text>名称</Text>
          <Spacer />
          <Text foregroundStyle="secondaryLabel" lineLimit={1}>{store.name}</Text>
          <Image systemName="chevron.right" font="caption" foregroundStyle="tertiaryLabel" />
        </HStack>
      </Button>
    </Section>
    <Section key="amap" header={<Text>高德地点</Text>}
      footer={<Text>门店搬了或选错了：重新定位，在高德里重新选一次，换上新的资料；用到这家店的费用和权益卡不用改。</Text>}>
      {store.full_name ? <Text font="headline">{store.full_name}</Text> : null}
      {store.address ? <Info title="地址" value={store.address} /> : null}
      {store.phone ? <Button action={() => Safari.openURL(`tel:${store.phone.replace(/[^\d+]/g, "")}`)}>
        <HStack><Text foregroundStyle="label">电话</Text><Spacer /><Text>{store.phone}</Text></HStack>
      </Button> : null}
      {store.hours ? <Info title="营业时间" value={store.hours} /> : null}
      {store.lng != null && store.lat != null ? <Button title="在地图中打开" systemImage="mappin.and.ellipse" action={openMap} /> : null}
      {canSearchStores() ? <NavigationLink destination={<StoreSearchPage getData={getData} initial={store.full_name || store.name} title="重新定位"
        onPick={poi => { stores.save(relocatedStore(store, poi)); setVersion(x => x + 1) }} />}>
        <HStack><Image systemName="scope" foregroundStyle="accentColor" /><Text foregroundStyle="accentColor">重新定位</Text></HStack>
      </NavigationLink> : null}
    </Section>
    <Section key="usage" header={<Text>用到这家店</Text>}>
      <Info title="费用" value={`${usage.expenses} 笔`} />
      <Info title="权益卡" value={`${usage.perks} 张`} />
    </Section>
    <Section key="delete" footer={<Text>{`删除后，这 ${usage.expenses} 笔费用和 ${usage.perks} 张权益卡变成不选门店。`}</Text>}>
      <Button title="删除门店" role="destructive" action={remove} />
    </Section>
  </List>
}
