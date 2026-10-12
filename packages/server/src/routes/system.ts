import type { FastifyInstance } from "fastify";
import { runProactiveCycle, runDailyGreetings } from "../proactive/service";
import { refreshExpiringTokens } from "../qq/token";
import { botManager } from "../qq/manager";
import { messagePipeline } from "../pipeline/message-pipeline";
import { logger } from "../logger";
import { systemClock } from "../utils/clock";
import { settingsService } from "../settings/service";
import { checkUpdate, applyUpdate, updateRepoRoot } from "../updater/service";

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system/time", { preHandler: [app.authenticate] }, async (request) => {
    const { tz } = request.query as { tz?: string };
    return systemClock.snapshot(tz || settingsService.get().timezone);
  });

  app.post("/api/system/proactive/run", { preHandler: [app.authenticate] }, async () => {
    const result = await runProactiveCycle(true);
    return { ok: true, ...result };
  });

  app.post("/api/system/daily/run", { preHandler: [app.authenticate] }, async () => {
    const result = await runDailyGreetings(true);
    return { ok: true, ...result };
  });

  app.post("/api/system/tokens/refresh", { preHandler: [app.authenticate] }, async () => {
    await refreshExpiringTokens();
    return { ok: true };
  });

  app.post("/api/system/bots/reload", { preHandler: [app.authenticate] }, async () => {
    await botManager.reload();
    return { ok: true, statuses: botManager.getStatuses() };
  });

  app.get("/api/system/pipeline", { preHandler: [app.authenticate] }, async () => {
    return { activeBatches: messagePipeline.activeCount() };
  });

  app.get("/api/system/update/check", { preHandler: [app.authenticate] }, async () => {
    return checkUpdate();
  });

  app.post("/api/system/update/apply", { preHandler: [app.authenticate] }, async () => {
    const result = await applyUpdate();
    return result;
  });

  app.get("/api/system/update/version", { preHandler: [app.authenticate] }, async () => {
    return {
      repoRoot: updateRepoRoot(),
      nodeVersion: process.version,
      version: process.env.npm_package_version ?? null,
    };
  });

  app.get("/api/health", async () => {
    logger.debug("health check");
    return { ok: true, ts: Date.now() };
  });
}
