import type {
  ChatMessage,
  ContentPart,
  LLMChatOptions,
  LLMChatResult,
  LLMToolResult,
  ToolDefinition,
} from "../types";

/** 从多模态/文本 content 中提取纯文本（用于日志、摘要等场景）。 */
export function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

/** 将消息 content 规范化为文本片段数组形式。 */
export function toContentParts(content: ChatMessage["content"]): ContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  /** 是否支持工具调用（function calling） */
  readonly supportsTools?: boolean;
  chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<LLMChatResult>;
  /** 支持工具调用的 Provider 可选实现 */
  chatWithTools?(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: LLMChatOptions,
  ): Promise<LLMToolResult>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export function normalizeUsage(raw: {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}) {
  const cacheHit = raw.cacheHitTokens ?? 0;
  const cacheMiss = raw.cacheMissTokens ?? Math.max(raw.inputTokens - cacheHit, 0);
  return {
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cacheHitTokens: cacheHit,
    cacheMissTokens: cacheMiss,
  };
}
