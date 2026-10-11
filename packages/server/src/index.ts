import { config, ensureRuntimeDirs, securityIssues } from "./config";
import { getDb, closeDb } from "./db";
import { runMigrations } from "./db/migrate";
import { seed } from "./db/seed";
import { buildApp } from "./app";
import { botManager } from "./qq/manager";
import { messagePipeline } from "./pipeline/message-pipeline";
import { startScheduler, stopScheduler } from "./cron/scheduler";
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

  botManager.setHandler((bot, event) => messagePipeline.handle(bot, event));

  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
  logger.info({ host: config.host, port: config.port }, "PersonaBot server started");

  await botManager.startAll();
  startScheduler();

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
