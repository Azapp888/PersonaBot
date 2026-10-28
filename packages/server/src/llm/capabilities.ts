import type { ModelRecord } from "../types";

/** 关闭思考时各协议使用的参数名。 */
export type ThinkingParam = "thinking" | "thinking_budget" | "none";

/**
 * 模型能力声明：集中描述「是否支持思考、如何关闭思考、输出 token 上限」。
 *
 * 放在 provider 层统一归一化，避免每个调用点各写一套 maxTokens 语义，
 * 也避免不同上游把可见回复的预算耗在不可见的推理 token 上。
 */
export interface ModelCapabilities {
  supportsThinking: boolean;
  thinkingParam: ThinkingParam;
  /** 单次请求的输出 token 硬上限（含思考 token）。 */
  maxOutputTokens: number;
  /** 是否为推理模型（用于闲聊/深度场景路由）。 */
  reasoning: boolean;
}

type CapabilityInput = Pick<ModelRecord, "provider" | "modelId"> & { apiBase?: string | null };

const REASONING_MODEL = /(?:^|[-_/])(reasoner|r1|qwq|o1|o3|o4-mini|thinking)(?:$|[-_/])|deepseek-r1|glm-z1/i;

/**
 * CHAT_THINKING：
 * - off（默认）：闲聊场景显式关闭思考，降低 TTFT 与输出 token；
 * - on：保留上游默认的思考行为。
 *
 * CHAT_THINKING_PARAM 可覆盖关闭思考的参数名（thinking / thinking_budget），
 * 因为 GLM 不同版本分别使用 `thinking:{type:"disabled"}` 与 `thinking_budget:0`。
 */
export function chatThinkingEnabled(): boolean {
  return (process.env.CHAT_THINKING ?? "off").toLowerCase() === "on";
}

export function capabilitiesFor(model: CapabilityInput): ModelCapabilities {
  const provider = model.provider ?? "";
  const id = (model.modelId ?? "").toLowerCase();
  const base = (model.apiBase ?? "").toLowerCase();
  const isReasoning = REASONING_MODEL.test(id);

  const isZhipu = provider === "zhipu" || /bigmodel\.cn/.test(base);
  const isArk =
    provider === "volcengine" ||
    /volces\.com|volcengine/.test(base) ||
    /^doubao-|^ep-\d/.test(id);

  let thinkingParam: ThinkingParam = "none";
  if (isZhipu || isArk) {
    thinkingParam =
      (process.env.CHAT_THINKING_PARAM ?? "").toLowerCase() === "thinking_budget" ? "thinking_budget" : "thinking";
  }

  // 输出上限：Claude / GLM / 豆包普遍支持 8k 以上；其余给 4k，避免莫名截断。
  const maxOutputTokens = provider === "anthropic" || isZhipu || isArk ? 8192 : 4096;

  return {
    supportsThinking: thinkingParam !== "none" || isReasoning || provider === "anthropic",
    thinkingParam: isReasoning && thinkingParam === "none" ? "none" : thinkingParam,
    maxOutputTokens,
    reasoning: isReasoning,
  };
}

/**
 * 统一 maxTokens 语义：非法/未设置时用 2048，且不超过模型能力上限。
 * Anthropic 的 max_tokens、OpenAI 的 max_tokens、Gemini 的 maxOutputTokens 都走这里。
 */
export function normalizeMaxTokens(requested: number | undefined, caps: ModelCapabilities, fallback = 2048): number {
  const value =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : fallback;
  return Math.max(1, Math.min(value, caps.maxOutputTokens));
}

/** 生成关闭思考时需要写入请求体的字段。 */
export function thinkingDisabledBody(caps: ModelCapabilities): Record<string, unknown> | null {
  if (!caps.supportsThinking || caps.thinkingParam === "none") return null;
  if (caps.thinkingParam === "thinking_budget") return { thinking_budget: 0 };
  return { thinking: { type: "disabled" } };
}
