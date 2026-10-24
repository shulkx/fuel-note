// 小组件的摘要（widget.json）：App 每次改动、读到车况后重写，小组件只读这个小文件（设计文档 18.2 节）
import { consumptionById } from "../common/fuel"
import { monthFuelCost, summarize, yearSummaries } from "../common/fuel_stats"
import { AppData, currentVehicle, fuelRecords, stationsFor } from "../common/ledger"
import { monthKey } from "../common/time"
import { WidgetSnapshot } from "../common/widget_data"
import { saveWidgetFile } from "../platform/storage"
import { hasStatusSource, statusSource, stopsKey, vehicleTank } from "./vehicle_data"

export function saveWidgetSnapshot(data: AppData, now = Date.now()): void {
  const v = currentVehicle(data)
  // 小组件属于油耗（设计文档 21.3 节）：只读加油记录，花费只算加油
  const fills = v ? fuelRecords(data, v) : []
  const sum = v ? summarize(fills, "all", now) : null
  const d = new Date(now)
  // 小组件可能刚写进更新的车况，以文件为准
  const st = v && hasStatusSource(v) ? statusSource.latest(stopsKey(v)) : null
  // 大号「最近加油」：最近 3 次加油的油站名和油耗（设计文档 18.2 节，1.4 起）
  const consumption = consumptionById(fills)
  const stationNames = new Map((v ? stationsFor(data, v) : []).map(s => [s.id, s.name]))
  const year = yearSummaries(fills).find(y => y.year === d.getFullYear())
  const snap: WidgetSnapshot = {
    schema_version: 1,
    updated_at: now,
    vehicle: v ? v.name : null,
    status_source: hasStatusSource(v),
    status: v && st
      ? { ts: st.status.ts, fuel_l: st.status.fuel_l, range_km: st.status.range_km, tank_l: vehicleTank(data, v), odometer_km: st.status.odometer_km, read_at: st.read_at }
      : null,
    // 小组件自己读车况用（设计文档 18.3 节第 2 步）；凭据在钥匙串，不写进文件
    status_link: v && v.provider && hasStatusSource(v)
      ? { key: stopsKey(v), provider: v.provider.id, vehicle_id: v.provider.vehicle_id, tank_l: vehicleTank(data, v) }
      : null,
    latest_consumption: sum ? sum.latest_consumption : null,
    avg_consumption: sum ? sum.avg_consumption : null,
    last_fuel_ts: sum ? sum.last_fuel_ts : null,
    last_odometer: sum ? sum.last_odometer : null,
    last_fuel_odometer: fills.length ? fills[0].odometer : null,
    last_fuel_full: fills.length ? fills[0].full : false,
    month: monthKey(now),
    month_cost: monthFuelCost(fills, now),
    year: String(d.getFullYear()),
    year_cost: year ? year.cost : 0,
    recent: fills.slice(0, 3).map(r => ({
      ts: r.ts, liters: r.liters, grade: r.grade, station: (r.station_id && stationNames.get(r.station_id)) || null, paid: r.paid,
      consumption: consumption.get(r.id) ?? null,
    })),
  }
  try { saveWidgetFile(JSON.stringify(snap)) } catch { /* 小组件下次再更新 */ }
}
