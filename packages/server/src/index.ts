import { config, ensureRuntimeDirs, securityIssues } from "./config";
import { getDb, closeDb } from "./db";
import { runMigrations } from "./db/migrate";
import { seed } from "./db/seed";
import { scrubPersonaRoleLayers } from "./persona/scrub";
import { buildApp } from "./app";
import { botManager } from "./qq/manager";
import { messagePipeline } from "./pipeline/message-pipeline";
import { startScheduler, stopScheduler } from "./cron/scheduler";
import { settingsService } from "./settings/service";
import { resolveIanaTimezone } from "./utils/clock";
import { scanModelsVision } from "./llm/vision-scan";
import { logger } from "./logger";

async function main(): Promise<void> {
  const issues = securityIssues();
  if (issues.length) {
    for (const issue of issues) logger.warn({ issue }, "security configuration warning");
    if (config.isProd) {
      logger.fatal({ issues }, "生产环境检测到不安全的默认密钥，拒绝启动。请修改 .env 后重试。");
      process.exit(1);
    }
    logger.warn("当前为开发环境，检测到不安全的默认密钥，仅建议尽快修改。");
  }

  ensureRuntimeDirs();
  const db = getDb();
  runMigrations(db);
  await seed();

  // 清洗历史 system_prompt 中写死的「只对某用户有效」补丁句与用户名，
  // 这些内容必须迁移到 user_identities 用户层，不能留在角色层影响其他用户。
  scrubPersonaRoleLayers();

  // 统一进程时区为用户配置（默认 Asia/Shanghai），保证日切、cron、日期格式化一致。
  // 必须解析成真实 IANA 名：别名 "server"/"system" 直接赋给 process.env.TZ 会无效或出错。
  const timezone = resolveIanaTimezone(settingsService.get().timezone);
  if (timezone) process.env.TZ = timezone;

  botManager.setHandler((bot, event) => messagePipeline.handle(bot, event));

  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port }, "PersonaBot server started");

  await botManager.startAll();
  startScheduler();

  // 上线/部署后自动检测所有模型的读图能力，结果写回 models.supports_vision。
  // 后台异步执行，不阻塞启动；命名可判定的模型不消耗网络请求，无法判定的才实测。
  void scanModelsVision().catch((err) =>
    logger.warn({ err: (err as Error).message }, "startup vision scan failed"),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    stopScheduler();
    botManager.stopAll();
    await app.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // 兜底：未捕获异常 / 未处理的 Promise 拒绝不应让进程静默退出或崩溃在未知状态
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason: reason instanceof Error ? reason.message : String(reason) }, "unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
  });
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
