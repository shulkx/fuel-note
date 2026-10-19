// 快捷指令「截屏记加油」、分享面板入口（设计文档第 19 节）：取第一张图片，打开记加油表单并识别。
// 用快捷指令的「在 App 里运行意图」（前台；script.json 的 runInApp），图片在 App 里解码，不会因后台内存不足被终止。
// 只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Intent, Script } from "scripting"
import { runApp } from "./pages/app"

/** 文件链接（file:///…）转成路径 */
const pathOf = (s: string) => (s.startsWith("file://") ? decodeURIComponent(s.replace(/^file:\/\//, "")) : s)

/** 从文件读图：UIImage.fromFile 读不出时再按 Data 读一次；记下读的情况，读不出时告诉用户 */
function fromFile(raw: string, label: string, notes: string[]): UIImage | null {
  const path = pathOf(raw)
  const image = UIImage.fromFile(path) || (() => { const d = Data.fromFile(path); return d ? UIImage.fromData(d) : null })()
  if (!image) notes.push(`${label}：${FileManager.existsSync(path) ? "文件在，但读不出图片" : "文件不存在"}（${path.split("/").pop()}）`)
  return image
}

/** 快捷指令、分享面板给图片的方式不止一种：图片路径、图片、文件、快捷指令参数里的文件链接，依次尝试，直到读出一张 */
function inputImage(notes: string[]): UIImage | null {
  const paths = Intent.imagePathsParameter || []
  if (paths.length) { const img = fromFile(paths[0], "图片路径", notes); if (img) return img }
  const images = Intent.imagesParameter || []
  if (images.length && images[0]) return images[0]
  const files = Intent.fileURLsParameter || []
  if (files.length) { const img = fromFile(files[0], "文件", notes); if (img) return img }
  const p = Intent.shortcutParameter
  if (p && p.type === "fileURL") { const img = fromFile(p.value, "快捷指令参数", notes); if (img) return img }
  return null
}

/** 收到了什么，便于排查快捷指令的设置 */
function received(): string {
  const n = (a: unknown[] | undefined) => (a ? a.length : 0)
  const p = Intent.shortcutParameter
  return `图片路径 ${n(Intent.imagePathsParameter)}，图片 ${n(Intent.imagesParameter)}，文件 ${n(Intent.fileURLsParameter)}，文本 ${n(Intent.textsParameter)}，快捷指令参数 ${p ? p.type : "无"}`
}

const notes: string[] = []
const image = inputImage(notes)
// 没读出图片也打开记加油表单（可以在表单里重新选图），并说明原因
const notice = image ? null : [`没有读出截图。收到：${received()}。`, ...notes].join("\n")
runApp("add_fuel", image, notice).then(() => Script.exit())
