import { logger } from "./logger";
import { systemLogRepo, type SystemLogCategory, type SystemLogLevel } from "./db/repos/system-logs";

/**
 * 运行日志统一入口：同时写入 SQLite（供页面查询/导出）与 pino（供文件日志）。
 *
 * 约定：
 * - DB 侧用于「结构化、可筛选、可导出」，因此 detail 允许较大（repo 内截断到 20KB）；
 * - 出错时务必带上 stage 与 detail，把「为什么失败」写清楚；
 * - 任何写入失败都不能影响主流程（repo 内已 try/catch）。
 */
export interface LogContext {
  personaId?: string | null;
  botId?: string | null;
  userId?: string | null;
  modelId?: string | null;
  provider?: string | null;
  stage?: string | null;
  durationMs?: number | null;
}

function emit(
  level: SystemLogLevel,
  category: SystemLogCategory,
  message: string,
  ctx: LogContext = {},
  detail?: unknown,
): void {
  systemLogRepo.write({ level, category, message, detail, ...ctx });
  const bindings = {
    category,
    stage: ctx.stage,
    personaId: ctx.personaId,
    botId: ctx.botId,
    userId: ctx.userId,
    modelId: ctx.modelId,
    provider: ctx.provider,
    durationMs: ctx.durationMs,
    ...(detail !== undefined ? { detail } : {}),
  };
  if (level === "error") logger.error(bindings, message);
  else if (level === "warn") logger.warn(bindings, message);
  else if (level === "debug") logger.debug(bindings, message);
  else logger.info(bindings, message);
}

export const sysLog = {
  debug: (category: SystemLogCategory, message: string, ctx?: LogContext, detail?: unknown) =>
    emit("debug", category, message, ctx, detail),
  info: (category: SystemLogCategory, message: string, ctx?: LogContext, detail?: unknown) =>
    emit("info", category, message, ctx, detail),
  warn: (category: SystemLogCategory, message: string, ctx?: LogContext, detail?: unknown) =>
    emit("warn", category, message, ctx, detail),
  error: (category: SystemLogCategory, message: string, ctx?: LogContext, detail?: unknown) =>
    emit("error", category, message, ctx, detail),
};
