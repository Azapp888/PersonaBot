import type { ModelRecord, Persona } from "../types";
import { modelRepo } from "../db/repos/models";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatibleProvider } from "./openai";
import { MockProvider } from "./mock";
import type { LLMProvider } from "./provider";
import { logger } from "../logger";

const DEFAULT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com",
};

export function createProviderFromModel(model: ModelRecord): LLMProvider {
  const apiKey = modelRepo.decryptedKey(model);
  const apiBase = model.apiBase || DEFAULT_BASES[model.provider] || DEFAULT_BASES.openai;

  switch (model.provider) {
    case "mock":
      return new MockProvider();
    case "anthropic":
      return new AnthropicProvider({ apiKey, apiBase, model: model.modelId });
    case "deepseek":
      return new OpenAICompatibleProvider({
        apiKey,
        apiBase,
        model: model.modelId,
        name: "deepseek",
        cacheStyle: "deepseek",
      });
    case "openai":
    case "custom":
    default:
      return new OpenAICompatibleProvider({ apiKey, apiBase, model: model.modelId, name: model.provider });
  }
}

/**
 * 依据角色配置解析要使用的 LLM Provider。
 * 优先级：persona.modelConfig.modelId 指定的模型 > 第一个启用的模型 > Mock
 */
export function resolveProviderForPersona(persona: Persona): { provider: LLMProvider; model: ModelRecord | null } {
  const targetId = persona.modelConfig.modelId;
  if (targetId) {
    const model = modelRepo.find(targetId);
    if (model && model.enabled) {
      return { provider: createProviderFromModel(model), model };
    }
  }
  const models = modelRepo.listEnabled();
  const preferred = models.find((m) => m.provider !== "mock") ?? models[0];
  if (preferred) {
    return { provider: createProviderFromModel(preferred), model: preferred };
  }
  logger.warn({ personaId: persona.id }, "no enabled model found, falling back to MockProvider");
  return { provider: new MockProvider(), model: null };
}
