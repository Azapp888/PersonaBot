import type { FastifyInstance } from "fastify";
import { personaRepo } from "../db/repos/personas";
import { userIdentityRepo } from "../db/repos/user-identities";
import { scheduleRepo } from "../db/repos/schedules";
import { messagePipeline } from "../pipeline/message-pipeline";
import type { StreamEvent } from "../pipeline/stream-events";
import { buildStablePrefix } from "../persona/prompt";
import { checkPersonaConsistency } from "../persona/consistency";
import { generateDailySchedule } from "../memory/schedule";
import { formatDate } from "../utils/id";
import type { ScheduleSegment } from "../types";

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

  // 人格一致性校验：静态检查设定是否自洽、信息是否完整
  app.get("/api/personas/:id/consistency", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return checkPersonaConsistency(persona);
  });

  // 读取角色某天日程（默认今天）
  app.get("/api/personas/:id/schedule", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { date } = request.query as { date?: string };
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    return scheduleRepo.find(id, date || formatDate()) ?? { personaId: id, date: date || formatDate(), segments: [], createdAt: 0 };
  });

  // 手动重新生成角色某天日程
  app.post("/api/personas/:id/schedule/generate", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { date?: string } | undefined;
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    const schedule = await generateDailySchedule(persona, body?.date || formatDate());
    if (!schedule) return reply.code(400).send({ error: "generate_failed", message: "日程生成失败，请检查模型配置" });
    return schedule;
  });

  // 手动编辑角色某天日程
  app.put("/api/personas/:id/schedule", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { date?: string; segments?: ScheduleSegment[] } | undefined;
    const persona = personaRepo.find(id);
    if (!persona) return reply.code(404).send({ error: "not_found" });
    if (!Array.isArray(body?.segments)) return reply.code(400).send({ error: "bad_request", message: "segments 必填" });
    const date = body?.date || formatDate();
    return scheduleRepo.upsert(id, date, body.segments);
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

  // 用户层身份：昵称/真名/关系/称呼权限/边界，按 (personaId, userId) 隔离。
  app.get("/api/personas/:id/users", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!personaRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    return userIdentityRepo.listByPersona(id);
  });

  app.get("/api/personas/:id/users/:userId/identity", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    if (!personaRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    return userIdentityRepo.find(id, userId) ?? null;
  });

  app.put("/api/personas/:id/users/:userId/identity", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    if (!personaRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    const body = request.body as Partial<{
      nickname: string;
      realName: string;
      relationship: string;
      addressPreference: string;
      boundaries: string;
    }> | undefined;
    if (!body) return reply.code(400).send({ error: "bad_request", message: "body 必填" });
    return userIdentityRepo.upsert({ personaId: id, userId, ...body });
  });

  app.delete("/api/personas/:id/users/:userId/identity", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string };
    if (!personaRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    userIdentityRepo.remove(id, userId);
    return { ok: true };
  });

  // 本地模拟（流式）：SSE 推送 delta / first-bubble / done / stop，前端可即时显示并感知中断。
  app.post("/api/personas/:id/simulate/stream", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { userId?: string; message?: string } | undefined;
    if (!body?.message) return reply.code(400).send({ error: "bad_request", message: "message 必填" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: StreamEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await messagePipeline.simulateStream(id, body.userId || "sim-user", body.message, send);
    } catch (err) {
      send({ type: "stop", reason: (err as Error).message });
    } finally {
      reply.raw.end();
    }
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
