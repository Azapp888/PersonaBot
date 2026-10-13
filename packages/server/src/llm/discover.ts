import { fetchWithTimeout } from "../utils/http";
import { LLMError } from "./provider";

export interface DiscoveredModel {
  id: string;
  /** 上游返回的创建时间（秒级时间戳转毫秒），无则为 null */
  created?: number | null;
  /** 归属提供方（上游 owner 字段），无则为 null */
  ownedBy?: string | null;
}

export interface DiscoverOptions {
  provider: string;
  apiKey: string;
  apiBase?: string | null;
  signal?: AbortSignal;
}

const DEFAULT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
};

/**
 * 探测上游提供方的可用模型列表。
 *
 * - OpenAI 兼容（openai / deepseek / custom）：`GET {apiBase}/models`，Bearer 鉴权；
 * - Anthropic：`GET {apiBase}/v1/models`，`x-api-key` + `anthropic-version` 头。
 *
 * 返回值按 id 去重并按字母序排序，方便前端选择。
 */
export async function discoverModels(opts: DiscoverOptions): Promise<DiscoveredModel[]> {
  const provider = opts.provider || "custom";

  if (provider === "mock") {
    return [{ id: "mock-roleplay", created: null, ownedBy: "mock" }];
  }

  if (!opts.apiKey) {
    throw new LLMError("缺少 API Key，无法检测可用模型", 400);
  }

  const base = (opts.apiBase || DEFAULT_BASES[provider] || DEFAULT_BASES.openai).replace(/\/$/, "");

  if (provider === "anthropic") {
    return discoverAnthropic(base, opts.apiKey, opts.signal);
  }
  return discoverOpenAICompatible(base, opts.apiKey, opts.signal);
}

async function discoverOpenAICompatible(
  base: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DiscoveredModel[]> {
  const res = await requestModels(
    `${base}/models`,
    { Authorization: `Bearer ${apiKey}` },
    signal,
  );
  const data: any = await res.json();
  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
  return normalize(
    list.map((m: any) => ({
      id: String(m?.id ?? m?.name ?? "").trim(),
      created: normalizeCreated(m?.created),
      ownedBy: m?.owned_by ?? m?.ownedBy ?? null,
    })),
  );
}

async function discoverAnthropic(base: string, apiKey: string, signal?: AbortSignal): Promise<DiscoveredModel[]> {
  const res = await requestModels(
    `${base}/v1/models`,
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal,
  );
  const data: any = await res.json();
  const list = Array.isArray(data?.data) ? data.data : [];
  return normalize(
    list.map((m: any) => ({
      id: String(m?.id ?? "").trim(),
      created: normalizeCreated(m?.created_at ?? m?.created),
      ownedBy: m?.owner ?? "anthropic",
    })),
  );
}

/** 发起模型列表请求，统一网络异常与 HTTP 错误的报错信息。 */
async function requestModels(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { method: "GET", headers, signal, timeoutMs: 20000 });
  } catch (err) {
    throw new LLMError(`无法连接模型服务：${(err as Error).message}`, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text ? ` - ${text.slice(0, 300)}` : "";
    throw new LLMError(`检测模型失败 (${res.status})${detail}`, res.status);
  }
  return res;
}

function normalizeCreated(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // 秒级时间戳转毫秒，已是毫秒级的保持不变
    return value > 0 && value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string") {
    const n = Date.parse(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalize(items: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>();
  const out: DiscoveredModel[] = [];
  for (const item of items) {
    if (!item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
