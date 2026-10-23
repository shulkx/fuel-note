// Scripting 助手：用用户在 Scripting 里配置的模型账号识别图片。只有这里使用 Assistant 全局对象。
import { ReceiptResult } from "../common/receipt"
import { AssistantModel } from "../common/types"
import { ASSISTANT_PROMPT, ASSISTANT_SCHEMA, fromAssistant, PING_SCHEMA } from "../readers/assistant"
import { jpegForUpload } from "./vision"

/** 没有选模型时用 Scripting 的默认账号和模型 */
const options = (m: AssistantModel | null) => (m ? { providerID: m.providerID, modelId: m.modelId } : {})

/** Scripting 里有可用的模型账号（也需要 Scripting PRO） */
export const assistantAvailable = (): boolean => Assistant.isAvailable

/** 选中的模型的账号名、能不能看图；账号已删除时返回 null */
export async function assistantModelInfo(m: AssistantModel): Promise<{ name: string; supportsImages: boolean | null } | null> {
  const account = (await Assistant.getProviders()).find(p => p.providerID === m.providerID)
  if (!account) return null
  const model = account.models[m.modelId]
  return { name: account.name, supportsImages: model && model.supportsImages != null ? model.supportsImages : null }
}

/** 弹出 Scripting 的模型选择；取消时返回 null */
export async function pickAssistantModel(current: AssistantModel | null): Promise<AssistantModel | null> {
  const sel = await Assistant.presentModelPicker(current ? { providerID: current.providerID, modelId: current.modelId } : {})
  if (!sel) return null
  const account = (await Assistant.getProviders()).find(p => p.providerID === sel.providerID)
  return { providerID: sel.providerID, modelId: sel.modelId, name: account ? account.name : sel.modelId }
}

export async function recognizeAssistant(image: UIImage, m: AssistantModel | null): Promise<ReceiptResult> {
  const jpeg = jpegForUpload(image)
  if (!jpeg) throw new Error("图片无法转换")
  const t0 = Date.now()
  const raw: unknown = await Assistant.requestStructuredData(ASSISTANT_PROMPT, [`data:image/jpeg;base64,${jpeg}`], ASSISTANT_SCHEMA, options(m))
  return fromAssistant(raw, (Date.now() - t0) / 1000, m ? m.modelId : "")
}

/** 结构化请求（识别权益）：images 是 JPEG 的 base64，没有图时只发文字 */
export async function assistantStructured(prompt: string, jpegs: string[], schema: unknown, m: AssistantModel | null): Promise<{ raw: unknown; seconds: number }> {
  const t0 = Date.now()
  const raw: unknown = jpegs.length
    ? await Assistant.requestStructuredData(prompt, jpegs.map(j => `data:image/jpeg;base64,${j}`), schema as any, options(m))
    : await Assistant.requestStructuredData(prompt, schema as any, options(m))
  return { raw, seconds: (Date.now() - t0) / 1000 }
}

/** 设置页的「测试」：发一个很短的请求 */
export async function pingAssistant(m: AssistantModel | null): Promise<number> {
  const t0 = Date.now()
  await Assistant.requestStructuredData("这是连接测试，返回 ok 为 true。", PING_SCHEMA, options(m))
  return (Date.now() - t0) / 1000
}
