import type { FastifyInstance } from "fastify";
import { runProactiveCycle } from "../proactive/service";
import { refreshExpiringTokens } from "../qq/token";
import { botManager } from "../qq/manager";
import { messagePipeline } from "../pipeline/message-pipeline";
import { logger } from "../logger";
import { systemClock } from "../utils/clock";

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/system/time", { preHandler: [app.authenticate] }, async () => {
    return systemClock.snapshot();
  });

  app.post("/api/system/proactive/run", { preHandler: [app.authenticate] }, async () => {
    const result = await runProactiveCycle(true);
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

  app.get("/api/health", async () => {
    logger.debug("health check");
    return { ok: true, ts: Date.now() };
  });
}
