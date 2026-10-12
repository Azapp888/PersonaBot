import type { ChatMessage, LLMChatOptions, LLMChatResult, ContentPart } from "../types";
import { LLMError, normalizeUsage, toContentParts, contentToText, type LLMProvider } from "./provider";
import { fetchWithTimeout } from "../utils/http";

export interface AnthropicOptions {
  apiKey: string;
  apiBase?: string;
  model: string;
}

/** 将统一的多模态 content 转换为 Anthropic Messages 格式。 */
function toAnthropicContent(content: ChatMessage["content"]): unknown {
  const parts = toContentParts(content);
  // 纯文本时保持字符串，兼容性最好
  if (parts.length === 1 && parts[0].type === "text") return parts[0].text;
  return parts.map((p: ContentPart) => {
    if (p.type === "text") return { type: "text", text: p.text };
    const url = p.image_url.url;
    if (url.startsWith("data:")) {
      const match = url.match(/^data:([^;]+);base64,(.*)$/);
      if (match) {
        return { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } };
      }
    }
    return { type: "image", source: { type: "url", url } };
  });
}

/**
 * Anthropic Claude Messages API Provider。
 * system 消息会被抽取为顶层 system 字段，并开启 prompt caching。
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly apiKey: string;
  private readonly apiBase: string;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase || "https://api.anthropic.com").replace(/\/$/, "");
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => contentToText(m.content));
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 2048,
      messages: convo.length ? convo : [{ role: "user", content: "..." }],
    };
    if (systemParts.length) {
      body.system = [{ type: "text", text: systemParts.join("\n\n"), cache_control: { type: "ephemeral" } }];
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;

    const res = await fetchWithTimeout(`${this.apiBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: options.signal,
      timeoutMs: 120000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`Anthropic request failed (${res.status})`, res.status, text);
    }

    const data: any = await res.json();
    const content = Array.isArray(data?.content)
      ? data.content.map((c: any) => c.text ?? "").join("")
      : (data?.content ?? "");
    const usage = data?.usage ?? {};
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
    const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
    const inputTokens = Number(usage.input_tokens ?? 0);
    return {
      content,
      model: data?.model ?? this.model,
      usage: normalizeUsage({
        inputTokens: inputTokens + cacheRead + cacheCreate,
        outputTokens: Number(usage.output_tokens ?? 0),
        cacheHitTokens: cacheRead,
        cacheMissTokens: inputTokens + cacheCreate,
      }),
      raw: data,
    };
  }
}
