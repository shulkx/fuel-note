// 快捷指令「截屏记加油」、分享面板入口（设计文档第 19 节）：取第一张图片，打开记加油表单并识别。
// 用快捷指令的「在 App 里运行意图」（前台；script.json 的 runInApp），图片在 App 里解码，不会因后台内存不足被终止。
// 快捷指令直接传截屏时，图片作为文件链接传进来，油记打开时临时文件往往已被删除（用户手机上 2026-10-19），
// 所以快捷指令里先「Base64 编码」，把图片当文本传进来最可靠；分享面板给的是文件路径，照常读取。
// 只导入 pages/app（打包器限制见设计文档 9.4 节）
import { Intent, Script } from "scripting"
import { runApp } from "./pages/app"

/** 文件链接（file:///…）转成路径 */
const pathOf = (s: string) => (s.startsWith("file://") ? decodeURIComponent(s.replace(/^file:\/\//, "")) : s)

/** 从文件读图：UIImage.fromFile 读不出时再按 Data 读一次；读不出时记下完整路径，告诉用户 */
function fromFile(raw: string, label: string, notes: string[]): UIImage | null {
  const path = pathOf(raw)
  const image = UIImage.fromFile(path) || (() => { const d = Data.fromFile(path); return d ? UIImage.fromData(d) : null })()
  if (!image) notes.push(`${label}：${FileManager.existsSync(path) ? "文件在，但读不出图片" : "文件已不存在"}（${raw}）`)
  return image
}

/** Base64 文本（可带 data:image/…;base64, 前缀）→ 图片；不像 Base64 时为 null */
function fromBase64(text: string): UIImage | null {
  const s = text.trim().replace(/^data:image\/[a-z+]+;base64,/i, "").replace(/\s+/g, "")
  if (s.length < 100 || !/^[A-Za-z0-9+/]+=*$/.test(s)) return null
  return UIImage.fromBase64String(s)
}

/** 依次尝试：Base64 文本、图片路径、图片、文件、快捷指令参数里的文件链接，直到读出一张 */
function inputImage(notes: string[]): UIImage | null {
  const p = Intent.shortcutParameter
  const texts = [...(p && p.type === "text" ? [String(p.value)] : []), ...(Intent.textsParameter || [])]
  for (const t of texts) { const img = fromBase64(t); if (img) return img }
  const paths = Intent.imagePathsParameter || []
  if (paths.length) { const img = fromFile(paths[0], "图片路径", notes); if (img) return img }
  const images = Intent.imagesParameter || []
  if (images.length && images[0]) return images[0]
  const files = Intent.fileURLsParameter || []
  if (files.length) { const img = fromFile(files[0], "文件", notes); if (img) return img }
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
const notice = image ? null : [
  `没有读出截图。收到：${received()}。`,
  ...notes,
  "请在快捷指令里「截屏」之后加一步「Base64 编码」，把它的结果交给油记（见设置 › 截屏记加油）。",
].join("\n")
runApp("add_fuel", image, notice).then(() => Script.exit())
