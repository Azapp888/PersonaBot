import type { FastifyInstance } from "fastify";
import { skillRepo } from "../db/repos/skills";
import { syncSkillsFromGithub } from "../skills/manager";
import { newId } from "../utils/id";

export async function skillRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/skills", { preHandler: [app.authenticate] }, async () => skillRepo.list());

  app.post("/api/skills", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.name || !body?.content) {
      return reply.code(400).send({ error: "bad_request", message: "name/content 必填" });
    }
    return skillRepo.upsert({
      id: body.id || newId("skill_"),
      name: body.name,
      description: body.description ?? "",
      type: body.type ?? "custom",
      version: body.version ?? "1.0.0",
      source: body.source ?? null,
      content: body.content,
      enabled: body.enabled !== false,
    });
  });

  app.put("/api/skills/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = skillRepo.find(id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const body = request.body as any;
    return skillRepo.upsert({
      id,
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      type: existing.type,
      version: body.version ?? existing.version,
      source: existing.source,
      content: body.content ?? existing.content,
      enabled: body.enabled ?? existing.enabled,
    });
  });

  app.delete("/api/skills/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    skillRepo.remove(id);
    return { ok: true };
  });

  app.post("/api/skills/sync", { preHandler: [app.authenticate] }, async (request) => {
    const body = (request.body as { repoUrl?: string; token?: string } | undefined) ?? {};
    return syncSkillsFromGithub(body.repoUrl, body.token);
  });
}
