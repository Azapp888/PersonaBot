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
import { listMemoryFiles, readMemoryFile, resetMemoryFile, setMemoryFileAppendEnabled, syncMemoryFiles, writeMemoryFile } from "../memory/service";
import { memoryFileRepo } from "../db/repos/memoryFiles";
import { analyzeImportedText, persistImported } from "../memory/importer";
import type { MemoryKind, MemoryType } from "../types";

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

  app.post("/api/memories/import", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { personaId?: string; userId?: string; filename?: string; content?: string } | undefined;
    if (!body?.personaId || !body?.userId || !body?.content?.trim()) {
      return reply.code(400).send({ error: "bad_request", message: "personaId / userId / content 必填" });
    }
    const persona = personaRepo.find(body.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    const filename = (body.filename ?? "memory.txt").slice(0, 120);
    const entries = await analyzeImportedText(persona, body.userId, filename, body.content);
    if (!entries.length) return { ok: false, created: 0, entries: [], message: "未解析出有效记忆" };
    const created = persistImported(persona.id, body.userId, entries);
    syncMemoryFiles(persona, body.userId);
    return { ok: true, created, entries };
  });

  app.put("/api/memories/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { content?: string; importance?: number; pinned?: boolean; kind?: MemoryKind } | undefined;
    if (body?.content === undefined && body?.importance === undefined && body?.pinned === undefined && body?.kind === undefined) {
      return reply.code(400).send({ error: "bad_request", message: "至少需要提供 content / importance / pinned / kind 之一" });
    }
    memoryRepo.updateMeta(id, {
      content: body?.content,
      importance: body?.importance,
      pinned: body?.pinned,
      kind: body?.kind,
    });
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
    const persona = personaRepo.find(personaId);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return listMemoryFiles(persona, userId);
  });

  app.get("/api/memories/file", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId, userId, name } = request.query as { personaId?: string; userId?: string; name?: string };
    if (!personaId || !userId || !name) return reply.code(400).send({ error: "bad_request" });
    const content = readMemoryFile(personaId, userId, name);
    if (content === null) return reply.code(404).send({ error: "not_found" });
    const override = memoryFileRepo.find(personaId, userId, name);
    return {
      name,
      content,
      userEdited: override?.userEdited ?? false,
      appendEnabled: override?.appendEnabled ?? false,
    };
  });

  app.put("/api/memories/file", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { personaId?: string; userId?: string; name?: string; content?: string } | undefined;
    if (!body?.personaId || !body?.userId || !body?.name || body?.content === undefined) {
      return reply.code(400).send({ error: "bad_request", message: "personaId / userId / name / content 必填" });
    }
    const persona = personaRepo.find(body.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    if (!/^[a-zA-Z0-9_.-]+$/.test(body.name) || body.name.includes("..")) {
      return reply.code(400).send({ error: "bad_request", message: "非法的文件名" });
    }
    writeMemoryFile(persona, body.userId, body.name, body.content);
    return { ok: true, name: body.name, userEdited: true };
  });

  app.post("/api/memories/file/reset", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { personaId?: string; userId?: string; name?: string } | undefined;
    if (!body?.personaId || !body?.userId || !body?.name) {
      return reply.code(400).send({ error: "bad_request", message: "personaId / userId / name 必填" });
    }
    const persona = personaRepo.find(body.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    if (!/^[a-zA-Z0-9_.-]+$/.test(body.name) || body.name.includes("..")) {
      return reply.code(400).send({ error: "bad_request", message: "非法的文件名" });
    }
    const content = resetMemoryFile(persona, body.userId, body.name);
    return { ok: true, name: body.name, content, userEdited: false };
  });

  // 设置某个记忆文件是否允许 AI 自动追加（需全局开关同时开启）
  app.put("/api/memories/file/append", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as { personaId?: string; userId?: string; name?: string; enabled?: boolean } | undefined;
    if (!body?.personaId || !body?.userId || !body?.name) {
      return reply.code(400).send({ error: "bad_request", message: "personaId / userId / name 必填" });
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(body.name) || body.name.includes("..")) {
      return reply.code(400).send({ error: "bad_request", message: "非法的文件名" });
    }
    const persona = personaRepo.find(body.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    setMemoryFileAppendEnabled(body.personaId, body.userId, body.name, body.enabled === true);
    return { ok: true, name: body.name, appendEnabled: body.enabled === true };
  });
}
