// 从行程选择：最近 7 天的停车，加油停车在前
import { Button, ContentUnavailableView, HStack, List, Navigation, NavigationStack, ProgressView, Section, Spacer, Text, VStack, useEffect, useState } from "scripting"
import { AppData, distanceText, durationText, fmtShort, recentStops, Stop, Vehicle } from "../common/model"
import { km } from "./components"

function StopRow({ stop }: { stop: Stop }) {
  const where = stop.candidate ? stop.candidate.station.name : stop.place ? stop.place.address || stop.place.district : "没有位置"
  return <HStack>
    <VStack alignment="leading" spacing={3}>
      <HStack spacing={6}>
        <Text font="body">{fmtShort(stop.end_ts)}</Text>
        {stop.refuel ? <Text font="caption2" foregroundStyle="systemGreen">加油停车</Text> : null}
        {stop.recorded ? <Text font="caption2" foregroundStyle="secondaryLabel">已记录</Text> : null}
      </HStack>
      <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={1}>
        {[where, stop.candidate?.kind === "new" ? "新油站" : "", stop.candidate?.dist != null ? distanceText(stop.candidate.dist) : ""].filter(Boolean).join(" · ")}
      </Text>
      <Text font="caption2" foregroundStyle="tertiaryLabel">{stop.stay_min != null ? `停留 ${durationText(stop.stay_min * 60e3)}` : "之后还没有行程"}</Text>
    </VStack>
    <Spacer />
    <Text font="callout" monospacedDigit>{km(Math.floor(stop.odometer_km))}</Text>
  </HStack>
}

export function StopPicker({ data, vehicle }: { data: AppData; vehicle: Vehicle }) {
  const dismiss = Navigation.useDismiss()
  const [stops, setStops] = useState<Stop[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    recentStops(data, vehicle).then(setStops, e => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const refuel = (stops || []).filter(s => s.refuel)
  const other = (stops || []).filter(s => !s.refuel)

  return <NavigationStack>
    <List
      navigationTitle="从行程选择"
      navigationBarTitleDisplayMode="inline"
      toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss(null)} /> }}
    >
      {error ? <ContentUnavailableView title="读取行程失败" systemImage="exclamationmark.triangle" description={error} /> : null}
      {!error && !stops ? <HStack><Spacer /><ProgressView /><Spacer /></HStack> : null}
      {stops && !stops.length ? <ContentUnavailableView title="最近 7 天没有行程" systemImage="car.side" /> : null}
      {refuel.length ? <Section title="加油停车">
        {refuel.map(s => <Button key={s.trip.id} action={() => dismiss(s)}><StopRow stop={s} /></Button>)}
      </Section> : null}
      {other.length ? <Section header={<Text>其他停车</Text>} footer={<Text>选中后填入熄火时的里程和时间；有油站时一并填入。</Text>}>
        {other.map(s => <Button key={s.trip.id} action={() => dismiss(s)}><StopRow stop={s} /></Button>)}
      </Section> : null}
    </List>
  </NavigationStack>
}
