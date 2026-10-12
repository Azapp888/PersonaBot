import type { ChatMessage, ModelProvider, ModelRecord } from "../types";
import { LLMError } from "./provider";
import type { LLMProvider } from "./provider";

/**
 * 各提供商的「读图（多模态）」接口知识库。
 *
 * 这里记录的是"如何把图片送给该提供商"这一事实，来自各家官方文档，
 * 用于在检测/排错时给出准确说明，而不是靠记忆猜测。
 */
export interface ProviderVisionSpec {
  /** 该提供商是否具备视觉能力（支持发送图片输入）。 */
  supportsVision: boolean;
  /** 图片在请求体中的承载方式。 */
  imageTransport: "content-parts-image-url" | "content-parts-base64" | "unsupported";
  /** 已知支持读图的模型 id 匹配规则（不区分大小写，子串匹配）。 */
  knownVisionModels: RegExp[];
  /** 已知明确不支持读图的模型 id 匹配规则。 */
  knownTextOnlyModels: RegExp[];
  /** 面向人的一句话说明。 */
  note: string;
}

const OPENAI_STYLE: Pick<ProviderVisionSpec, "imageTransport" | "note"> = {
  imageTransport: "content-parts-image-url",
  note: "OpenAI 兼容 Chat Completions：content 传数组，元素 {type:'image_url',image_url:{url}}，url 可为 https 或 data:URL(base64)。",
};

export const PROVIDER_VISION: Record<string, ProviderVisionSpec> = {
  openai: {
    supportsVision: true,
    ...OPENAI_STYLE,
    knownVisionModels: [/^gpt-4o/, /^gpt-4\.1/, /^gpt-4-turbo/, /^gpt-4-vision/, /^o[134]/, /^chatgpt-4o/],
    knownTextOnlyModels: [/^gpt-3\.5/, /^text-/, /^davinci/, /^gpt-4-\d/],
    note: "OpenAI：/v1/chat/completions，content 数组 + image_url（https 或 data:URL）。",
  },
  deepseek: {
    supportsVision: false,
    imageTransport: "unsupported",
    knownVisionModels: [/deepseek-vl/, /deepseek.*vision/, /-vl\b/],
    knownTextOnlyModels: [/^deepseek-(chat|reasoner|coder)/],
    note: "DeepSeek 主站文本模型（deepseek-chat/reasoner/coder）暂不支持图片输入；如有 VL 系列方可读图。",
  },
  anthropic: {
    supportsVision: true,
    imageTransport: "content-parts-base64",
    knownVisionModels: [/^claude-3/, /^claude-4/, /^claude-.*-sonnet/, /^claude-.*-opus/, /^claude-.*-haiku/],
    knownTextOnlyModels: [],
    note: "Anthropic Messages API：content 数组元素 {type:'image',source:{type:'base64',media_type,data}} 或 {type:'url',url}。",
  },
  custom: {
    supportsVision: true,
    ...OPENAI_STYLE,
    knownVisionModels: [/vl/, /vision/, /gpt-4o/, /gpt-4\.1/, /o[134]/, /gemini/, /qwen.*vl/, /glm-4v/, /yi-vision/, /minicpm-.*v/],
    knownTextOnlyModels: [],
    note: "自定义 OpenAI 兼容网关：按 OpenAI content 数组 + image_url 传图，实际支持与否取决于上游模型。",
  },
  mock: {
    supportsVision: false,
    imageTransport: "unsupported",
    knownVisionModels: [],
    knownTextOnlyModels: [/.*/],
    note: "内置 Mock Provider 不接受图片输入。",
  },
};

export function visionSpecFor(provider: string): ProviderVisionSpec {
  return PROVIDER_VISION[provider] ?? PROVIDER_VISION.custom;
}

/**
 * 依据模型 id 与提供商知识库，猜测模型是否支持读图。
 * 返回 null 表示无法从命名判断（需要实测）。
 */
export function inferVisionFromName(provider: string, modelId: string): boolean | null {
  const spec = visionSpecFor(provider);
  const id = (modelId || "").toLowerCase();
  if (!id) return null;
  for (const re of spec.knownVisionModels) if (re.test(id)) return true;
  for (const re of spec.knownTextOnlyModels) if (re.test(id)) return false;
  return null;
}

/** 1x1 透明 PNG（base64），用于视觉能力探测，体积最小。 */
export const PROBE_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

export interface VisionProbeResult {
  supported: boolean;
  /** 'probe' = 实测得出；'heuristic' = 依据模型命名推断。 */
  source: "probe" | "heuristic";
  reason?: string;
}

/**
 * 实测一个模型是否支持图片输入：发送一张 1x1 图片并要求极短回复。
 * - 成功 -> 支持；
 * - 上游返回 4xx/明确的"不支持图片"错误 -> 不支持；
 * - 网络异常/鉴权失败 -> 抛错，交由调用方决定是否回退到命名推断。
 */
export async function probeVisionSupport(provider: LLMProvider): Promise<boolean> {
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "请只回复一个字符：y" },
        { type: "image_url", image_url: { url: PROBE_IMAGE_DATA_URL } },
      ],
    },
  ];
  const result = await provider.chat(messages, { maxTokens: 8, temperature: 0 });
  // 能正常返回即视为接受图片输入
  return typeof result.content === "string";
}

const VISION_ERROR_HINTS = [
  "image",
  "vision",
  "multimodal",
  "does not support",
  "not support",
  "unsupported",
  "invalid content",
  "content type",
  "no endpoints found",
];

function looksLikeVisionRejection(err: LLMError): boolean {
  if (!err.status || err.status < 400 || err.status >= 500) return false;
  const text = `${err.message} ${err.body ?? ""}`.toLowerCase();
  return VISION_ERROR_HINTS.some((h) => text.includes(h));
}

/**
 * 综合判断单个模型的视觉能力：
 * 1) 先凭提供商知识库 + 模型命名快速判定；
 * 2) 命名无法确定时，用真实 Provider 发一张 1x1 图片实测；
 * 3) 实测遇网络/鉴权问题则返回 unknown（supported=null）。
 */
export async function detectModelVision(
  provider: LLMProvider,
  providerName: string,
  modelId: string,
): Promise<VisionProbeResult | { supported: null; source: "heuristic"; reason: string }> {
  const inferred = inferVisionFromName(providerName, modelId);
  if (inferred !== null) {
    return { supported: inferred, source: "heuristic", reason: "依据模型命名与提供商知识库判定" };
  }
  try {
    const supported = await probeVisionSupport(provider);
    return { supported, source: "probe" };
  } catch (err) {
    if (err instanceof LLMError && looksLikeVisionRejection(err)) {
      return { supported: false, source: "probe", reason: `上游拒绝图片输入 (${err.status})` };
    }
    const reason = err instanceof Error ? err.message : String(err);
    return { supported: null, source: "heuristic", reason: `无法实测：${reason}` };
  }
}

export function providerOf(record: ModelProvider | string): string {
  return record || "custom";
}

export type ModelForVision = Pick<ModelRecord, "id" | "provider" | "modelId" | "supportsVision">;
