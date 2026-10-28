import type { LLMUsage } from "../types";

/** 流式响应的一小块。`delta` 为空表示只携带 usage/model 的收尾块。 */
export interface StreamChunk {
  delta: string;
  usage?: LLMUsage;
  model?: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

/** 解析 SSE 时按空行切分事件块。 */
export function extractSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: string[] = [];
  let index = normalized.indexOf("\n\n");
  let rest = normalized;
  while (index >= 0) {
    events.push(rest.slice(0, index));
    rest = rest.slice(index + 2);
    index = rest.indexOf("\n\n");
  }
  return { events, rest };
}

/** 从 SSE 事件块中取出 data 负载（可能多行）。 */
export function sseData(block: string): string | null {
  const lines = block.split("\n").filter((line) => line.startsWith("data:"));
  if (!lines.length) return null;
  return lines.map((line) => line.slice(5).trimStart()).join("\n");
}

/** 句子边界：换行或中英文句末标点。返回首个边界的结束下标（不含则 -1）。 */
export function firstSentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (/[\n。！？!?]/.test(text[i])) return i + 1;
  }
  return -1;
}
