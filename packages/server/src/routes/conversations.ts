import type { FastifyInstance } from "fastify";
import { conversationRepo } from "../db/repos/conversations";
import { contextRepo } from "../db/repos/context";
import { logRepo } from "../db/repos/logs";
import { memoryRepo } from "../db/repos/memories";
import { personaRepo } from "../db/repos/personas";
import { contentToText } from "../llm/provider";
import { formatDate } from "../utils/id";
import type { ChatMessage } from "../types";

interface PairBody {
  personaId?: string;
  userId?: string;
  index?: number;
  purgeMemories?: boolean;
}

function messageText(message: ChatMessage): string {
  return typeof message.content === "string" ? message.content : contentToText(message.content);
}

/** 删除消息后让滚动摘要失效，避免下标错位。 */
function resetSummary(personaId: string, userId: string): void {
  const existing = contextRepo.find(personaId, userId);
  if (!existing || (!existing.summary && existing.summarizedUpto === 0)) return;
  contextRepo.upsert({
    personaId,
    userId,
    summary: "",
    summarizedUpto: 0,
    state: existing.state,
  });
}

/**
 * 把被删除的消息在 message_logs 中标记为无效，使后续日记忆/事实提炼不再吸收这些内容。
 * 同时可选清理受影响日期的已有记忆。
 */
function invalidateRemoved(
  personaId: string,
  userId: string,
  removed: ChatMessage[],
  purgeMemories: boolean,
): { invalidated: number; memoriesRemoved: number } {
  let invalidated = 0;
  const dates = new Set<string>();
  for (const message of removed) {
    const dir = message.role === "user" ? "in" : "out";
    const at = message.timestamp ?? Date.now();
    invalidated += logRepo.invalidateByContent(personaId, userId, dir, messageText(message), at);
    if (message.timestamp) dates.add(formatDate(new Date(message.timestamp)));
  }
  let memoriesRemoved = 0;
  if (purgeMemories) {
    for (const date of dates) memoriesRemoved += memoryRepo.removeByDate(personaId, userId, date);
  }
  return { invalidated, memoriesRemoved };
}

function parsePair(body: PairBody | undefined): { personaId: string; userId: string } | null {
  if (!body?.personaId || !body?.userId) return null;
  return { personaId: body.personaId, userId: body.userId };
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // 会话总览：用于管理端选择要清理的会话
  app.get("/api/conversations", { preHandler: [app.authenticate] }, async (request) => {
    const { personaId, userId } = request.query as { personaId?: string; userId?: string };
    const personaName = new Map(personaRepo.list().map((p) => [p.id, p.name]));
    const items = conversationRepo
      .listAll({ personaId: personaId || null, userId: userId || null })
      .map((conv) => {
        const last = conv.messages[conv.messages.length - 1];
        return {
          personaId: conv.personaId,
          personaName: personaName.get(conv.personaId) ?? conv.personaId,
          userId: conv.userId,
          messageCount: conv.messages.length,
          updatedAt: conv.updatedAt,
          lastMessage: last ? messageText(last).slice(0, 80) : "",
          lastRole: last?.role ?? null,
        };
      });
    return { items, total: items.length };
  });

  // 单个会话详情：带下标，便于精确删除
  app.get("/api/conversations/detail", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { personaId, userId } = request.query as { personaId?: string; userId?: string };
    if (!personaId || !userId) {
      return reply.code(400).send({ error: "bad_request", message: "personaId/userId 必填" });
    }
    const conv = conversationRepo.find(personaId, userId);
    const context = contextRepo.find(personaId, userId);
    return {
      personaId,
      userId,
      personaName: personaRepo.find(personaId)?.name ?? personaId,
      updatedAt: conv?.updatedAt ?? null,
      messages: (conv?.messages ?? []).map((message, index) => ({
        index,
        role: message.role,
        content: messageText(message),
        timestamp: message.timestamp ?? null,
      })),
      summary: context?.summary ?? "",
      summarizedUpto: context?.summarizedUpto ?? 0,
    };
  });

  // 删除单条消息
  app.delete("/api/conversations/message", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as PairBody | undefined;
    const pair = parsePair(body);
    if (!pair || body?.index == null) {
      return reply.code(400).send({ error: "bad_request", message: "personaId/userId/index 必填" });
    }
    const removed = conversationRepo.deleteAt(pair.personaId, pair.userId, body.index);
    if (!removed) return reply.code(404).send({ error: "not_found", message: "消息不存在" });
    const result = invalidateRemoved(pair.personaId, pair.userId, [removed], body.purgeMemories === true);
    resetSummary(pair.personaId, pair.userId);
    return { ok: true, removed: 1, ...result };
  });

  // 从指定下标起清空后续消息
  app.delete("/api/conversations/from", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as PairBody | undefined;
    const pair = parsePair(body);
    if (!pair || body?.index == null) {
      return reply.code(400).send({ error: "bad_request", message: "personaId/userId/index 必填" });
    }
    const removed = conversationRepo.deleteFrom(pair.personaId, pair.userId, body.index);
    const result = invalidateRemoved(pair.personaId, pair.userId, removed, body.purgeMemories === true);
    resetSummary(pair.personaId, pair.userId);
    return { ok: true, removed: removed.length, ...result };
  });

  // 重置上下文：清空会话原文、滚动摘要与状态机，并把该会话全部流水标记为无效
  app.post("/api/conversations/reset", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as PairBody | undefined;
    const pair = parsePair(body);
    if (!pair) {
      return reply.code(400).send({ error: "bad_request", message: "personaId/userId 必填" });
    }
    const conv = conversationRepo.find(pair.personaId, pair.userId);
    const removed = conv?.messages ?? [];
    conversationRepo.clear(pair.personaId, pair.userId);
    contextRepo.remove(pair.personaId, pair.userId);
    const invalidated = logRepo.invalidateBetween(pair.personaId, pair.userId, 0, Date.now() + 1);
    let memoriesRemoved = 0;
    if (body?.purgeMemories === true) {
      for (const date of new Set(removed.filter((m) => m.timestamp).map((m) => formatDate(new Date(m.timestamp!))))) {
        memoriesRemoved += memoryRepo.removeByDate(pair.personaId, pair.userId, date);
      }
    }
    return { ok: true, removed: removed.length, invalidated, memoriesRemoved };
  });
}
