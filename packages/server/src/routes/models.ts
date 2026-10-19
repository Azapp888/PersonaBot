import type { FastifyInstance } from "fastify";
import { modelRepo } from "../db/repos/models";
import { providerRepo } from "../db/repos/providers";
import { createProviderFromModel } from "../llm/factory";
import { discoverModels } from "../llm/discover";
import { scanModelsVision } from "../llm/vision-scan";
import { classify, type ProviderGroupView } from "../llm/provider-classify";
import { catalogModelCount, catalogReady, loadCatalog } from "../llm/models-dev";
import { sysLog } from "../logging";
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

/** 取出某个「提供商分组」下的全部模型（按归一化分组键匹配）。 */
function modelsInGroup(key: string): ModelRecord[] {
  return modelRepo.list().filter((m) => classify(m).key === key);
}

/**
 * 解析前端提交的「提供商定位信息」为分组键。
 * 优先用 groupKey（编辑既有分组时由列表下发），否则按 vendor+apiBase 重新归类。
 */
function resolveGroupKey(body: any): string | null {
  if (typeof body?.groupKey === "string" && body.groupKey) return body.groupKey;
  if (!body?.provider) return null;
  return classify({ provider: body.provider, apiBase: body.apiBase ?? null }).key;
}

/** 按归一化 apiBase 把模型聚成「提供商地址分组」，密钥数按不同 apiKey 存活性去重。 */
function buildProviderGroups(models: ModelRecord[]): ProviderGroupView[] {
  const map = new Map<string, ProviderGroupView & { keySet: Set<string>; providerId?: string; apiKeySet?: boolean }>();
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
  // 合并「提供商级配置」记录：即便该分组下暂无模型，也要展示出来。
  for (const p of providerRepo.list()) {
    const g = classify({ provider: p.name, apiBase: p.apiBase });
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
    entry.providerId = p.id;
    if (p.apiKey) {
      entry.keySet.add(p.apiKey);
      entry.apiKeySet = true;
    }
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

  // 新增提供商：以「提供商级配置（名称/Base/Key）」创建，允许暂不加入任何模型。
  app.post("/api/models/providers", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    if (!body?.provider) {
      return reply.code(400).send({ error: "bad_request", message: "provider 必填" });
    }
    const items: any[] = Array.isArray(body.models) ? body.models : [];
    const apiBase = body.apiBase || null;
    const apiKey = body.apiKey || null;
    // 先落一条「提供商级配置」记录，使其在无模型时也能展示与再编辑。
    const providerRec = providerRepo.create({ name: body.provider, apiBase, apiKey });
    const created: ReturnType<typeof present>[] = [];
    const skipped: string[] = [];
    const groupKey = classify({ provider: body.provider, apiBase }).key;
    const existingKeys = new Set(
      modelRepo
        .list()
        .filter((m) => classify(m).key === groupKey)
        .map((m) => m.modelId),
    );
    for (const item of items) {
      const modelId = typeof item === "string" ? item : item?.modelId;
      if (!modelId) continue;
      if (existingKeys.has(modelId)) {
        skipped.push(modelId);
        continue;
      }
      existingKeys.add(modelId);
      created.push(
        present(
          modelRepo.create({
            name: (typeof item === "object" && item?.name) || modelId,
            provider: body.provider,
            modelId,
            apiKey,
            apiBase,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            enabled: body.enabled !== false,
            supportsVision: (typeof item === "object" && item?.supportsVision === true) || body.supportsVision === true,
          }),
        ),
      );
    }
    return { ok: true, groupKey, providerId: providerRec.id, created, skipped };
  });

  // 更新提供商：把「名称 / Base / Key」级配置级联到分组下的全部模型，并支持增删模型。
  app.put("/api/models/providers", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const groupKey = resolveGroupKey(body);
    if (!groupKey) {
      return reply.code(400).send({ error: "bad_request", message: "provider 或 groupKey 必填" });
    }
    const members = modelsInGroup(groupKey);
    // 提供商级配置记录的定位：显式 id > 按当前名称查 > 按新名称查
    const existingProvider =
      (body.providerId ? providerRepo.find(body.providerId) : null) ??
      (members[0] ? providerRepo.findByName(members[0].provider) : null) ??
      providerRepo.findByName(body.provider ?? "");
    const provider = body.provider ?? existingProvider?.name ?? members[0]?.provider;
    const hasBaseField = Object.prototype.hasOwnProperty.call(body, "apiBase");
    const apiBase = hasBaseField
      ? (body.apiBase ?? null)
      : (existingProvider?.apiBase ?? members[0]?.apiBase ?? null);
    const hasKeyField = Object.prototype.hasOwnProperty.call(body, "apiKey");
    const apiKey: string | undefined = hasKeyField && body.apiKey ? String(body.apiKey) : undefined;
    // 同步提供商级配置记录（无记录则补建，保证「先建提供商」路径一致）
    let providerId = existingProvider?.id;
    if (provider) {
      if (existingProvider) {
        providerRepo.update(existingProvider.id, { name: provider, apiBase, apiKey });
      } else {
        providerId = providerRepo.create({ name: provider, apiBase, apiKey }).id;
      }
    }
    // 级联提供商级配置：名称 -> provider，地址 -> apiBase；密钥可选覆盖（留空表示沿用原值）
    const updated: ReturnType<typeof present>[] = [];
    for (const m of members) {
      const patch: any = {};
      if (provider && provider !== m.provider) patch.provider = provider;
      if (hasBaseField && apiBase !== m.apiBase) patch.apiBase = apiBase;
      if (apiKey) patch.apiKey = apiKey;
      updated.push(present(Object.keys(patch).length ? modelRepo.update(m.id, patch)! : m));
    }
    // 追加新增模型
    const added: ReturnType<typeof present>[] = [];
    const items: any[] = Array.isArray(body.addModels) ? body.addModels : [];
    const existingKeys = new Set(updated.map((m) => m.modelId));
    for (const item of items) {
      const modelId = typeof item === "string" ? item : item?.modelId;
      if (!modelId || existingKeys.has(modelId)) continue;
      existingKeys.add(modelId);
      added.push(
        present(
          modelRepo.create({
            name: (typeof item === "object" && item?.name) || modelId,
            provider: provider ?? "custom",
            modelId,
            apiKey:
              apiKey ??
              (body.providerId ? providerRepo.find(body.providerId) : null)?.apiKey ??
              (apiBase ? modelRepo.findKeyByBase(apiBase) : null) ??
              modelRepo.findProviderKey(provider ?? "") ??
              null,
            apiBase,
            temperature: body.temperature,
            maxTokens: body.maxTokens,
            enabled: true,
            supportsVision: (typeof item === "object" && item?.supportsVision === true) || body.supportsVision === true,
          }),
        ),
      );
    }
    // 删除指定模型
    const removeIds: string[] = Array.isArray(body.removeModelIds) ? body.removeModelIds : [];
    for (const id of removeIds) modelRepo.remove(id);
    return { ok: true, providerId, updated, added, removed: removeIds.length };
  });

  // 删除提供商：连同分组下的所有模型与提供商配置一并移除。
  app.delete("/api/models/providers", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const groupKey = resolveGroupKey(body);
    if (!groupKey) {
      return reply.code(400).send({ error: "bad_request", message: "provider 或 groupKey 必填" });
    }
    const members = modelsInGroup(groupKey);
    for (const m of members) modelRepo.remove(m.id);
    // 移除对应的提供商级配置记录（按 id 或名称）
    if (body.providerId) providerRepo.remove(body.providerId);
    else if (body.provider) {
      const rec = providerRepo.findByName(body.provider);
      if (rec) providerRepo.remove(rec.id);
    }
    return { ok: true, removed: members.length };
  });

  // 检测提供商的可用模型：直接使用表单中的 raw 配置，尚未落库也可检测。
  app.post("/api/models/providers/discover", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    if (!body?.provider) {
      return reply.code(400).send({ error: "bad_request", message: "provider 必填" });
    }
    const apiBase = body.apiBase || modelRepo.findProviderApiBase(body.provider) || null;
    const apiKey =
      body.apiKey ||
      (apiBase ? modelRepo.findKeyByBase(apiBase) : null) ||
      modelRepo.findProviderKey(body.provider) ||
      "";
    const startedAt = Date.now();
    try {
      const models = await discoverModels({ provider: body.provider, apiKey, apiBase });
      sysLog.info(
        "model",
        `提供商模型检测成功：${body.provider}（${models.length} 个）`,
        { provider: body.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: apiBase ?? null, reusedKey: !!apiKey && !body.apiKey, models: models.map((m) => m.id) },
      );
      return { ok: true, models, reusedKey: !!apiKey && !body.apiKey };
    } catch (err) {
      const status = (err as any)?.status && (err as any).status >= 400 ? (err as any).status : 400;
      sysLog.error(
        "error",
        `提供商模型检测失败：${body.provider}`,
        { provider: body.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: apiBase ?? null, error: (err as Error).message, stack: (err as Error).stack },
      );
      return reply.code(status).send({ ok: false, error: "discover_failed", message: (err as Error).message });
    }
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
    const startedAt = Date.now();
    try {
      const summary = await scanModelsVision({
        onlyEnabled: body.onlyEnabled !== false,
        probe: body.probe !== false,
        persist: body.persist !== false,
        fresh: body.fresh === true,
      });
      sysLog.info(
        "vision",
        "读图能力扫描完成",
        { stage: "vision_scan", durationMs: Date.now() - startedAt },
        summary,
      );
      return { ok: true, ...summary };
    } catch (err) {
      sysLog.error(
        "vision",
        `读图能力扫描失败：${(err as Error).message}`,
        { stage: "vision_scan", durationMs: Date.now() - startedAt },
        { error: (err as Error).message, stack: (err as Error).stack },
      );
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
    const startedAt = Date.now();
    try {
      const models = await discoverModels({ provider: body.provider, apiKey, apiBase });
      sysLog.info(
        "model",
        `模型检测成功：${body.provider}（${models.length} 个）`,
        { provider: body.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: apiBase ?? null, reusedKey: !!apiKey && !body.apiKey, models: models.map((m) => m.id) },
      );
      return { ok: true, models, reusedKey: !!apiKey && !body.apiKey };
    } catch (err) {
      const status = (err as any)?.status && (err as any).status >= 400 ? (err as any).status : 400;
      sysLog.error(
        "error",
        `模型检测失败：${body.provider}`,
        { provider: body.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: apiBase ?? null, error: (err as Error).message, stack: (err as Error).stack },
      );
      return reply.code(status).send({ ok: false, error: "discover_failed", message: (err as Error).message });
    }
  });

  // 编辑场景检测：apiKey 留空时复用该模型已存储的密钥。
  app.post("/api/models/:id/discover", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const model = modelRepo.find(id);
    if (!model) return reply.code(404).send({ error: "not_found" });
    const body = (request.body ?? {}) as any;
    const startedAt = Date.now();
    try {
      const models = await discoverModels({
        provider: body.provider ?? model.provider,
        apiKey: body.apiKey || modelRepo.decryptedKey(model),
        apiBase: body.apiBase ?? model.apiBase,
      });
      sysLog.info(
        "model",
        `模型检测成功：${body.provider ?? model.provider}（${models.length} 个）`,
        { modelId: model.id, provider: body.provider ?? model.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: body.apiBase ?? model.apiBase, models: models.map((m) => m.id) },
      );
      return { ok: true, models };
    } catch (err) {
      const status = (err as any)?.status && (err as any).status >= 400 ? (err as any).status : 400;
      sysLog.error(
        "error",
        `模型检测失败：${body.provider ?? model.provider}`,
        { modelId: model.id, provider: body.provider ?? model.provider, stage: "discover", durationMs: Date.now() - startedAt },
        { apiBase: body.apiBase ?? model.apiBase, error: (err as Error).message, stack: (err as Error).stack },
      );
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
    // 分组键：与 classify 保持一致（提供商名称 + 归一化地址），缺地址时退化为按名称
    const groupKey = classify({ provider: body.provider, apiBase: providerApiBase }).key;
    const existingKeys = new Set(
      modelRepo
        .list()
        .filter((m) => classify(m).key === groupKey)
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
    const startedAt = Date.now();
    try {
      sysLog.info(
        "model",
        `连通性测试请求：${model.modelId}`,
        { modelId: model.id, provider: model.provider, stage: "test_request" },
        { modelId: model.modelId, provider: model.provider, apiBase: model.apiBase },
      );
      const provider = createProviderFromModel(model);
      const result = await provider.chat([
        { role: "system", content: "你是一个连通性测试助手。" },
        { role: "user", content: "请只回复两个字：正常" },
      ], { maxTokens: 16 });
      sysLog.info(
        "model",
        `连通性测试成功：${model.modelId}`,
        { modelId: model.id, provider: model.provider, stage: "test_response", durationMs: Date.now() - startedAt },
        { reply: result.content, usage: result.usage },
      );
      return { ok: true, reply: result.content, usage: result.usage };
    } catch (err) {
      sysLog.error(
        "error",
        `连通性测试失败：${model.modelId}`,
        { modelId: model.id, provider: model.provider, stage: "test_request", durationMs: Date.now() - startedAt },
        { error: (err as Error).message, stack: (err as Error).stack },
      );
      return reply.code(400).send({ ok: false, error: "test_failed", message: (err as Error).message });
    }
  });
}
