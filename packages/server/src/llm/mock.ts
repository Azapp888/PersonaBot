import type { ChatMessage, LLMChatOptions, LLMChatResult } from "../types";
import type { LLMProvider } from "./provider";
import { sleep } from "../utils/id";

/**
 * Mock Provider：无需任何真实凭据即可本地联调。
 * 会回显最近一条用户消息，并按角色 system prompt 简单地"扮演"。
 */
export class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly model = "mock-roleplay";

  async chat(messages: ChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResult> {
    await sleep(120);
    if (options.signal?.aborted) {
      throw new Error("aborted");
    }
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const nameMatch = system.match(/你是([^\n，。,]{1,12})/);
    const personaName = nameMatch ? nameMatch[1] : "角色";

    const content =
      `（${personaName}·模拟回复）我听到你说：「${lastUser.slice(0, 80)}」。` +
      `这是 Mock Provider 的占位回复，接入真实 LLM 后即可获得符合人格的回应。`;

    const inputTokens = Math.ceil((system.length + lastUser.length) / 3) + 40;
    const outputTokens = Math.ceil(content.length / 3);
    return {
      content,
      model: this.model,
      usage: {
        inputTokens,
        outputTokens,
        cacheHitTokens: Math.floor(inputTokens * 0.4),
        cacheMissTokens: inputTokens - Math.floor(inputTokens * 0.4),
      },
    };
  }
}
