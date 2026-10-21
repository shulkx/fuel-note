// 读保单 PDF 的文字（设计文档 20.5 节）：PDFKit 逐页取 string。只有这里使用 PDFDocument。
// PDFPage 只给整页文字、不给坐标；怎么从文字里读出保单内容见 common/policy_text.ts。
// 读不出文字的 PDF（扫描件、特殊字体）：一页一页显示在页面上的 WebView 里截图，交给 Vision 识别。

export async function readPdfPages(path: string): Promise<string[]> {
  const doc = PDFDocument.fromFilePath(path)
  if (!doc) throw new Error("PDF 无法打开")
  if (doc.isLocked) throw new Error("PDF 有密码，无法读取")
  const pages: string[] = []
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAt(i)
    pages.push(page ? (await page.string) ?? "" : "")
  }
  return pages
}

/** 截图识别最多看前几页：保单内容在前面，后面是标志和条款 */
const SCAN_PAGES = 3

/** 读不出文字的 PDF 拆成单页的 PDF（WebView 一次只显示一页，截图才是完整的一页） */
export async function singlePagePdfs(path: string): Promise<Data[]> {
  const doc = PDFDocument.fromFilePath(path)
  if (!doc) throw new Error("PDF 无法打开")
  if (doc.isLocked) throw new Error("PDF 有密码，无法读取")
  const count = Math.min(doc.pageCount, SCAN_PAGES)
  const out: Data[] = []
  for (let i = 0; i < count; i++) {
    const one = PDFDocument.fromFilePath(path)
    if (!one) throw new Error("PDF 无法打开")
    for (let j = one.pageCount - 1; j >= 0; j--) if (j !== i) one.removePageAt(j)
    const data = await one.data
    if (!data) throw new Error(`第 ${i + 1} 页无法取出`)
    out.push(data)
  }
  return out
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))

/**
 * 在页面上的 WebView 里显示一页 PDF 并截图。WebView 要在屏幕上，尺寸为 A4 比例（320×453，与采样脚本相同），整页正好显示完。
 * 截图宽 1240 点（按屏幕倍数约 3700 像素），小字也能识别
 */
export async function snapshotPdfPage(web: WebViewController, page: Data): Promise<UIImage> {
  await web.loadData(page, "application/pdf", "utf-8", "about:blank")
  for (let i = 0; i < 4; i++) {
    await wait(i ? 500 : 1500)
    const image = await web.takeSnapshot({ snapshotWidth: 1240 })
    if (image) return image
  }
  throw new Error("截图失败")
}
