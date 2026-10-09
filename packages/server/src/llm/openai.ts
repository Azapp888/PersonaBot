import type { ChatMessage, LLMChatOptions, LLMChatResult } from "../types";
import { LLMError, normalizeUsage, type LLMProvider } from "./provider";

export interface OpenAICompatibleOptions {
  apiKey: string;
  apiBase: string;
  model: string;
  name?: string;
  /** 是否使用 deepseek 风格的缓存字段 */
  cacheStyle?: "openai" | "deepseek";
}

/**
 * 兼容 OpenAI Chat Completions 协议的 Provider。
 * 同时适用于 OpenAI、DeepSeek、以及任何 OpenAI 兼容网关。
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly cacheStyle: "openai" | "deepseek";

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.cacheStyle = opts.cacheStyle ?? "openai";
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content, ...(m.name ? { name: m.name } : {}) })),
      stream: false,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.topP !== undefined) body.top_p = options.topP;

    const res = await fetch(`${this.apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`LLM request failed (${res.status})`, res.status, text);
    }

    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    const usage = data?.usage ?? {};
    const cachedFromOpenAI = usage?.prompt_tokens_details?.cached_tokens;
    const deepseekHit = usage?.prompt_cache_hit_tokens;
    const deepseekMiss = usage?.prompt_cache_miss_tokens;

    let cacheHitTokens = 0;
    let cacheMissTokens = 0;
    if (this.cacheStyle === "deepseek") {
      cacheHitTokens = Number(deepseekHit ?? 0);
      cacheMissTokens = Number(deepseekMiss ?? Math.max((usage.prompt_tokens ?? 0) - cacheHitTokens, 0));
    } else {
      cacheHitTokens = Number(cachedFromOpenAI ?? 0);
      cacheMissTokens = Math.max((usage.prompt_tokens ?? 0) - cacheHitTokens, 0);
    }

    return {
      content,
      model: data?.model ?? this.model,
      usage: normalizeUsage({
        inputTokens: Number(usage.prompt_tokens ?? 0),
        outputTokens: Number(usage.completion_tokens ?? 0),
        cacheHitTokens,
        cacheMissTokens,
      }),
      raw: data,
    };
  }
}
