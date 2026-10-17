// 选择油站：附近（以选中的停车点为中心）、我的油站、关键字搜索
import { Button, HStack, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, VStack, useEffect, useState } from "scripting"
import { AppData, distanceText, Station, StationCandidate, stationCandidates, Vehicle } from "../common/model"

function CandidateRow({ c }: { c: StationCandidate }) {
  return <HStack>
    <VStack alignment="leading" spacing={3}>
      <Text font="body" foregroundStyle="label">{c.station.name}</Text>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>{c.station.address || c.station.district || c.station.city}</Text>
    </VStack>
    <Spacer />
    <VStack alignment="trailing" spacing={3}>
      {c.dist != null ? <Text font="caption" foregroundStyle="secondaryLabel">{distanceText(c.dist)}</Text> : null}
      {c.kind === "new" ? <Text font="caption2" foregroundStyle="systemGreen">新油站</Text> : null}
    </VStack>
  </HStack>
}

export function StationPicker({ data, vehicle, center }: { data: AppData; vehicle: Vehicle; center: [number, number] | null }) {
  const dismiss = Navigation.useDismiss()
  const [keyword, setKeyword] = useState("")
  const [list, setList] = useState<StationCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setList(null)
    const timer = setTimeout(() => {
      stationCandidates(data, vehicle, center, keyword).then(r => {
        if (!alive) return
        setList(r.list)
        setError(r.error)
      })
    }, keyword ? 400 : 0)
    return () => { alive = false; clearTimeout(timer) }
  }, [keyword])

  const pick = (c: StationCandidate) => dismiss({ station: c.station as Station, isNew: c.kind === "new" })
  const title = keyword ? "搜索结果" : center ? "附近" : "最近使用"

  return <NavigationStack>
    <List
      navigationTitle="选择油站"
      navigationBarTitleDisplayMode="inline"
      searchable={{ value: keyword, onChanged: setKeyword, prompt: "油站名称" }}
      toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss(null)} /> }}
    >
      {!list ? <HStack><Spacer /><ProgressView /><Spacer /></HStack> : null}
      {list ? <Section header={<Text>{title}</Text>} footer={error ? <Text foregroundStyle="systemOrange">{error}</Text> : undefined}>
        {list.length ? list.map(c => <Button key={c.station.id} action={() => pick(c)}><CandidateRow c={c} /></Button>) : <Text foregroundStyle="secondaryLabel">没有找到油站</Text>}
      </Section> : null}
    </List>
  </NavigationStack>
}
