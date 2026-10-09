import type { FastifyInstance } from "fastify";
import { modelRepo } from "../db/repos/models";
import { createProviderFromModel } from "../llm/factory";
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

  app.post("/api/models", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.name || !body?.provider || !body?.modelId) {
      return reply.code(400).send({ error: "bad_request", message: "name/provider/modelId 必填" });
    }
    return present(modelRepo.create(body));
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
