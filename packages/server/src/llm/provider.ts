import type { ChatMessage, LLMChatOptions, LLMChatResult } from "../types";

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<LLMChatResult>;
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
