import type {
  ChatMessage,
  LLMChatOptions,
  LLMChatResult,
  LLMToolResult,
  ToolDefinition,
} from "../types";

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
