import type {
  ChatMessage,
  LLMChatOptions,
  LLMChatResult,
  LLMToolResult,
  ToolCall,
  ToolDefinition,
} from "../types";
import { LLMError, normalizeUsage, type LLMProvider } from "./provider";
import { fetchWithTimeout } from "../utils/http";

export interface OpenAICompatibleOptions {
  apiKey: string;
  apiBase: string;
  model: string;
  name?: string;
  /** 是否使用 deepseek 风格的缓存字段 */
  cacheStyle?: "openai" | "deepseek";
}

function toApiMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    const base: Record<string, unknown> = { role: m.role, content: m.content };
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

function parseToolCalls(raw: any): ToolCall[] {
  if (!Array.isArray(raw)) return [];
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
  private readonly cacheStyle: "openai" | "deepseek";

  constructor(opts: OpenAICompatibleOptions) {
    this.name = opts.name ?? "openai-compatible";
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.cacheStyle = opts.cacheStyle ?? "openai";
  }

  private buildUsage(data: any) {
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

    return normalizeUsage({
      inputTokens: Number(usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.completion_tokens ?? 0),
      cacheHitTokens,
      cacheMissTokens,
    });
  }

  private async request(data: any, tools: ToolDefinition[] | undefined, options: LLMChatOptions): Promise<any> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: data.messages,
      stream: false,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.topP !== undefined) body.top_p = options.topP;
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
