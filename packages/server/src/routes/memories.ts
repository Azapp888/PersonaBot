import type { FastifyInstance } from "fastify";
import { memoryRepo } from "../db/repos/memories";
import { conversationRepo } from "../db/repos/conversations";
import { personaRepo } from "../db/repos/personas";
import {
  generateBiweeklyMemory,
  generateDailyMemory,
  generateMonthlyMemory,
  generateThreeDayMemory,
} from "../memory/summarizer";
import { listMemoryFiles, readMemoryFile, syncMemoryFiles } from "../memory/service";
import type { MemoryType } from "../types";

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/memories", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId, userId } = request.query as { personaId?: string; userId?: string };
    if (!personaId) return reply.code(400).send({ error: "bad_request", message: "personaId 必填" });
    if (userId) return memoryRepo.listByUser(personaId, userId);
    return memoryRepo.listByPersona(personaId);
  });

  app.get("/api/memories/users", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId } = request.query as { personaId?: string };
    if (!personaId) return reply.code(400).send({ error: "bad_request", message: "personaId 必填" });
    const set = new Set<string>(memoryRepo.distinctUsers(personaId));
    for (const conv of conversationRepo.listByPersona(personaId)) set.add(conv.userId);
    return [...set];
  });

  app.post("/api/memories/trigger", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { personaId?: string; userId?: string; type?: MemoryType } | undefined;
    if (!body?.personaId || !body?.userId) {
      return reply.code(400).send({ error: "bad_request", message: "personaId/userId 必填" });
    }
    const persona = personaRepo.find(body.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    const type = body.type ?? "daily";
    let content: string | null = null;
    if (type === "daily") content = await generateDailyMemory(persona, body.userId);
    else if (type === "three_day") content = await generateThreeDayMemory(persona, body.userId);
    else if (type === "biweekly") content = await generateBiweeklyMemory(persona, body.userId);
    else content = await generateMonthlyMemory(persona, body.userId);
    syncMemoryFiles(persona, body.userId);
    if (content === null) return { ok: false, message: "没有可总结的聊天记录" };
    return { ok: true, type, content };
  });

  app.put("/api/memories/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: string } | undefined;
    if (!body?.content) return reply.code(400).send({ error: "bad_request", message: "content 必填" });
    memoryRepo.updateContent(id, body.content);
    return { ok: true };
  });

  app.delete("/api/memories/:id", { preHandler: [app.authenticate] }, async (request) => {
    const { id } = request.params as { id: string };
    memoryRepo.remove(id);
    return { ok: true };
  });

  app.get("/api/memories/files", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId, userId } = request.query as { personaId?: string; userId?: string };
    if (!personaId || !userId) return reply.code(400).send({ error: "bad_request" });
    return listMemoryFiles(personaId, userId);
  });

  app.get("/api/memories/file", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId, userId, name } = request.query as { personaId?: string; userId?: string; name?: string };
    if (!personaId || !userId || !name) return reply.code(400).send({ error: "bad_request" });
    const content = readMemoryFile(personaId, userId, name);
    if (content === null) return reply.code(404).send({ error: "not_found" });
    return { name, content };
  });
}
