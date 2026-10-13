import type { Bot, ModelRecord, Persona } from "../types";
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
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
};

/** 火山引擎方舟（豆包）的模型命名/端点特征，用于自动识别微信/兼容网关。 */
function isVolcengine(model: ModelRecord): boolean {
  if (model.provider === "volcengine") return true;
  if (/volces\.com|volcengine/i.test(model.apiBase ?? "")) return true;
  return /^doubao-|^ep-\d/i.test(model.modelId);
}

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
    case "volcengine":
      return new OpenAICompatibleProvider({
        apiKey,
        apiBase,
        model: model.modelId,
        name: "volcengine",
        cacheStyle: "volcengine",
      });
    case "openai":
    case "custom":
    default:
      // 兼容网关（custom）可能是火山方舟，按特征识别以选用正确的缓存字段
      return new OpenAICompatibleProvider({
        apiKey,
        apiBase,
        model: model.modelId,
        name: model.provider,
        cacheStyle: isVolcengine(model) ? "volcengine" : "openai",
      });
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

/**
 * 解析某次对话实际使用的模型：优先按 Bot 分配的模型，Bot 未配置或不可用时回退到角色配置。
 *
 * 模型分配以 Bot 为单位（同一个角色可被多个 Bot 复用，各 Bot 可用不同模型）。
 * 这里保持纯"选一个可用模型"的语义，不做失败后自动切换其它模型的故障转移。
 */
export function resolveProviderForBot(
  bot: Pick<Bot, "modelId"> | null | undefined,
  persona: Persona,
): { provider: LLMProvider; model: ModelRecord | null } {
  const targetId = bot?.modelId;
  if (targetId) {
    const model = modelRepo.find(targetId);
    if (model && model.enabled) {
      return { provider: createProviderFromModel(model), model };
    }
    logger.warn({ modelId: targetId }, "bot-configured model unavailable, falling back to persona/default");
  }
  return resolveProviderForPersona(persona);
}
