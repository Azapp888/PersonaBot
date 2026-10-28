import type { ChatMessage, LLMChatOptions, LLMChatResult } from "../types";
import { LLMError, normalizeUsage, contentToText, type LLMProvider } from "./provider";
import { toAnthropicContent } from "./multimodal";
import { fetchWithTimeout } from "../utils/http";
import { capabilitiesFor, normalizeMaxTokens, type ModelCapabilities } from "./capabilities";
import { extractSseEvents, sseData, type StreamChunk } from "./stream";

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

  private buildBody(messages: ChatMessage[], options: LLMChatOptions, stream: boolean): Record<string, unknown> {
    const systemParts = messages.filter((m) => m.role === "system").map((m) => contentToText(m.content));
    const convo = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: toAnthropicContent(m.content) }));

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: normalizeMaxTokens(options.maxTokens, this.capabilities),
      messages: convo.length ? convo : [{ role: "user", content: "..." }],
    };
    if (stream) body.stream = true;
    if (systemParts.length) {
      body.system = [{ type: "text", text: systemParts.join("\n\n"), cache_control: { type: "ephemeral" } }];
    }
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.topP !== undefined) body.top_p = options.topP;
    return body;
  }

  private async post(body: Record<string, unknown>, options: LLMChatOptions, stream: boolean): Promise<Response> {
    const res = await fetchWithTimeout(`${this.apiBase}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: stream ? "text/event-stream" : "application/json",
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
    return res;
  }

  async *chatStream(messages: ChatMessage[], options: LLMChatOptions = {}): AsyncIterable<StreamChunk> {
    const res = await this.post(this.buildBody(messages, options, true), options, true);
    if (!res.body) throw new LLMError("Anthropic 流式响应缺少 body", res.status);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheCreate = 0;
    let model: string | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, rest } = extractSseEvents(buffer);
        buffer = rest;
        for (const block of events) {
          const payload = sseData(block);
          if (!payload) continue;
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          if (json?.type === "message_start") {
            const msg = json.message ?? {};
            model = msg.model ?? model;
            inputTokens = Number(msg.usage?.input_tokens ?? inputTokens);
            cacheRead = Number(msg.usage?.cache_read_input_tokens ?? cacheRead);
            cacheCreate = Number(msg.usage?.cache_creation_input_tokens ?? cacheCreate);
          } else if (json?.type === "content_block_delta") {
            const text: string = json.delta?.text ?? "";
            if (text) yield { delta: text };
          } else if (json?.type === "message_delta") {
            outputTokens = Number(json.usage?.output_tokens ?? outputTokens);
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
    yield {
      delta: "",
      model,
      usage: normalizeUsage({
        inputTokens: inputTokens + cacheRead + cacheCreate,
        outputTokens,
        cacheHitTokens: cacheRead,
        cacheMissTokens: inputTokens + cacheCreate,
      }),
    };
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const res = await this.post(this.buildBody(messages, options, false), options, false);
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
