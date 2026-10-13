import type { FastifyInstance } from "fastify";
import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { modelRepo } from "../db/repos/models";
import { botManager } from "../qq/manager";
import { invalidateToken } from "../qq/token";
import type { Bot } from "../types";

function present(bot: Bot) {
  const model = bot.modelId ? modelRepo.find(bot.modelId) : null;
  return {
    id: bot.id,
    name: bot.name,
    appId: bot.appId,
    personaId: bot.personaId,
    personaName: bot.personaId ? personaRepo.find(bot.personaId)?.name ?? null : null,
    modelId: bot.modelId,
    modelName: model ? `${model.name}（${model.provider}/${model.modelId}）` : null,
    enabled: bot.enabled,
    agentEnabled: bot.agentEnabled,
    clientSecretSet: !!bot.clientSecret,
    tokenExpiresAt: bot.tokenExpiresAt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/bots", { preHandler: [app.authenticate] }, async () => {
    return botRepo.list().map(present);
  });

  app.get("/api/bots/status", { preHandler: [app.authenticate] }, async () => {
    const statuses = new Map(botManager.getStatuses().map((s) => [s.botId, s]));
    return botRepo.list().map((bot) => {
      const status = statuses.get(bot.id);
      return {
        ...present(bot),
        gatewayState: status?.state ?? (bot.enabled ? "stopped" : "stopped"),
        lastError: status?.lastError ?? null,
        connectedAt: status?.connectedAt ?? null,
      };
    });
  });

  app.post("/api/bots", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.name || !body?.appId || !body?.clientSecret) {
      return reply.code(400).send({ error: "bad_request", message: "name/appId/clientSecret 必填" });
    }
    const bot = botRepo.create({
      name: body.name,
      appId: body.appId,
      clientSecret: body.clientSecret,
      personaId: body.personaId ?? null,
      modelId: body.modelId ?? null,
      enabled: body.enabled !== false,
      agentEnabled: body.agentEnabled === true,
    });
    if (bot.enabled) await botManager.startBot(bot);
    return present(bot);
  });

  app.put("/api/bots/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const existing = botRepo.find(id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const bot = botRepo.update(id, {
      name: body.name,
      appId: body.appId,
      clientSecret: body.clientSecret || undefined,
      personaId: body.personaId,
      modelId: body.modelId,
      enabled: body.enabled,
      agentEnabled: body.agentEnabled,
    });
    const fresh = botRepo.find(id)!;
    if (body.clientSecret) invalidateToken(id);
    await botManager.restartBot(fresh);
    return present(fresh);
  });

  app.post("/api/bots/:id/toggle", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bot = botRepo.find(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    const updated = botRepo.update(id, { enabled: !bot.enabled })!;
    await botManager.restartBot(updated);
    return present(updated);
  });

  app.post("/api/bots/:id/restart", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const bot = botRepo.find(id);
    if (!bot) return reply.code(404).send({ error: "not_found" });
    invalidateToken(id);
    await botManager.restartBot(bot);
    return { ok: true };
  });

  app.delete("/api/bots/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    botManager.stopBot(id);
    invalidateToken(id);
    botRepo.remove(id);
    return { ok: true };
  });
}
