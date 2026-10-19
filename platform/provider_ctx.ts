// 车辆数据提供方的运行环境：凭据和会话缓存存钥匙串，油记和小组件共用。
// 钥匙串默认 first_unlock_this_device（Scripting 的类型声明）：开机后解锁过一次就能读，锁屏时小组件也能读到。
import { ProviderId } from "../common/types"
import { Credential, ProviderContext } from "../providers/types"
import { scriptingHttp } from "./scripting_http"
import { getJsonSecret, getSecret, providerSecretKey, providerSessionKey, removeSecret, setSecret } from "./secrets"

export const providerCredential = (id: ProviderId): Credential | null => getJsonSecret(providerSecretKey(id))

/**
 * 会话缓存存钥匙串，冷启动时少换一次会话。
 * maxTimeout：每个请求最多等多少秒（小组件用：系统给小组件的时间有限）
 */
export function providerCtx(id: ProviderId, maxTimeout?: number): ProviderContext {
  const key = providerSessionKey(id)
  return {
    http: maxTimeout ? req => scriptingHttp({ ...req, timeout: Math.min(req.timeout ?? maxTimeout, maxTimeout) }) : scriptingHttp,
    now: () => Date.now(),
    sessionStore: {
      get: () => getSecret(key),
      set: value => { try { if (value) setSecret(key, value); else removeSecret(key) } catch { /* 下次重新换会话 */ } },
    },
  }
}
