// 读保单 PDF 的文字（设计文档 20.5 节）：PDFKit 逐页取 string。只有这里使用 PDFDocument。
// PDFPage 只给整页文字、不给坐标；怎么从文字里读出保单内容见 common/policy_text.ts。

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
