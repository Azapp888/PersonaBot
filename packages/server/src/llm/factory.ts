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
 * 默认模型解析：优先第一个启用的非 mock 模型，其次任意启用模型，最后回退 Mock。
 * 模型只在「模型管理」中维护、在「Bot 管理」中分配，角色不再持有模型配置。
 */
export function resolveDefaultProvider(): { provider: LLMProvider; model: ModelRecord | null } {
  const models = modelRepo.listEnabled();
  const preferred = models.find((m) => m.provider !== "mock") ?? models[0];
  if (preferred) {
    return { provider: createProviderFromModel(preferred), model: preferred };
  }
  logger.warn("no enabled model found, falling back to MockProvider");
  return { provider: new MockProvider(), model: null };
}

/**
 * 解析后台任务（记忆整理、日程生成、上下文压缩等）使用的 Provider。
 * 这些任务不绑定具体 Bot，统一使用默认模型。
 */
export function resolveProviderForPersona(_persona: Persona): { provider: LLMProvider; model: ModelRecord | null } {
  return resolveDefaultProvider();
}

/**
 * 解析某次对话实际使用的模型：按 Bot 分配的模型；Bot 未配置或不可用时回退到默认模型。
 *
 * 模型分配以 Bot 为单位（同一个角色可被多个 Bot 复用，各 Bot 可用不同模型）。
 * 这里保持纯"选一个可用模型"的语义，不做失败后自动切换其它模型的故障转移。
 */
export function resolveProviderForBot(
  bot: Pick<Bot, "modelId"> | null | undefined,
  _persona: Persona,
): { provider: LLMProvider; model: ModelRecord | null } {
  const targetId = bot?.modelId;
  if (targetId) {
    const model = modelRepo.find(targetId);
    if (model && model.enabled) {
      return { provider: createProviderFromModel(model), model };
    }
    logger.warn({ modelId: targetId }, "bot-configured model unavailable, falling back to default model");
  }
  return resolveDefaultProvider();
}
