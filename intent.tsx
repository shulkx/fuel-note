// 快捷指令「截屏记加油」、分享面板入口（设计文档第 19 节）：取第一张图片，打开记加油表单并识别。
// 按 Scripting 文档（Intent 快速开始）：script.json 启用「图片」输入，快捷指令用「在 App 里运行意图」（前台，大图不会因内存不足被终止），
// 截屏放在动作的「图像」一栏，图片从 Intent.imagePathsParameter / imagesParameter 读取。
// 放在「参数」一栏时只会收到一个文件链接（shortcutParameter），油记打开时快捷指令的临时文件已被删除（用户手机上 2026-10-19）。
// 只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Intent, Script } from "scripting"
import { runApp } from "./pages/app"

function inputImage(): UIImage | null {
  const paths = Intent.imagePathsParameter || []
  if (paths.length) {
    const img = UIImage.fromFile(paths[0])
    if (img) return img
  }
  const images = Intent.imagesParameter || []
  return images.length && images[0] ? images[0] : null
}

/** 没收到图片时的说明：截屏放错在「参数」一栏时直接指出来 */
function noticeFor(): string {
  const p = Intent.shortcutParameter
  if (p) return "截屏放在了快捷指令动作的「参数」一栏。请把「截屏」放到「图像」一栏（见设置 › 截屏记加油）。"
  return "没有收到截图。请确认快捷指令里「截屏」放在「在 App 里运行意图」动作的「图像」一栏（见设置 › 截屏记加油）。"
}

const image = inputImage()
// 没读出图片也打开记加油表单（可以在表单里重新选图），并说明原因
runApp("add_fuel", image, image ? null : noticeFor()).then(() => Script.exit())
