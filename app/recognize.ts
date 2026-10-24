// 识别（设计文档 16.3 节）：加油截图只用「设置 › 识别方式」选的那一种（本机、Azure OpenAI、Scripting 助手），不换别的再试；
// 权益（权益设计 5.2 节）只能用大模型。三种方式都保留（用户 2026-10-24）
import { fmtDate } from "../common/time"
import { redactText } from "../common/redact"
import { ReceiptResult, receiptScore, receiptUsable } from "../common/receipt"
import { localUsable } from "../common/receipt_rules"
import { AssistantModel, OcrEngine, Settings } from "../common/types"
import { AzureConfig, azureReady, azureStructured, pingAzure, recognizeAzure } from "../readers/azure"
import { parsePerkScan, PERK_ASSISTANT_SCHEMA, PERK_AZURE_SCHEMA, perkPrompt, PerkScan } from "../readers/perk_llm"
import { assistantAvailable, assistantStructured, pingAssistant, recognizeAssistant } from "../platform/assistant"
import { scriptingHttp } from "../platform/scripting_http"
import { getJsonSecret, removeSecret, SECRET_AZURE, setJsonSecret } from "../platform/secrets"
import { jpegForUpload, recognizeLocal } from "../platform/vision"
import { errorText } from "./errors"

export function azureConfig(): AzureConfig | null {
  const v = getJsonSecret(SECRET_AZURE)
  return v ? { endpoint: v.endpoint || "", deployment: v.deployment || "", key: v.key || "", apiVersion: v.apiVersion || undefined } : null
}

export function setAzureConfig(c: AzureConfig | null): void {
  if (!c || !(c.endpoint.trim() || c.deployment.trim() || c.key.trim())) return removeSecret(SECRET_AZURE)
  setJsonSecret(SECRET_AZURE, { endpoint: c.endpoint.trim(), deployment: c.deployment.trim(), key: c.key.trim(), ...(c.apiVersion ? { apiVersion: c.apiVersion } : {}) })
}

export const azureConfigured = () => azureReady(azureConfig())

export async function testAzure(c: AzureConfig): Promise<string> {
  const r = await pingAzure(scriptingHttp, c)
  return `${r.model || "已连接"}，${r.seconds.toFixed(1)} 秒`
}

export async function testAssistant(m: AssistantModel | null): Promise<string> {
  const seconds = await pingAssistant(m)
  return `${m ? m.modelId : "默认模型"}，${seconds.toFixed(1)} 秒`
}

export const OCR_ENGINE_TITLES: Record<OcrEngine, string> = { local: "本机", azure: "大模型（Azure OpenAI）", assistant: "大模型（Scripting 助手）" }

export type RecognizeOutcome = {
  result: ReceiptResult | null
  /** 「本机 0.3 秒」「Azure 4.9 秒」 */
  summary: string
  error: string | null
  /** 读到的数字能不能互相核对上（本机：localUsable；大模型：receiptUsable）。不能时请用户对照图片 */
  checked: boolean
}

/** 大模型（Azure、Scripting 助手）的结果：非加油单据报错；核对用 receiptUsable */
async function recognizeLlm(run: () => Promise<ReceiptResult>, label: (r: ReceiptResult) => string): Promise<RecognizeOutcome> {
  try {
    const r = await run()
    const summary = `${label(r)} ${r.seconds.toFixed(1)} 秒`
    if (r.doc_type === "other") return { result: null, summary, checked: false, error: r.note || "图片里没有加油信息" }
    return { result: r, summary, checked: receiptUsable(r), error: null }
  } catch (e) {
    return { result: null, summary: "", checked: false, error: `大模型识别失败：${errorText(e)}` }
  }
}

/** 只用设置里选的那一种来源识别 */
export async function recognizeImage(image: UIImage, settings: Pick<Settings, "ocr_engine" | "ocr_assistant">): Promise<RecognizeOutcome> {
  if (settings.ocr_engine === "azure") {
    const cfg = azureConfig()
    if (!azureReady(cfg)) return { result: null, summary: "", checked: false, error: "还没有设置 Azure OpenAI。请在「设置 › 识别方式」填写，或改用其他识别方式。" }
    return recognizeLlm(async () => {
      const jpeg = jpegForUpload(image)
      if (!jpeg) throw new Error("图片无法转换")
      return recognizeAzure(scriptingHttp, cfg, jpeg)
    }, () => "Azure")
  }
  if (settings.ocr_engine === "assistant") {
    if (!assistantAvailable()) return { result: null, summary: "", checked: false, error: "Scripting 助手不可用。请先在 Scripting 中添加模型账号，或改用其他识别方式。" }
    return recognizeLlm(() => recognizeAssistant(image, settings.ocr_assistant), r => r.model || "Scripting 助手")
  }
  try {
    const local = await recognizeLocal(image)
    const summary = `本机 ${local.seconds.toFixed(1)} 秒`
    if (localUsable(local)) return { result: local, summary, checked: true, error: null }
    if (receiptScore(local)) return { result: local, summary, checked: false, error: null }
    return { result: null, summary, checked: false, error: "本机没有读到加油信息，请手动填写。" }
  } catch (e) {
    return { result: null, summary: "", checked: false, error: `本机识别失败：${errorText(e)}` }
  }
}

/**
 * 识别权益：文字（发出前去掉个人信息）或截图，用设置里选的大模型整理成几项。
 * 本机识别整理不了这种内容；没有配置大模型、识别失败、一项都没认出时返回 error，表单照常手动添加
 */
export async function recognizePerks(
  input: { text: string | null; images: UIImage[] }, origin: "insurance" | "package" | "other", settings: Pick<Settings, "ocr_engine" | "ocr_assistant">,
): Promise<{ scan: PerkScan | null; summary: string; error: string | null }> {
  if (settings.ocr_engine === "local") return { scan: null, summary: "", error: "本机识别整理不了权益。请在「设置 › 识别方式」改用大模型（Scripting 助手或 Azure OpenAI），或手动添加。" }
  const text = input.text?.trim() ? redactText(input.text.trim()) : null
  const jpegs = input.images.map(i => jpegForUpload(i)).filter((j): j is string => !!j)
  if (!text && !jpegs.length) return { scan: null, summary: "", error: "请先粘贴文字或选择截图。" }
  const today = fmtDate(Date.now())
  try {
    let raw: unknown
    let label: string
    if (settings.ocr_engine === "azure") {
      const cfg = azureConfig()
      if (!azureReady(cfg)) return { scan: null, summary: "", error: "还没有设置 Azure OpenAI。请在「设置 › 识别方式」填写，或改用其他识别方式。" }
      const r = await azureStructured(scriptingHttp, cfg, perkPrompt(origin, today, true), text, jpegs, PERK_AZURE_SCHEMA)
      raw = r.raw
      label = `Azure ${r.seconds.toFixed(1)} 秒`
    } else {
      if (!assistantAvailable()) return { scan: null, summary: "", error: "Scripting 助手不可用。请先在 Scripting 中添加模型账号，或改用其他识别方式。" }
      const prompt = perkPrompt(origin, today, false) + (text ? `\n\n原文：\n${text}` : "")
      const r = await assistantStructured(prompt, jpegs, PERK_ASSISTANT_SCHEMA, settings.ocr_assistant)
      raw = r.raw
      label = `Scripting 助手 ${r.seconds.toFixed(1)} 秒`
    }
    const scan = parsePerkScan(raw)
    if (!scan.items.length) return { scan: null, summary: label, error: "没有认出权益。请检查文字或截图，或手动添加。" }
    return { scan, summary: `识别出 ${scan.items.length} 项 · ${label}`, error: null }
  } catch (e) {
    return { scan: null, summary: "", error: `大模型识别失败：${errorText(e)}` }
  }
}
