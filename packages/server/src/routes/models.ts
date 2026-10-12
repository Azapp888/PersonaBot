import type { FastifyInstance } from "fastify";
import { modelRepo } from "../db/repos/models";
import { createProviderFromModel } from "../llm/factory";
import { discoverModels } from "../llm/discover";
import type { ModelRecord } from "../types";

function present(model: ModelRecord) {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    apiBase: model.apiBase,
    modelId: model.modelId,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    enabled: model.enabled,
    apiKeySet: !!model.apiKey,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/models", { preHandler: [app.authenticate] }, async () => modelRepo.list().map(present));

  // 检测上游提供方的可用模型：使用表单中刚输入的 apiKey / apiBase。
  app.post("/api/models/discover", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.provider) {
      return reply.code(400).send({ error: "bad_request", message: "provider 必填" });
    }
    try {
      const models = await discoverModels({
        provider: body.provider,
        apiKey: body.apiKey ?? "",
        apiBase: body.apiBase ?? null,
      });
      return { ok: true, models };
    } catch (err) {
      const status = (err as any)?.status && (err as any).status >= 400 ? (err as any).status : 400;
      return reply.code(status).send({ ok: false, error: "discover_failed", message: (err as Error).message });
    }
  });

  // 编辑场景检测：apiKey 留空时复用该模型已存储的密钥。
  app.post("/api/models/:id/discover", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = modelRepo.find(id);
    if (!model) return reply.code(404).send({ error: "not_found" });
    const body = (request.body ?? {}) as any;
    try {
      const models = await discoverModels({
        provider: body.provider ?? model.provider,
        apiKey: body.apiKey || modelRepo.decryptedKey(model),
        apiBase: body.apiBase ?? model.apiBase,
      });
      return { ok: true, models };
    } catch (err) {
      const status = (err as any)?.status && (err as any).status >= 400 ? (err as any).status : 400;
      return reply.code(status).send({ ok: false, error: "discover_failed", message: (err as Error).message });
    }
  });

  app.post("/api/models", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.name || !body?.provider || !body?.modelId) {
      return reply.code(400).send({ error: "bad_request", message: "name/provider/modelId 必填" });
    }
    return present(modelRepo.create(body));
  });

  // 批量创建：把检测到的多个模型一次性加入列表。
  app.post("/api/models/batch", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    const items: any[] = Array.isArray(body?.models) ? body.models : [];
    if (!body?.provider || items.length === 0) {
      return reply.code(400).send({ error: "bad_request", message: "provider 与 models 必填" });
    }
    const created: ReturnType<typeof present>[] = [];
    const skipped: string[] = [];
    for (const item of items) {
      const modelId = typeof item === "string" ? item : item?.modelId;
      if (!modelId) continue;
      const name = (typeof item === "object" && item?.name) || modelId;
      const existing = modelRepo.list().find((m) => m.provider === body.provider && m.modelId === modelId);
      if (existing) {
        skipped.push(modelId);
        continue;
      }
      created.push(
        present(
          modelRepo.create({
            name,
            provider: body.provider,
            modelId,
            apiKey: body.apiKey || null,
            apiBase: body.apiBase ?? null,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            enabled: body.enabled !== false,
          }),
        ),
      );
    }
    return { ok: true, created, skipped };
  });

  app.put("/api/models/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const model = modelRepo.update(id, {
      ...body,
      apiKey: body.apiKey || undefined,
    });
    if (!model) return reply.code(404).send({ error: "not_found" });
    return present(model);
  });

  app.delete("/api/models/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    modelRepo.remove(id);
    return { ok: true };
  });

  app.post("/api/models/:id/test", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = modelRepo.find(id);
    if (!model) return reply.code(404).send({ error: "not_found" });
    try {
      const provider = createProviderFromModel(model);
      const result = await provider.chat([
        { role: "system", content: "你是一个连通性测试助手。" },
        { role: "user", content: "请只回复两个字：正常" },
      ], { maxTokens: 16 });
      return { ok: true, reply: result.content, usage: result.usage };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: "test_failed", message: (err as Error).message });
    }
  });
}
