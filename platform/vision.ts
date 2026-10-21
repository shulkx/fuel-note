// 本机文字识别（iOS Vision）。参数与采样脚本 tools/probe 相同；默认的最小文字高度会丢掉长截图里的小字，所以调小。
import { OcrBlock, parseOcr } from "../common/receipt_rules"
import { ReceiptResult } from "../common/receipt"

export const VISION_OPTIONS: RecognizeTextOptions = {
  recognitionLevel: "accurate",
  recognitionLanguages: ["zh-Hans", "en-US"],
  usesLanguageCorrection: false,
  minimumTextHeight: 0.006,
}

/** 图片里的文字块（归一化坐标，原点在左下角）：小票和扫描件保单共用 */
export async function recognizeBlocks(image: UIImage): Promise<OcrBlock[]> {
  const r = await Vision.recognizeText(image, VISION_OPTIONS)
  return r.candidates.map(c => ({ t: c.content, c: c.confidence, b: [c.boundingBox.x, c.boundingBox.y, c.boundingBox.width, c.boundingBox.height] }))
}

export async function recognizeLocal(image: UIImage): Promise<ReceiptResult> {
  const t0 = Date.now()
  const candidates = await recognizeBlocks(image)
  return parseOcr({ width: image.width, height: image.height, candidates }, (Date.now() - t0) / 1000)
}

/** 发给 Azure 的图片：长边不超过 2048 像素的 JPEG（质量 0.8） */
export function jpegForUpload(image: UIImage, longSide = 2048): string | null {
  const scale = Math.min(1, longSide / Math.max(image.width, image.height))
  const sized = scale < 1 ? image.renderedIn({ width: Math.round(image.width * scale), height: Math.round(image.height * scale) }) : image
  return (sized || image).toJPEGBase64String(0.8)
}
