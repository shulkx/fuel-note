// 本机文字识别采样的电脑端（设计文档 16.3 节、20.10 节）。
// 把电脑上的小票图片发给手机上的「FuelNote Probe」，收回 iOS Vision 的识别结果；手机相册里选的图片也传回来保存。
// 保单 PDF 也发给手机，收回 PDFKit 逐页取出的文字（保险 1.5 的解析规则以它为准）；保单文件夹里的图片（交强险标志 JPG）和读不出文字的 PDF 收回 Vision 识别的文字块。
// 图片、PDF 和结果都只放在 XXYH_ROOT 下（git 忽略），不进本仓库；只在局域网使用。
//
//   node tools/ocr_bridge.mjs [--root E:/GitHub/xxyh] [--port 3100]
//
// 接口：
//   GET  /list                 清单 [{ id, name, size, kind, done }]：kind 为 image（小票）、pdf（保单）或 ins_image（保单文件夹里的图片）；
//                              小票的 done = 两种识别方式都已有结果，PDF 的 done = 已有文字，ins_image 的 done = 已有识别结果
//   GET  /image?id=<id>        图片内容
//   GET  /pdf?id=<id>          保单文件夹里的文件（materials/insurance/ 下的 PDF 和图片）
//   POST /pdf_result           一份 PDF 的文字 { file, pages, ms }，追加到 out/insurance/pdfkit.jsonl
//   POST /pdf_ocr              读不出文字的 PDF 截图后、保单文件夹里的图片的识别结果（文字块，page 从 0 数），追加到 out/insurance/pdf_ocr.jsonl
//   POST /pdf_image?name=<n>   那张截图（JPEG），存到 out/insurance/pdf_images/
//   POST /result               一条识别结果（JSON），追加到 out/ocr/vision.jsonl
//   POST /upload?name=<name>   手机相册里的图片，存到 materials/receipts_phone/
import { createServer } from "node:http"
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { basename, extname, join } from "node:path"
import { networkInterfaces } from "node:os"

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const ROOT = arg("root", process.env.XXYH_ROOT || "E:/GitHub/xxyh")
const PORT = Number(arg("port", "3100"))
const SOURCES = { receipts: join(ROOT, "materials/receipts"), phone: join(ROOT, "materials/receipts_phone") }
const OUT_DIR = join(ROOT, "out/ocr")
const RESULTS = join(OUT_DIR, "vision.jsonl")
const VARIANTS = ["plain", "corrected"]
const IMAGE = /\.(jpe?g|png|heic)$/i
const PDF_DIR = join(ROOT, "materials/insurance")
const PDF_OUT = join(ROOT, "out/insurance")
const PDF_RESULTS = join(PDF_OUT, "pdfkit.jsonl")
const MAX_BODY = 25 * 1024 * 1024

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(PDF_OUT, { recursive: true })
mkdirSync(SOURCES.phone, { recursive: true })

function listImages() {
  const out = []
  for (const [key, dir] of Object.entries(SOURCES)) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir).filter(n => IMAGE.test(n)).sort()) {
      out.push({ id: `${key}/${name}`, name, size: statSync(join(dir, name)).size, path: join(dir, name) })
    }
  }
  return out
}

/** materials/insurance/ 下的 PDF 和图片（含子文件夹），id 为 insurance/<相对路径>；kind 为 pdf 或 ins_image */
function listPdfs() {
  const out = []
  const walk = rel => {
    const dir = join(PDF_DIR, rel)
    for (const name of readdirSync(dir).sort()) {
      const r = rel ? `${rel}/${name}` : name
      const item = { id: `insurance/${r}`, name: r, size: statSync(join(dir, name)).size, path: join(dir, name) }
      if (statSync(join(dir, name)).isDirectory()) walk(r)
      else if (/\.pdf$/i.test(name)) out.push({ ...item, kind: "pdf" })
      else if (IMAGE.test(name)) out.push({ ...item, kind: "ins_image" })
    }
  }
  if (existsSync(PDF_DIR)) walk("")
  return out
}

/** 已有截图识别结果的文件 */
function ocrDoneIds() {
  const file = join(PDF_OUT, "pdf_ocr.jsonl")
  if (!existsSync(file)) return new Set()
  const out = new Set()
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue
    try { out.add(JSON.parse(line).file) } catch { /* 跳过坏行 */ }
  }
  return out
}

function pdfDoneIds() {
  if (!existsSync(PDF_RESULTS)) return new Set()
  const out = new Set()
  for (const line of readFileSync(PDF_RESULTS, "utf8").split("\n")) {
    if (!line.trim()) continue
    try { out.add(JSON.parse(line).file) } catch { /* 跳过坏行 */ }
  }
  return out
}

function doneIds() {
  const seen = new Map()
  if (!existsSync(RESULTS)) return new Set()
  for (const line of readFileSync(RESULTS, "utf8").split("\n")) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (!seen.has(r.file)) seen.set(r.file, new Set())
      seen.get(r.file).add(r.variant)
    } catch { /* 跳过坏行 */ }
  }
  return new Set([...seen].filter(([, v]) => VARIANTS.every(x => v.has(x))).map(([k]) => k))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on("data", c => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error("内容太大")); req.destroy() } else chunks.push(c)
    })
    req.on("end", () => resolve(Buffer.concat(chunks)))
    req.on("error", reject)
  })
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type })
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://local")
  try {
    if (req.method === "GET" && url.pathname === "/list") {
      const done = doneIds()
      const pdfDone = pdfDoneIds()
      const ocrDone = ocrDoneIds()
      // PDF 排在前面：图片大多已经识别过
      return send(res, 200, [
        ...listPdfs().map(({ id, name, size, kind }) => ({ id, name, size, kind, done: kind === "pdf" ? pdfDone.has(id) : ocrDone.has(id) })),
        ...listImages().map(({ id, name, size }) => ({ id, name, size, kind: "image", done: done.has(id) })),
      ])
    }
    if (req.method === "GET" && url.pathname === "/image") {
      // 只发清单里的文件，防止读到别的路径
      const item = listImages().find(i => i.id === url.searchParams.get("id"))
      if (!item) return send(res, 404, { error: "没有这张图片" })
      const ext = extname(item.name).toLowerCase()
      return send(res, 200, readFileSync(item.path), ext === ".png" ? "image/png" : ext === ".heic" ? "image/heic" : "image/jpeg")
    }
    if (req.method === "GET" && url.pathname === "/pdf") {
      const item = listPdfs().find(i => i.id === url.searchParams.get("id"))
      if (!item) return send(res, 404, { error: "没有这份 PDF" })
      const ext = extname(item.name).toLowerCase()
      const type = item.kind === "pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".heic" ? "image/heic" : "image/jpeg"
      return send(res, 200, readFileSync(item.path), type)
    }
    if (req.method === "POST" && url.pathname === "/pdf_result") {
      const r = JSON.parse((await readBody(req)).toString("utf8"))
      if (!r.file || !Array.isArray(r.pages)) return send(res, 400, { error: "缺少 file 或 pages" })
      appendFileSync(PDF_RESULTS, JSON.stringify({ ...r, received_at: new Date().toISOString() }) + "\n")
      console.log(`PDF ${r.file}：${r.pages.length} 页，${r.pages.reduce((n, p) => n + (p || "").length, 0)} 字，${r.ms} ms`)
      return send(res, 200, { ok: true })
    }
    // 读不出文字的 PDF：手机上 WebView 截图后的 Vision 识别结果和截图（设计文档 20.5 节）
    if (req.method === "POST" && url.pathname === "/pdf_ocr") {
      const r = JSON.parse((await readBody(req)).toString("utf8"))
      if (!r.file) return send(res, 400, { error: "缺少 file" })
      appendFileSync(join(PDF_OUT, "pdf_ocr.jsonl"), JSON.stringify({ ...r, received_at: new Date().toISOString() }) + "\n")
      console.log(`截图识别 ${r.file} 第 ${(r.page ?? 0) + 1} 页：${(r.candidates || []).length} 段文字，${r.width}×${r.height}，${r.ms} ms`)
      return send(res, 200, { ok: true })
    }
    if (req.method === "POST" && url.pathname === "/pdf_image") {
      const name = basename(String(url.searchParams.get("name") || "")).replace(/[^\w.\-一-鿿]/g, "_")
      if (!/\.jpg$/i.test(name)) return send(res, 400, { error: "文件名无效" })
      mkdirSync(join(PDF_OUT, "pdf_images"), { recursive: true })
      writeFileSync(join(PDF_OUT, "pdf_images", name), await readBody(req))
      console.log(`PDF 截图 ${name}`)
      return send(res, 200, { ok: true })
    }
    if (req.method === "POST" && url.pathname === "/result") {
      const r = JSON.parse((await readBody(req)).toString("utf8"))
      if (!r.file || !VARIANTS.includes(r.variant)) return send(res, 400, { error: "缺少 file 或 variant" })
      appendFileSync(RESULTS, JSON.stringify({ ...r, received_at: new Date().toISOString() }) + "\n")
      console.log(`结果 ${r.file} ${r.variant}：${(r.candidates || []).length} 段文字，${r.ms} ms`)
      return send(res, 200, { ok: true })
    }
    if (req.method === "POST" && url.pathname === "/upload") {
      const name = basename(String(url.searchParams.get("name") || "")).replace(/[^\w.\-\u4e00-\u9fff]/g, "_")
      if (!IMAGE.test(name)) return send(res, 400, { error: "文件名无效" })
      writeFileSync(join(SOURCES.phone, name), await readBody(req))
      console.log(`收到手机图片 ${name}`)
      return send(res, 200, { id: `phone/${name}` })
    }
    send(res, 404, { error: "未知接口" })
  } catch (e) {
    console.error(e)
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
})

server.listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address)
  console.log(`采样服务已启动：${ips.map(ip => `http://${ip}:${PORT}`).join("  ")}`)
  console.log(`图片 ${listImages().length} 张；已有结果 ${doneIds().size} 张；结果写入 ${RESULTS}`)
  console.log(`保单文件 ${listPdfs().length} 份；已有文字 ${pdfDoneIds().size} 份；结果写入 ${PDF_RESULTS}`)
})
