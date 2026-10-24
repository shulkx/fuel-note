// 保单 PDF 和图片（设计文档 20.5 节）：读文字、读不出文字的截图识别、存交强险标志。原件存在数据文件夹的 insurance/ 下
import { ocrPageText, ParsedMark, ParsedPolicy, pdfHasText, readPolicyPages } from "../common/policy_text"
import { pdfPageData, readPdfPages, singlePagePdfs, snapshotPdfPage } from "../platform/pdf"
import { savePolicyData, savePolicyFile } from "../platform/storage"
import { recognizeBlocks, recognizeImageFile } from "../platform/vision"
import { errorText } from "./errors"

/**
 * 选中的一份保单 PDF 或图片。textless：读不出文字的 PDF（扫描件、特殊字体），要截图识别，识别前 parsed、mark、error 都是 null；
 * mark：里面的交强险标志（page 为 null 时整份就是标志，否则是保单里的那一页）；image：图片，在本机识别
 */
export type PickedPolicy = {
  path: string
  name: string
  parsed: ParsedPolicy | null
  mark: { info: ParsedMark; page: number | null } | null
  error: string | null
  textless: boolean
  image: boolean
}

const IMAGE_PATH = /\.(jpe?g|png|heic|heif)$/i

/** 读选中的保单 PDF 和图片：逐个取文字，读出保单和交强险标志；都不是时 parsed、mark 为 null，打不开时写原因 */
export async function readPolicyFiles(paths: string[]): Promise<PickedPolicy[]> {
  const out: PickedPolicy[] = []
  for (const path of paths) {
    const name = path.split("/").pop() || path
    const image = IMAGE_PATH.test(path)
    const base = { path, name, image, parsed: null, mark: null, error: null, textless: false }
    try {
      const pages = image ? [ocrPageText(await recognizeImageFile(path))] : await readPdfPages(path)
      // 有的 PDF 用了读不出的字体，取出的文字是空的：不能说成「不是保单」，交给截图识别
      if (!pdfHasText(pages)) out.push({ ...base, textless: !image })
      else out.push({ ...base, ...readPolicyPages(pages) })
    } catch (e) {
      out.push({ ...base, error: errorText(e) })
    }
  }
  return out
}

/**
 * 读不出文字的保单 PDF：前几页逐页显示在 web（页面上的 WebView）里截图，本机 Vision 识别后按规则读。不联网；onPage 报告进度
 */
export async function scanPolicyFile(picked: PickedPolicy, web: WebViewController, onPage: (index: number, count: number) => void): Promise<PickedPolicy> {
  try {
    const pages = await singlePagePdfs(picked.path)
    const texts: string[] = []
    for (const [i, page] of pages.entries()) {
      onPage(i, pages.length)
      texts.push(ocrPageText(await recognizeBlocks(await snapshotPdfPage(web, page))))
    }
    // 都没认出时与有文字的 PDF 一样：parsed、mark 为 null，不算出错
    return { ...picked, ...(pdfHasText(texts) ? readPolicyPages(texts) : { parsed: null, mark: null }), error: null }
  } catch (e) {
    return { ...picked, parsed: null, error: `截图识别失败：${errorText(e)}` }
  }
}

/** 存交强险标志：整份是标志时复制原件，保单里的一页时拆出来单独存一份 PDF；返回相对路径 */
export async function savePolicyMark(yearId: string, src: { path: string; page: number | null; name: string }): Promise<string> {
  return src.page == null ? savePolicyFile(yearId, src.path, src.name) : savePolicyData(yearId, await pdfPageData(src.path, src.page), "交强险标志.pdf")
}
