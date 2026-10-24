// 小组件的入口模块：widget.tsx 只从这里导入（打包器的限制，设计文档 9.4 节）。
// 只加载小组件用到的部分（widget.json、车况缓存、车辆数据提供方），不加载账本和小熊的代码：小组件内存约 30MB（Scripting 文档）。
import { ProviderId } from "./types"
import { providerById } from "../providers/registry"
import { providerCredential, providerCtx } from "../platform/provider_ctx"
import { readCache, readStatusCache, saveStatusSnapshot, saveWidgetFile, writeCache } from "../platform/storage"
import { readWidgetSnapshot, WidgetSnapshot } from "./widget_data"
import { refreshWidgetStatus as refresh } from "./widget_refresh"

export {
  consumptionLevel, consumptionTrend, daysAgoText, drivenSinceFill, fillDay, fuelRatio, fuelTone, moneyText, monthCostNow, readWidgetSnapshot,
  WIDGET_STATUS_MAX_AGE_MS, widgetRefreshDate, yearCostNow,
} from "./widget_data"
export type { ConsumptionLevel, FuelTone, Trend, WidgetFill, WidgetSnapshot, WidgetStatus } from "./widget_data"

const LOCK_FILE = "widget_status_lock.json"
/** 小组件里每个请求最多等 10 秒，读不到就显示上次的车况 */
const WIDGET_HTTP_TIMEOUT = 10

/** 车况超过 1 小时时自己读一次（设计文档 18.3 节第 2 步），返回要显示的摘要；不会抛错 */
export function refreshWidgetStatus(s: WidgetSnapshot, family: string): Promise<WidgetSnapshot> {
  return refresh(s, family, {
    now: () => Date.now(),
    reader: link => {
      const id = link.provider as ProviderId
      const p = providerById(id)
      const cred = p ? providerCredential(id) : null
      if (!p || !p.vehicleStatus || !cred) return null
      const ctx = providerCtx(id, WIDGET_HTTP_TIMEOUT)
      return () => p.vehicleStatus!(ctx, cred, link.vehicle_id)
    },
    loadStatus: key => readStatusCache()[key] || null,
    saveStatus: saveStatusSnapshot,
    readLock: () => readCache<{ at: number }>(LOCK_FILE)?.at || 0,
    writeLock: at => writeCache(LOCK_FILE, { at }),
    latest: readWidgetSnapshot,
    save: next => saveWidgetFile(JSON.stringify(next)),
  })
}
