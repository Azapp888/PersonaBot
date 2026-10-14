import type { FastifyInstance } from "fastify";
import { modelRepo } from "../db/repos/models";
import { createProviderFromModel } from "../llm/factory";
import { discoverModels } from "../llm/discover";
import { scanModelsVision } from "../llm/vision-scan";
import { classify, normalizeBase, type ProviderGroupView } from "../llm/provider-classify";
import { catalogModelCount, catalogReady, loadCatalog } from "../llm/models-dev";
import type { ModelRecord } from "../types";

function present(model: ModelRecord) {
  const group = classify(model);
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    apiBase: model.apiBase,
    modelId: model.modelId,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    enabled: model.enabled,
    supportsVision: model.supportsVision,
    apiKeySet: !!model.apiKey,
    // 按「提供商地址」归类的派生信息，供前端分组与展示
    providerKey: group.key,
    providerLabel: group.label,
    providerAddr: group.addr,
    providerKnown: group.known,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

/** 按归一化 apiBase 把模型聚成「提供商地址分组」，密钥数按不同 apiKey 存活性去重。 */
function buildProviderGroups(models: ModelRecord[]): ProviderGroupView[] {
  const map = new Map<string, ProviderGroupView & { keySet: Set<string> }>();
  for (const m of models) {
    const g = classify(m);
    let entry = map.get(g.key);
    if (!entry) {
      entry = {
        key: g.key,
        label: g.label,
        addr: g.addr,
        vendor: g.vendor,
        known: g.known,
        models: 0,
        credentials: 0,
        visionModels: 0,
        keySet: new Set<string>(),
      };
      map.set(g.key, entry);
    }
    entry.models += 1;
    if (m.supportsVision) entry.visionModels += 1;
    // 以「密文指纹」去重：同一密钥多处存储只算一个凭据，不同密钥分别计入
    if (m.apiKey) entry.keySet.add(m.apiKey);
  }
  return Array.from(map.values())
    .map(({ keySet, ...rest }) => ({ ...rest, credentials: keySet.size }))
    .sort((a, b) => b.models - a.models || a.label.localeCompare(b.label));
}

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/models", { preHandler: [app.authenticate] }, async () => modelRepo.list().map(present));

  // 按「提供商地址（apiBase）」归类的分组概览：同地址同组，密钥数分列。
  app.get("/api/models/providers", { preHandler: [app.authenticate] }, async () => {
    const models = modelRepo.list();
    return { groups: buildProviderGroups(models), total: models.length };
  });

  // 元数据状态：models.dev 目录是否已加载、收录模型数（用于前端提示判定来源）。
  app.get("/api/models/metadata-status", { preHandler: [app.authenticate] }, async () => ({
    ready: catalogReady(),
    models: catalogModelCount(),
    source: "models.dev",
  }));

  // 手动刷新 models.dev 元数据目录。
  app.post("/api/models/metadata-refresh", { preHandler: [app.authenticate] }, async () => {
    await loadCatalog(true);
    return { ok: true, ready: catalogReady(), models: catalogModelCount() };
  });

  // 手动触发读图能力扫描：检测所有（或指定）模型的视觉支持并写回。
  app.post("/api/models/vision-scan", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    try {
      const summary = await scanModelsVision({
        onlyEnabled: body.onlyEnabled !== false,
        probe: body.probe !== false,
        persist: body.persist !== false,
      });
      return { ok: true, ...summary };
    } catch (err) {
      return reply.code(500).send({ ok: false, error: "vision_scan_failed", message: (err as Error).message });
    }
  });

  // 检测上游提供方的可用模型：优先用表单中刚输入的 apiKey / apiBase，
  // 未填 apiKey 时先按「同一 apiBase 地址」复用密钥，再回退到同 provider 已保存的配置。
  app.post("/api/models/discover", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = request.body as any;
    if (!body?.provider) {
      return reply.code(400).send({ error: "bad_request", message: "provider 必填" });
    }
    const apiBase = body.apiBase || modelRepo.findProviderApiBase(body.provider) || null;
    const apiKey =
      body.apiKey ||
      (apiBase ? modelRepo.findKeyByBase(apiBase) : null) ||
      modelRepo.findProviderKey(body.provider) ||
      "";
    try {
      const models = await discoverModels({ provider: body.provider, apiKey, apiBase });
      return { ok: true, models, reusedKey: !!apiKey && !body.apiKey };
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
    // 同一「提供商地址」的密钥/地址一致：表单未填时，优先按 apiBase 复用，再回退同 provider
    const providerApiBase = body.apiBase || modelRepo.findProviderApiBase(body.provider) || null;
    const providerKey =
      body.apiKey ||
      (providerApiBase ? modelRepo.findKeyByBase(providerApiBase) : null) ||
      modelRepo.findProviderKey(body.provider) ||
      null;
    // 分组键：优先按归一化 apiBase 去重，缺地址时回退到 provider
    const groupKey = providerApiBase ? `addr:${normalizeBase(providerApiBase)}` : `provider:${body.provider}`;
    const existingKeys = new Set(
      modelRepo
        .list()
        .filter((m) => (providerApiBase ? `addr:${normalizeBase(m.apiBase)}` === groupKey : m.provider === body.provider))
        .map((m) => m.modelId),
    );
    for (const item of items) {
      const modelId = typeof item === "string" ? item : item?.modelId;
      if (!modelId) continue;
      const name = (typeof item === "object" && item?.name) || modelId;
      if (existingKeys.has(modelId)) {
        skipped.push(modelId);
        continue;
      }
      existingKeys.add(modelId);
      created.push(
        present(
          modelRepo.create({
            name,
            provider: body.provider,
            modelId,
            apiKey: providerKey,
            apiBase: providerApiBase,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            enabled: body.enabled !== false,
            supportsVision: body.supportsVision === true,
          }),
        ),
      );
    }
    return { ok: true, created, skipped, reusedKey: !!providerKey && !body.apiKey };
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
