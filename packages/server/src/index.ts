import { config, ensureRuntimeDirs } from "./config";
import { getDb, closeDb } from "./db";
import { runMigrations } from "./db/migrate";
import { seed } from "./db/seed";
import { buildApp } from "./app";
import { botManager } from "./qq/manager";
import { messagePipeline } from "./pipeline/message-pipeline";
import { startScheduler, stopScheduler } from "./cron/scheduler";
import { logger } from "./logger";

async function main(): Promise<void> {
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
}

main().catch((err) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
