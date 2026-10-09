import type { FastifyInstance } from "fastify";
import { statsService } from "../stats/service";

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/stats/dashboard", { preHandler: [app.authenticate] }, async () => statsService.dashboard());

  app.get("/api/stats/trends", { preHandler: [app.authenticate] }, async (request) => {
    const { days } = request.query as { days?: string };
    return statsService.trends(days ? Number(days) : 14);
  });

  app.get("/api/stats/persona/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    const { days } = request.query as { days?: string };
    return statsService.perPersonaTrends(id, days ? Number(days) : 14);
  });

  app.get("/api/stats/messages", { preHandler: [app.authenticate] }, async (request) => {
    const { limit } = request.query as { limit?: string };
    return statsService.recentMessages(limit ? Number(limit) : 50);
  });
}
