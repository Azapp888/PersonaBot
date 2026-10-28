import type { Bot, ModelRecord, Persona } from "../types";
import { modelRepo } from "../db/repos/models";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { OpenAICompatibleProvider } from "./openai";
import { MockProvider } from "./mock";
import type { LLMProvider } from "./provider";
import { pickVisionFallback } from "./vision";
import { settingsService } from "../settings/service";
import { logger } from "../logger";

const DEFAULT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  // Gemini 原生 generateContent；如需 OpenAI 兼容协议，请把 apiBase 设为
  // https://generativelanguage.googleapis.com/v1beta/openai
  google: "https://generativelanguage.googleapis.com",
  // 通义千问 OpenAI 兼容模式
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  minimax: "https://api.minimax.chat/v1",
  qianfan: "https://qianfan.baidubce.com/v2",
  tencent: "https://api.hunyuan.cloud.tencent.com/v1",
  spark: "https://spark-api-open.xf-yun.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
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
    case "google":
      // 允许把 Gemini 切成 OpenAI 兼容端点；否则走原生 generateContent。
      if (/\/openai\/?$/i.test(apiBase)) {
        return new OpenAICompatibleProvider({ apiKey, apiBase, model: model.modelId, name: "google", cacheStyle: "openai" });
      }
      return new GoogleProvider({ apiKey, apiBase, model: model.modelId });
    case "dashscope":
      return new OpenAICompatibleProvider({
        apiKey,
        apiBase,
        model: model.modelId,
        name: "dashscope",
        cacheStyle: "openai",
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
export interface ProviderCandidate {
  provider: LLMProvider;
  model: ModelRecord | null;
}

/**
 * 解析一次对话的「模型候选链」：Bot 绑定的模型优先，其余已启用模型依次兜底。
 *
 * 单个模型故障（超时、5xx、限流）时切换到下一个候选，避免整轮回复直接失败。
 * mock 只作为最后兜底，且仅当没有真实模型可用时才会被选中，保证真实模型优先。
 */
export function resolveProviderChain(
  bot: Pick<Bot, "modelId"> | null | undefined,
  _persona: Persona,
): ProviderCandidate[] {
  const chain: ProviderCandidate[] = [];
  const seen = new Set<string>();
  const push = (model: ModelRecord) => {
    if (seen.has(model.id)) return;
    try {
      chain.push({ provider: createProviderFromModel(model), model });
      seen.add(model.id);
    } catch (err) {
      logger.warn({ modelId: model.id, err: (err as Error).message }, "failed to construct provider, skipping candidate");
    }
  };

  const targetId = bot?.modelId;
  if (targetId) {
    const model = modelRepo.find(targetId);
    if (model && model.enabled) {
      push(model);
    } else {
      logger.warn({ modelId: targetId }, "bot-configured model unavailable, falling back to other models");
    }
  }

  const enabled = modelRepo.listEnabled();
  for (const model of enabled) if (model.provider !== "mock") push(model);
  for (const model of enabled) if (model.provider === "mock") push(model);

  if (chain.length === 0) {
    logger.warn("no enabled model found, falling back to MockProvider");
    chain.push({ provider: new MockProvider(), model: null });
  }
  return chain;
}

export function resolveProviderForBot(
  bot: Pick<Bot, "modelId"> | null | undefined,
  persona: Persona,
): ProviderCandidate {
  return resolveProviderChain(bot, persona)[0];
}

/**
 * 选择一个可用于「读图转述」的视觉副模型。
 * 优先使用 settings.visionFallbackModelId，其次取首个已启用且声明支持读图的模型，
 * 且不与主模型重复。返回 null 表示当前没有可用的视觉模型。
 */
export function resolveVisionFallbackModel(primaryModelId?: string | null): ModelRecord | null {
  const preferred = settingsService.get().visionFallbackModelId || null;
  return pickVisionFallback(modelRepo.listEnabled(), preferred, primaryModelId ?? null);
}

export function resolveVisionFallbackProvider(
  primaryModelId?: string | null,
): { provider: LLMProvider; model: ModelRecord } | null {
  const model = resolveVisionFallbackModel(primaryModelId);
  if (!model) return null;
  return { provider: createProviderFromModel(model), model };
}
