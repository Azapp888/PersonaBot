import type { ChatMessage, ContentPart, LLMChatOptions, LLMChatResult, ImageContentPart } from "../types";
import { LLMError, normalizeUsage, contentToText, type LLMProvider } from "./provider";
import { imageLimitFor, parseImageDataUrl, toGeminiPart, toImageDataUrl } from "./multimodal";
import { fetchWithTimeout } from "../utils/http";
import { capabilitiesFor, normalizeMaxTokens, type ModelCapabilities } from "./capabilities";

export interface GoogleOptions {
  apiKey: string;
  /** 原生 Gemini API 根地址，默认 https://generativelanguage.googleapis.com */
  apiBase?: string;
  model: string;
  capabilities?: ModelCapabilities;
}

interface GeminiContent {
  role: "user" | "model";
  parts: Record<string, unknown>[];
}

function endpoint(base: string, model: string): string {
  const root = base.replace(/\/$/, "");
  const withVersion = /\/v\d+(beta)?$/i.test(root) ? root : `${root}/v1beta`;
  return `${withVersion}/models/${encodeURIComponent(model)}:generateContent`;
}

/** 远程图片先下载并转成 data:URL，Gemini 原生内联输入只接受 base64。 */
async function imagePartToGemini(part: ImageContentPart): Promise<Record<string, unknown>> {
  const parsed = parseImageDataUrl(part.image_url.url);
  if (parsed) return toGeminiPart(part);

  const url = part.image_url.url;
  if (!/^https?:\/\//i.test(url)) {
    throw new LLMError("Gemini 图片必须是 data:image/*;base64 或公网 https 地址", 400);
  }
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new LLMError(`图片下载失败 (${res.status})`, 502);
  const limit = imageLimitFor("google");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit.maxBytes) {
    throw new LLMError(`图片过大（${Math.round(buf.length / 1024)}KB），Gemini 单图上限 20MB`, 400);
  }
  const { dataUrl } = toImageDataUrl(buf);
  return toGeminiPart({ ...part, image_url: { url: dataUrl } }, limit.mimes);
}

async function contentToGeminiParts(content: ChatMessage["content"]): Promise<Record<string, unknown>[]> {
  if (typeof content === "string") return [{ text: content }];
  const parts: Record<string, unknown>[] = [];
  for (const p of content as ContentPart[]) {
    if (p.type === "text") parts.push({ text: p.text });
    else parts.push(await imagePartToGemini(p));
  }
  return parts;
}

/**
 * Google Gemini 原生 generateContent Provider。
 *
 * 与 OpenAI 兼容协议的关键差异：
 * - 请求体使用 contents/parts，图片是 {inline_data:{mime_type,data}}；
 * - system 消息提取为 systemInstruction；
 * - assistant 角色在 Gemini 中叫 model；
 * - data 字段是纯 base64，不能带 data: 前缀。
 */
export class GoogleProvider implements LLMProvider {
  readonly name = "google";
  readonly model: string;
  readonly supportsTools = false;
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly capabilities: ModelCapabilities;

  constructor(opts: GoogleOptions) {
    this.model = opts.model;
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase || "https://generativelanguage.googleapis.com";
    this.capabilities =
      opts.capabilities ?? capabilitiesFor({ provider: "google", modelId: opts.model, apiBase: opts.apiBase });
  }

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    const systemParts = messages
      .filter((m) => m.role === "system")
      .map((m) => contentToText(m.content))
      .filter(Boolean);
    const contents: GeminiContent[] = [];

    for (const m of messages) {
      if (m.role === "system") continue;
      const role: GeminiContent["role"] = m.role === "assistant" ? "model" : "user";
      const parts = await contentToGeminiParts(m.content);
      if (!parts.length) continue;
      const last = contents[contents.length - 1];
      // Gemini 要求 user/model 交替；连续同角色消息合并，避免上游 400。
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts });
    }

    const body: Record<string, unknown> = {
      contents: contents.length ? contents : [{ role: "user", parts: [{ text: "..." }] }],
    };
    if (systemParts.length) {
      body.systemInstruction = { parts: [{ text: systemParts.join("\n\n") }] };
    }
    const generationConfig: Record<string, unknown> = {};
    if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
    generationConfig.maxOutputTokens = normalizeMaxTokens(options.maxTokens, this.capabilities);
    if (options.topP !== undefined) generationConfig.topP = options.topP;
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const res = await fetchWithTimeout(endpoint(this.apiBase, this.model), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": this.apiKey,
      },
      body: JSON.stringify(body),
      signal: options.signal,
      timeoutMs: 120000,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LLMError(`Gemini request failed (${res.status})`, res.status, text);
    }

    const data: any = await res.json();
    const blocked = data?.promptFeedback?.blockReason;
    if (blocked) throw new LLMError(`Gemini blocked the prompt: ${blocked}`, 400);
    const candidate = data?.candidates?.[0];
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const content = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");

    const usage = data?.usageMetadata ?? {};
    const inputTokens = Number(usage.promptTokenCount ?? 0);
    const cacheHit = Number(usage.cachedContentTokenCount ?? 0);
    return {
      content,
      model: data?.modelVersion ?? this.model,
      usage: normalizeUsage({
        inputTokens,
        outputTokens: Number(usage.candidatesTokenCount ?? 0),
        cacheHitTokens: cacheHit,
        cacheMissTokens: Math.max(inputTokens - cacheHit, 0),
      }),
      raw: data,
    };
  }
}
