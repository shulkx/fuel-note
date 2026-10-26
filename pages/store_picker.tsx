// 选择门店（2.1 设计第 10 节，画布 StPicker）：记费用、添加权益、记一次使用都推入这一页。
// 我的门店都是高德地点（第二行写地址，ⓘ 进门店详情；带经销商代码的写「沃尔沃经销商」这类标签，2.1.0-beta.5）；
// 记费用时列出那时车停的地方附近，从养修填写时列出经销商附近；顶部搜索高德。选中高德的地点就存进我的门店，
// 已经在我的门店里的直接用那一家。没填高德 Key 时只能选已有的门店。
import { Button, EnvironmentValuesReader, HStack, Image, List, ProgressView, Section, Spacer, Text, useEffect, useState, VStack } from "scripting"
import {
  AppData, canSearchStores, currentVehicle, nearbyStores, parkedPlace, ProviderId, providerById, storeCandidates, storeFromPoi, storeOfPoi, Store, StorePoi, Vehicle,
  vehicleRecords,
} from "../common/model"
import { StoreActions } from "./benefit_parts"
import { StoreDetail } from "./store_detail"
import { PoiRow, StoreResults, useStoreSearch } from "./store_search"

export function StorePicker({ getData, selected, onPick, stores, near, query }: {
  getData: () => AppData
  selected: Store | null
  /** 选了一家（null = 不选门店） */
  onPick: (s: Store | null) => void
  stores: StoreActions
  /** 记费用时：按这一笔的时间找那时车停的地方，列出附近；从养修填写时按经销商的坐标（WGS-84） */
  near: NearBy | null
  /** 搜索框里先填好的名字（识别权益时认出的店名）；没有时 "" */
  query: string
}) {
  return <EnvironmentValuesReader keys={["dismiss"]}>{env =>
    <PickerList getData={getData} selected={selected} stores={stores} near={near} query={query} pick={s => { onPick(s); env.dismiss() }} />
  }</EnvironmentValuesReader>
}

export type NearBy = { vehicle: Vehicle; ts: number } | { point: [number, number]; label: string }

/** 门店的标签：带提供方经销商代码的写「沃尔沃经销商」 */
function dealerTag(s: Store): string | null {
  if (!s.dealer) return null
  const p = providerById(s.dealer.provider as ProviderId)
  return p && p.serviceTitle ? `${p.serviceTitle.replace(/养修$/, "")}经销商` : "经销商"
}

const nearDetail = (p: StorePoi) => [p.distance != null ? `${Math.round(p.distance)} m` : "", p.kind].filter(Boolean).join(" · ")

function PickerList({ getData, selected, stores, near, query, pick }: {
  getData: () => AppData
  selected: Store | null
  stores: StoreActions
  near: NearBy | null
  query: string
  pick: (s: Store | null) => void
}) {
  const [version, setVersion] = useState(0)
  const [q, setQ] = useState(query)
  const [detail, setDetail] = useState<string | null>(null)
  const [nearby, setNearby] = useState<StorePoi[] | null>(null)
  const canSearch = canSearchStores()
  const search = useStoreSearch(getData, canSearch ? q : "")
  const data = getData()
  const v = currentVehicle(data)
  const candidates = storeCandidates(data.ledger.stores, v ? vehicleRecords(data, v) : [])

  useEffect(() => {
    if (!canSearch || !near) return
    let alive = true
    const where = "point" in near ? Promise.resolve({ lng: near.point[0], lat: near.point[1] }) : parkedPlace(getData(), near.vehicle, near.ts)
    where
      .then(place => (place ? nearbyStores([place.lng, place.lat]) : []))
      .then(pois => { if (alive) setNearby(pois) })
      .catch(() => { if (alive) setNearby([]) })
    return () => { alive = false }
  }, [])

  function pickPoi(poi: StorePoi) {
    pick(storeOfPoi(getData().ledger.stores, poi.poi_id) ?? stores.save(storeFromPoi(poi)))
  }

  const when = near && "ts" in near ? `${new Date(near.ts).getMonth() + 1}/${new Date(near.ts).getDate()}` : ""
  const detailStore = detail ? data.ledger.stores.find(s => s.id === detail) : undefined
  return <List
    navigationTitle="选择门店"
    {...(canSearch ? { searchable: { value: q, onChanged: setQ, prompt: "搜索高德地点" } } : {})}
    navigationDestination={{
      content: detailStore ? <StoreDetail getData={getData} storeId={detailStore.id} stores={stores} close={() => setDetail(null)} /> : <Text>{String(version)}</Text>,
      isPresented: !!detailStore,
      onChanged: shown => {
        if (shown) return
        setDetail(null)
        setVersion(version + 1)
      },
    }}
  >
    {canSearch && q.trim() ? <StoreResults search={search} stores={data.ledger.stores} onPick={pickPoi} /> : <>
      <Section key="none">
        <Button action={() => pick(null)}>
          <HStack foregroundStyle="label">
            <Text>不选门店</Text>
            <Spacer />
            {selected ? null : <Image systemName="checkmark" foregroundStyle="accentColor" />}
          </HStack>
        </Button>
      </Section>
      <Section key="mine" header={<Text>我的门店</Text>}
        footer={<Text>{canSearch
          ? "我的门店都是高德上的地点。新的门店从附近或搜索里选，选中就存进我的门店；已经在我的门店里的地点直接用那一家。轻点 ⓘ 看门店详情。"
          : "在「设置 › 油站搜索」里填高德 Key 以后，才能搜索、添加新的门店。已有的门店照常选。"}</Text>}>
        {candidates.length ? candidates.map(c => <HStack key={c.store.id}>
          <Button action={() => pick(c.store)} buttonStyle="plain">
            <HStack foregroundStyle="label" contentShape="rect">
              <VStack alignment="leading" spacing={2}>
                <HStack spacing={6}>
                  <Text lineLimit={1}>{c.store.name}</Text>
                  {dealerTag(c.store) ? <Text font="caption2" foregroundStyle="secondaryLabel" padding={{ horizontal: 6, vertical: 1 }}
                    background={{ style: "quaternarySystemFill", shape: { type: "rect", cornerRadius: 5 } }}>{dealerTag(c.store)}</Text> : null}
                </HStack>
                {c.store.address ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{c.store.address}</Text> : null}
              </VStack>
              <Spacer />
              {selected?.id === c.store.id ? <Image systemName="checkmark" foregroundStyle="accentColor" /> : null}
            </HStack>
          </Button>
          <Button action={() => setDetail(c.store.id)} buttonStyle="borderless">
            <Image systemName="info.circle" foregroundStyle="accentColor" />
          </Button>
        </HStack>) : <Text foregroundStyle="secondaryLabel">{canSearch ? "还没有门店。搜索高德，或从附近选一家。" : "还没有门店。"}</Text>}
      </Section>
      {canSearch && near ? <Section key="near" header={<HStack><Text>{"point" in near ? near.label : `${when} 停车的地方附近`}</Text><Spacer /><Text>高德</Text></HStack>}
        {...("point" in near ? { footer: <Text>从养修填写时，附近按经销商的位置找。选中的门店保存后记下经销商代码，以后从养修填写直接用它。</Text> } : {})}>
        {nearby == null ? <HStack><ProgressView /><Text foregroundStyle="secondaryLabel">{"point" in near ? "正在找经销商附近…" : "正在找那时停车的地方…"}</Text></HStack> : null}
        {nearby && !nearby.length ? <Text foregroundStyle="secondaryLabel">{"point" in near ? "经销商附近没有汽车服务。" : "没有找到那时停车的地方，或附近没有汽车服务。"}</Text> : null}
        {(nearby ?? []).map(p => <PoiRow key={p.poi_id || p.name} poi={p} mine={storeOfPoi(data.ledger.stores, p.poi_id)} detail={nearDetail(p)} onPick={() => pickPoi(p)} />)}
      </Section> : null}
    </>}
  </List>
}
