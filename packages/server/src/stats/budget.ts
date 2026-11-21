import { statsRepo } from "../db/repos/stats";
import { modelRepo } from "../db/repos/models";
import { createProviderFromModel, type ProviderCandidate } from "../llm/factory";
import { settingsService } from "../settings/service";
import { formatDate } from "../utils/id";

/**
 * 费用预算闸门。
 *
 * 每日 token 用量来自 stats 表（与仪表盘同源），超出 settings.tokenDailyBudget 后
 * 按 tokenBudgetAction 处理：
 * - block：不调用模型，直接用本地兜底文案回复并记录系统日志；
 * - degrade：切换到配置的便宜模型，仍不可用时退化为 block。
 *
 * 预算 0 表示关闭闸门，保持原有行为不变。
 */
export interface BudgetStatus {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** 已用比例（0~1，可能大于 1）。 */
  ratio: number;
  exceeded: boolean;
  action: "block" | "degrade";
  fallbackModelId: string | null;
  fallbackAvailable: boolean;
}

export const BUDGET_BLOCK_REPLY = "（今天聊得有点多了，我先歇一会儿，明天再接着聊吧。）";

export function todayTokenUsage(): number {
  return statsRepo.byDate(formatDate()).reduce((sum, row) => sum + row.tokenConsumed, 0);
}

export function budgetStatus(): BudgetStatus {
  const settings = settingsService.get();
  const limit = Math.max(0, Math.floor(Number(settings.tokenDailyBudget) || 0));
  const used = todayTokenUsage();
  const action: "block" | "degrade" = settings.tokenBudgetAction === "degrade" ? "degrade" : "block";
  const fallbackModelId = settings.tokenBudgetFallbackModelId?.trim() || null;
  const fallbackAvailable = !!(
    fallbackModelId &&
    modelRepo.find(fallbackModelId)?.enabled
  );
  const enabled = limit > 0;
  return {
    enabled,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    ratio: limit > 0 ? used / limit : 0,
    exceeded: enabled && used >= limit,
    action,
    fallbackModelId,
    fallbackAvailable,
  };
}

export type BudgetDecision =
  | { kind: "allow"; status: BudgetStatus }
  | { kind: "block"; status: BudgetStatus; message: string }
  | { kind: "degrade"; status: BudgetStatus; fallback: ProviderCandidate };

/**
 * 每次模型调用前的判定。
 * 未超预算 → allow；超预算且可降级 → degrade；否则 block。
 */
export function budgetDecision(): BudgetDecision {
  const status = budgetStatus();
  if (!status.exceeded) return { kind: "allow", status };

  if (status.action === "degrade" && status.fallbackModelId && status.fallbackAvailable) {
    const model = modelRepo.find(status.fallbackModelId);
    if (model && model.enabled) {
      return { kind: "degrade", status, fallback: { provider: createProviderFromModel(model), model } };
    }
  }
  return { kind: "block", status, message: BUDGET_BLOCK_REPLY };
}
