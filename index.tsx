// 油记主界面入口。只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Script } from "scripting"
import { runApp } from "./pages/app"

const params = (Script.queryParameters || {}) as Record<string, string>
runApp(params.action || null).then(() => Script.exit())
