import type { FastifyInstance } from "fastify";
import { apiKeyRepo } from "../db/repos/api-keys";
import { appUserRepo } from "../db/repos/app-users";
import { personaRepo } from "../db/repos/personas";

/**
 * 开放 API 的管理端接口：签发 / 停用密钥，以及维护外部用户。
 *
 * 设计要点：
 * - 密钥明文只在创建响应中出现一次，之后只保存 sha256；
 * - 密钥必须绑定一个已存在角色与一个用户标识（app_users.externalId）；
 * - 用户标识（externalId）就是会话 / 记忆系统里的 userId，天然按用户隔离。
 */
export async function openApiAdminRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate] };

  // ---- 用户管理 ----

  app.get("/api/app-users", auth, async () => {
    const users = appUserRepo.list();
    const keys = apiKeyRepo.list();
    return users.map((user) => {
      const bound = keys.filter((k) => k.userId === user.externalId);
      return {
        ...user,
        keyCount: bound.length,
        activeKeyCount: bound.filter((k) => k.enabled).length,
      };
    });
  });

  app.post("/api/app-users", auth, async (request, reply) => {
    const body = request.body as { externalId?: string; displayName?: string; note?: string; enabled?: boolean } | undefined;
    const externalId = body?.externalId?.trim();
    if (!externalId) return reply.code(400).send({ error: "bad_request", message: "externalId 必填" });
    if (!/^[\w.:@-]{1,128}$/.test(externalId)) {
      return reply.code(400).send({ error: "bad_request", message: "externalId 只能包含字母、数字、_ . : @ -，长度 1-128" });
    }
    if (appUserRepo.findByExternalId(externalId)) {
      return reply.code(409).send({ error: "conflict", message: "该用户标识已存在" });
    }
    const user = appUserRepo.create({
      externalId,
      displayName: body?.displayName?.trim() || externalId,
      note: body?.note ?? "",
      enabled: body?.enabled !== false,
    });
    return user;
  });

  app.put("/api/app-users/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!appUserRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    const body = request.body as { displayName?: string; note?: string; enabled?: boolean } | undefined;
    if (body?.displayName === undefined && body?.note === undefined && body?.enabled === undefined) {
      return reply.code(400).send({ error: "bad_request", message: "至少需要提供 displayName / note / enabled 之一" });
    }
    return appUserRepo.update(id, {
      displayName: body?.displayName,
      note: body?.note,
      enabled: body?.enabled,
    });
  });

  app.delete("/api/app-users/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = appUserRepo.find(id);
    if (!user) return reply.code(404).send({ error: "not_found" });
    const bound = apiKeyRepo.list().filter((k) => k.userId === user.externalId);
    if (bound.length) {
      return reply.code(409).send({
        error: "conflict",
        message: `该用户仍绑定 ${bound.length} 个 API Key，请先删除或改绑密钥`,
      });
    }
    appUserRepo.remove(id);
    return { ok: true };
  });

  // ---- API 密钥管理 ----

  app.get("/api/api-keys", auth, async () => {
    const personas = new Map(personaRepo.list().map((p) => [p.id, p.name]));
    const users = new Map(appUserRepo.list().map((u) => [u.externalId, u.displayName]));
    return apiKeyRepo.list().map((key) => ({
      ...key,
      personaName: personas.get(key.personaId) ?? key.personaId,
      userDisplayName: users.get(key.userId) ?? key.userId,
    }));
  });

  app.post("/api/api-keys", auth, async (request, reply) => {
    const body = request.body as
      | { name?: string; personaId?: string; userId?: string; enabled?: boolean }
      | undefined;
    const name = body?.name?.trim();
    const personaId = body?.personaId?.trim();
    const userId = body?.userId?.trim();
    if (!name || !personaId || !userId) {
      return reply.code(400).send({ error: "bad_request", message: "name / personaId / userId 必填" });
    }
    if (!personaRepo.find(personaId)) {
      return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    }
    if (!appUserRepo.findByExternalId(userId)) {
      return reply.code(400).send({ error: "bad_request", message: "用户不存在，请先在用户管理中创建" });
    }
    const created = apiKeyRepo.create({ name, personaId, userId, enabled: body?.enabled !== false });
    return {
      key: created.key,
      // 明文只在这里返回一次，前端应提示用户立即保存
      plaintext: created.plaintext,
    };
  });

  app.put("/api/api-keys/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!apiKeyRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    const body = request.body as
      | { name?: string; personaId?: string; userId?: string; enabled?: boolean }
      | undefined;
    if (body?.personaId && !personaRepo.find(body.personaId)) {
      return reply.code(404).send({ error: "not_found", message: "角色不存在" });
    }
    if (body?.userId && !appUserRepo.findByExternalId(body.userId)) {
      return reply.code(400).send({ error: "bad_request", message: "用户不存在" });
    }
    return apiKeyRepo.update(id, {
      name: body?.name,
      personaId: body?.personaId,
      userId: body?.userId,
      enabled: body?.enabled,
    });
  });

  app.delete("/api/api-keys/:id", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!apiKeyRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    apiKeyRepo.remove(id);
    return { ok: true };
  });
}
