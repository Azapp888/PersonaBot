import type { ChatMessage, LLMChatOptions, LLMChatResult } from "../types";
import { LLMError, normalizeUsage, contentToText, type LLMProvider } from "./provider";
import { toAnthropicContent } from "./multimodal";
import { fetchWithTimeout } from "../utils/http";
import { capabilitiesFor, normalizeMaxTokens, type ModelCapabilities } from "./capabilities";

export interface AnthropicOptions {
  apiKey: string;
  apiBase?: string;
  model: string;
  capabilities?: ModelCapabilities;
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
  private readonly capabilities: ModelCapabilities;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = (opts.apiBase || "https://api.anthropic.com").replace(/\/$/, "");
    this.capabilities =
      opts.capabilities ?? capabilitiesFor({ provider: "anthropic", modelId: opts.model, apiBase: opts.apiBase });
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => contentToText(m.content));
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: normalizeMaxTokens(options.maxTokens, this.capabilities),
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
