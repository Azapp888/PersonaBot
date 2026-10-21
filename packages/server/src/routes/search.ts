import type { FastifyInstance } from "fastify";
import { searchProviderRepo } from "../db/repos/search-providers";
import { SEARCH_PRESETS, findSearchPreset } from "../search/presets";
import { runWebSearch } from "../search/service";
import { logger } from "../logger";
import type { SearchProvider, SearchVendor } from "../types";

function present(provider: SearchProvider) {
  const preset = findSearchPreset(provider.vendor);
  return {
    id: provider.id,
    vendor: provider.vendor,
    label: preset?.label ?? provider.vendor,
    apiBase: provider.apiBase,
    model: provider.model,
    enabled: provider.enabled,
    apiKeySet: !!provider.apiKey,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

const VENDORS = new Set(SEARCH_PRESETS.map((p) => p.vendor));

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/search/providers", { preHandler: [app.authenticate] }, async () => {
    return { presets: SEARCH_PRESETS, providers: searchProviderRepo.list().map(present) };
  });

  app.post("/api/search/providers", { preHandler: [app.authenticate] }, async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const vendor = String(body.vendor ?? "") as SearchVendor;
    if (!VENDORS.has(vendor)) return reply.code(400).send({ error: "bad_request", message: "未知的搜索提供商" });
    const preset = findSearchPreset(vendor)!;
    const existing = searchProviderRepo.findByVendor(vendor);
    // 「自动增加提供商」：同一厂商只保留一条配置，重复添加视为更新密钥/启用状态。
    if (existing) {
      const updated = searchProviderRepo.update(existing.id, {
        apiKey: body.apiKey,
        apiBase: body.apiBase ?? existing.apiBase,
        model: body.model ?? existing.model,
        enabled: body.enabled ?? true,
      })!;
      return present(updated);
    }
    const created = searchProviderRepo.create({
      vendor,
      apiBase: body.apiBase || preset.apiBase,
      model: body.model || preset.model,
      apiKey: body.apiKey ?? null,
      enabled: body.enabled !== false,
    });
    return present(created);
  });

  app.put("/api/search/providers/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = searchProviderRepo.find(id);
    if (!existing) return reply.code(404).send({ error: "not_found" });
    const body = (request.body ?? {}) as any;
    const updated = searchProviderRepo.update(id, {
      apiBase: body.apiBase,
      model: body.model,
      apiKey: body.apiKey,
      enabled: body.enabled,
    })!;
    return present(updated);
  });

  app.delete("/api/search/providers/:id", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!searchProviderRepo.find(id)) return reply.code(404).send({ error: "not_found" });
    searchProviderRepo.remove(id);
    return { ok: true };
  });

  app.post("/api/search/providers/:id/test", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const provider = searchProviderRepo.find(id);
    if (!provider) return reply.code(404).send({ error: "not_found" });
    const body = (request.body ?? {}) as any;
    const query = String(body.query ?? "今天的新闻").slice(0, 128);
    try {
      const results = await runWebSearch(provider, query, 3);
      return { ok: true, results };
    } catch (err) {
      logger.warn({ vendor: provider.vendor, err: (err as Error).message }, "search provider test failed");
      return reply.code(502).send({ ok: false, message: (err as Error).message });
    }
  });
}
