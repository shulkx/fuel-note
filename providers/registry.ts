// 所有车辆数据提供方。接入新品牌：实现 VehicleDataProvider 并加到这里。
import { ProviderId } from "../common/types"
import { VehicleDataProvider } from "./types"
import { volvoCn } from "./volvo_cn"

export const PROVIDERS: VehicleDataProvider[] = [volvoCn]

export function providerById(id: ProviderId): VehicleDataProvider | null {
  return PROVIDERS.find(p => p.id === id) || null
}
