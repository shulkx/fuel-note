// 车账本主界面入口。只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Navigation, Script } from "scripting"
import { App } from "./pages/app"

async function run() {
  const params = (Script.queryParameters || {}) as Record<string, string>
  await Navigation.present({ element: <App action={params.action || null} /> })
  Script.exit()
}

run()
