import type { FastifyInstance } from "fastify";
import { personaRepo } from "../db/repos/personas";
import { messagePipeline } from "../pipeline/message-pipeline";
import { buildStablePrefix } from "../persona/prompt";

export async function personaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/personas", { preHandler: [app.authenticate] }, async () => personaRepo.list());

  app.get("/api/personas/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return persona;
  });

  app.get("/api/personas/:id/prefix", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return { prefix: buildStablePrefix(persona) };
  });

  app.post("/api/personas", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.name) return reply.code(400).send({ error: "bad_request", message: "name 必填" });
    const persona = personaRepo.create(body);
    return persona;
  });

  app.put("/api/personas/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const persona = personaRepo.update(id, body);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return persona;
  });

  app.delete("/api/personas/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    personaRepo.remove(id);
    return { ok: true };
  });

  // 本地模拟对话：不需要 QQ 凭据即可调试角色人格与记忆注入
  app.post("/api/personas/:id/simulate", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { userId?: string; message?: string } | undefined;
    if (!body?.message) return reply.code(400).send({ error: "bad_request", message: "message 必填" });
    try {
      const result = await messagePipeline.simulate(id, body.userId || "sim-user", body.message);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: "simulate_failed", message: (err as Error).message });
    }
  });
}
