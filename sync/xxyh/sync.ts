// 小熊云备份的下载（2.0 起只在导入、导出时用；上传在导出里，2.0.0-beta.4）。保存文件由调用方负责。
import { Http } from "../../platform/http"
import { accountInfo, downloadBackup, XxyhAccount, XxyhError } from "./api"
import { XxyhBackup } from "./types"

/** 下载云端最新版本：账号信息和整份备份；账号下还没有云备份时报错 */
export async function downloadLatest(http: Http, token: string): Promise<{ account: XxyhAccount; version: number; doc: XxyhBackup }> {
  const account = await accountInfo(http, token)
  if (account.version == null) throw new XxyhError("server", "小熊账号下还没有云备份，请先在小熊油耗 App 里备份一次")
  const doc = await downloadBackup(http, token, account.version)
  return { account, version: account.version, doc }
}
