import type { FastifyInstance } from "fastify";
import { personaRepo } from "../db/repos/personas";
import { conversationRepo } from "../db/repos/conversations";
import { appUserRepo } from "../db/repos/app-users";
import { apiKeyRepo } from "../db/repos/api-keys";
import { generateReply } from "../pipeline/message-pipeline";
import { logger } from "../logger";

/**
 * 开放 API（/api/v1/*）：给外部应用调用的稳定接口。
 *
 * 鉴权统一走 app.apiKeyAuth：API Key 绑定「一个角色 + 一个用户」，
 * 因此调用方无需（也不能）指定身份，会话与记忆自动按绑定的用户隔离。
 */
export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.apiKeyAuth] };

  /** 当前密钥的绑定信息，便于接入方自检配置。 */
  app.get("/api/v1/me", auth, async (request) => {
    const client = request.apiClient!;
    const persona = personaRepo.find(client.personaId);
    const user = appUserRepo.findByExternalId(client.userId);
    return {
      keyName: client.keyName,
      persona: persona ? { id: persona.id, name: persona.name } : null,
      user: {
        id: client.userId,
        displayName: user?.displayName ?? "",
        enabled: user?.enabled ?? true,
      },
    };
  });

  /** 绑定角色的公开信息（名称与简介，不含提示词等内部配置）。 */
  app.get("/api/v1/persona", auth, async (request, reply) => {
    const persona = personaRepo.find(request.apiClient!.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "绑定的角色不存在" });
    return {
      id: persona.id,
      name: persona.name,
      description: persona.description ?? "",
    };
  });

  /** 一次性对话：返回完整回复。 */
  app.post("/api/v1/chat", auth, async (request, reply) => {
    const client = request.apiClient!;
    const body = request.body as { message?: string } | undefined;
    const message = body?.message?.trim();
    if (!message) {
      return reply.code(400).send({ error: "bad_request", message: "message 必填" });
    }
    if (message.length > 4000) {
      return reply.code(400).send({ error: "bad_request", message: "message 过长（上限 4000 字符）" });
    }

    const persona = personaRepo.find(client.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "绑定的角色不存在" });

    try {
      const result = await generateReply(persona, client.userId, message);
      apiKeyRepo.touch(client.keyId);
      return {
        reply: result.reply,
        modelId: result.modelId,
        usage: result.usage,
      };
    } catch (err) {
      logger.error(
        { err: (err as Error).message, keyId: client.keyId, personaId: client.personaId },
        "open api chat failed",
      );
      return reply.code(502).send({ error: "upstream_error", message: "生成回复失败，请稍后重试" });
    }
  });

  /** 流式对话（SSE）：逐块下发 delta，最后以 done 事件结束。 */
  app.post("/api/v1/chat/stream", auth, async (request, reply) => {
    const client = request.apiClient!;
    const body = request.body as { message?: string } | undefined;
    const message = body?.message?.trim();
    if (!message) {
      return reply.code(400).send({ error: "bad_request", message: "message 必填" });
    }
    const persona = personaRepo.find(client.personaId);
    if (!persona) return reply.code(404).send({ error: "not_found", message: "绑定的角色不存在" });

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 客户端断开时中止在途生成，避免继续消耗 token
    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());

    try {
      const result = await generateReply(persona, client.userId, message, undefined, {
        signal: controller.signal,
        onEvent: (event) => send(event),
      });
      apiKeyRepo.touch(client.keyId);
      send({ type: "usage", usage: result.usage, modelId: result.modelId });
    } catch (err) {
      send({ type: "error", message: (err as Error).message });
    } finally {
      reply.raw.end();
    }
    return reply;
  });

  /** 读取当前绑定用户的会话历史（最近 limit 条，默认 20）。 */
  app.get("/api/v1/conversation", auth, async (request) => {
    const client = request.apiClient!;
    const { limit } = request.query as { limit?: string };
    const conv = conversationRepo.find(client.personaId, client.userId);
    const messages = conv?.messages ?? [];
    const n = Math.max(1, Math.min(200, Number(limit) || 20));
    return { total: messages.length, messages: messages.slice(-n) };
  });

  /** 清空当前绑定用户的会话原文（记忆不受影响）。 */
  app.post("/api/v1/conversation/reset", auth, async (request) => {
    const client = request.apiClient!;
    conversationRepo.clear(client.personaId, client.userId);
    return { ok: true };
  });
}
