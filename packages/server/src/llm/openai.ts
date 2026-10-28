import type {
  ChatMessage,
  LLMChatOptions,
  LLMChatResult,
  LLMToolResult,
  ToolCall,
  ToolDefinition,
} from "../types";
import { LLMError, normalizeUsage, type LLMProvider } from "./provider";
import { toOpenAIPart } from "./multimodal";
import { fetchWithTimeout } from "../utils/http";
import {
  capabilitiesFor,
  chatThinkingEnabled,
  normalizeMaxTokens,
  thinkingDisabledBody,
  type ModelCapabilities,
} from "./capabilities";

export interface OpenAICompatibleOptions {
  apiKey: string;
  apiBase: string;
  model: string;
  name?: string;
  /**
   * 缓存字段风格提示。仅作为兜底顺序参考：
   * - "deepseek"：优先读 prompt_cache_hit_tokens / prompt_cache_miss_tokens
   * - "volcengine"：火山方舟（豆包），优先读 prompt_tokens_details.cached_tokens，兼容 deepseek 字段
   * - "openai"：优先读 prompt_tokens_details.cached_tokens
   * 实际解析始终按「探测式」兜底，避免上游字段差异导致缓存一律记 0。
   */
  cacheStyle?: "openai" | "deepseek" | "volcengine";
  /** 模型能力声明（由 factory 按模型注入），用于统一 maxTokens 与思考开关。 */
  capabilities?: ModelCapabilities;
}

/** 将统一消息转换为 OpenAI 兼容 Chat Completions 的 messages。 */
export function toApiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const content = Array.isArray(m.content)
      ? m.content.map((p) => (p.type === "text" ? { type: "text", text: p.text } : toOpenAIPart(p)))
      : m.content;
    const base: Record<string, unknown> = { role: m.role, content };
    if (m.role === "assistant" && m.toolCalls?.length) {
      base.tool_calls = m.toolCalls.map((t) => ({
        id: t.id,
        type: "function",
        function: { name: t.name, arguments: t.arguments },
      }));
      if (!m.content || (Array.isArray(m.content) && m.content.length === 0)) base.content = null;
    }
    if (m.role === "tool") {
      if (m.toolCallId) base.tool_call_id = m.toolCallId;
      delete base.name;
    } else if (m.name) {
      base.name = m.name;
    }
    return base;
  });
}

/**
 * 探测式解析缓存用量（与具体 Provider 实例无关，便于单测）。
 *
 * 各家 OpenAI 兼容网关的缓存字段名并不统一：
 * - DeepSeek：prompt_cache_hit_tokens / prompt_cache_miss_tokens
 * - OpenAI / 火山方舟（豆包）：prompt_tokens_details.cached_tokens
 * - 部分网关：cached_tokens / cache_read_input_tokens（Anthropic 风格）
 *
 * 按 cacheStyle 给出优先顺序后逐项兜底，只要任一字段存在即可正确统计，
 * 避免「字段对不上 → 缓存一律记 0」。
 */
export function parseUsage(
  data: any,
  cacheStyle: "openai" | "deepseek" | "volcengine" = "openai",
): { inputTokens: number; outputTokens: number; cacheHitTokens: number; cacheMissTokens: number } {
  const usage = data?.usage ?? {};
  const promptTokens = Number(usage.prompt_tokens ?? 0);
  const details = usage.prompt_tokens_details ?? {};
  const deepseekHit = usage.prompt_cache_hit_tokens;
  const deepseekMiss = usage.prompt_cache_miss_tokens;
  const openaiCached = details.cached_tokens ?? usage.cached_tokens;
  const anthropicRead = usage.cache_read_input_tokens;

  // 按 cacheStyle 决定优先读哪个字段，其余作为兜底
  const hitSources =
    cacheStyle === "deepseek"
      ? [deepseekHit, openaiCached, anthropicRead]
      : [openaiCached, deepseekHit, anthropicRead];

  let cacheHitTokens = 0;
  for (const source of hitSources) {
    const n = Number(source);
    if (Number.isFinite(n) && n > 0) {
      cacheHitTokens = n;
      break;
    }
  }

  // miss 优先用上游显式给出的小字段；否则用 输入 - 命中 推导
  const explicitMiss = Number(deepseekMiss);
  const cacheMissTokens =
    Number.isFinite(explicitMiss) && explicitMiss > 0
      ? explicitMiss
      : Math.max(promptTokens - cacheHitTokens, 0);

  return normalizeUsage({
    inputTokens: promptTokens,
    outputTokens: Number(usage.completion_tokens ?? 0),
    cacheHitTokens,
    cacheMissTokens,
  });
}

function parseToolCalls(raw: any): ToolCall[] {  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const c of raw) {
    if (!c) continue;
    calls.push({
      id: c.id ?? `call_${calls.length}`,
      name: c.function?.name ?? "",
      arguments: c.function?.arguments ?? "{}",
    });
  }
  return calls;
}

/**
 * 兼容 OpenAI Chat Completions 协议的 Provider。
 * 同时适用于 OpenAI、DeepSeek、以及任何 OpenAI 兼容网关。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  readonly supportsTools = true;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly cacheStyle: "openai" | "deepseek" | "volcengine";
  private readonly capabilities: ModelCapabilities;

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.cacheStyle = opts.cacheStyle ?? "openai";
    this.capabilities =
      opts.capabilities ?? capabilitiesFor({ provider: this.name as any, modelId: opts.model, apiBase: opts.apiBase });
  }

  /**
   * 探测式解析缓存用量。
   *
   * 各家 OpenAI 兼容网关返回的缓存字段名并不统一：
   * - DeepSeek：prompt_cache_hit_tokens / prompt_cache_miss_tokens
   * - OpenAI / 火山方舟（豆包）：prompt_tokens_details.cached_tokens
   * - 部分网关：cached_tokens / cache_read_input_tokens（Anthropic 风格）
   *
   * 这里不再只按 provider 猜一种，而是按 cacheStyle 给出优先顺序后逐项兜底，
   * 只要任一字段存在即可正确统计，避免「字段对不上 → 一律记 0」。
   */
  private buildUsage(data: any) {
    return parseUsage(data, this.cacheStyle);
  }

  private async request(data: any, tools: ToolDefinition[] | undefined, options: LLMChatOptions): Promise<any> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: data.messages,
      stream: false,
      // 统一 maxTokens 语义：非法/未设置回退 2048，且不超过模型输出上限。
      max_tokens: normalizeMaxTokens(options.maxTokens, this.capabilities),
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;

    // 闲聊场景默认关闭思考，避免可见回复的 token 预算被推理过程吃光。
    const wantThinking = options.thinking ?? chatThinkingEnabled();
    if (!wantThinking) {
      const disabled = thinkingDisabledBody(this.capabilities);
      if (disabled) Object.assign(body, disabled);
    }
    if (tools?.length) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }

    const res = await fetchWithTimeout(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
      timeoutMs: 120000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`LLM request failed (${res.status})`, res.status, text);
    }
    return res.json();
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const data = await this.request({ messages: toApiMessages(messages) }, undefined, options);
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    return {
      content,
      model: data?.model ?? this.model,
      usage: this.buildUsage(data),
      raw: data,
    };
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options: LLMChatOptions = {},
  ): Promise<LLMToolResult> {
    const data = await this.request({ messages: toApiMessages(messages) }, tools, options);
    const message = data?.choices?.[0]?.message;
    return {
      content: message?.content ?? "",
      toolCalls: parseToolCalls(message?.tool_calls),
      model: data?.model ?? this.model,
      usage: this.buildUsage(data),
      raw: data,
    };
  }
}
