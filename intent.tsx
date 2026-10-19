// 快捷指令「截屏记加油」、分享面板入口（设计文档第 19 节）：取第一张图片，打开记加油表单并识别。
// 用快捷指令的「在 App 里运行意图」（前台；script.json 的 runInApp），图片在 App 里解码，不会因后台内存不足被终止。
// 只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Intent, Script } from "scripting"
import { runApp } from "./pages/app"

const image = (Intent.imagePathsParameter || [])[0] || null
runApp(image ? "add_fuel" : null, image).then(() => Script.exit())
