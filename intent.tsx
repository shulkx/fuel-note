// 快捷指令「截屏记加油」、分享面板入口（设计文档第 19 节）：取第一张图片，打开记加油表单并识别。
// 用快捷指令的「在 App 里运行意图」（前台；script.json 的 runInApp），图片在 App 里解码，不会因后台内存不足被终止。
// 只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Intent, Script } from "scripting"
import { runApp } from "./pages/app"

/** 快捷指令、分享面板给图片的方式不止一种：文件路径、图片、文件、快捷指令参数里的文件链接，依次尝试 */
function inputImage(): string | UIImage | null {
  const paths = Intent.imagePathsParameter
  if (paths && paths.length) return paths[0]
  const images = Intent.imagesParameter
  if (images && images.length) return images[0]
  const files = Intent.fileURLsParameter
  if (files && files.length) return files[0]
  const p = Intent.shortcutParameter
  if (p && p.type === "fileURL") return p.value
  return null
}

/** 没收到图片时说明收到了什么，便于排查快捷指令的设置 */
function received(): string {
  const n = (a: unknown[] | undefined) => (a ? a.length : 0)
  const p = Intent.shortcutParameter
  return [
    `图片路径 ${n(Intent.imagePathsParameter)}`,
    `图片 ${n(Intent.imagesParameter)}`,
    `文件 ${n(Intent.fileURLsParameter)}`,
    `文本 ${n(Intent.textsParameter)}`,
    `链接 ${n(Intent.urlsParameter)}`,
    `快捷指令参数 ${p ? p.type : "无"}`,
  ].join("，")
}

const image = inputImage()
const notice = image ? null : `没有收到截图（${received()}）。请确认快捷指令里「截屏」的结果传给了油记。`
runApp(image ? "add_fuel" : null, image, notice).then(() => Script.exit())
