import type { SearchProvider, ToolDefinition, WebSearchResult } from "../types";
import { decryptSecret } from "../utils/crypto";
import { fetchWithTimeout } from "../utils/http";
import { findSearchPreset } from "./presets";
import { logger } from "../logger";

const SEARCH_TIMEOUT_MS = 15000;
const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

/** 暴露给模型的联网搜索工具定义。 */
export const WEB_SEARCH_TOOL: ToolDefinition = {
  name: "web_search",
  description:
    "联网搜索最新公开信息。遇到新闻、实时数据、近期事件、你不确定或知识可能过时的问题时调用。" +
    "返回标题、链接和摘要；回答时应基于搜索结果，并在合适时引用链接。一次只搜索一个明确的关键词组合。",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索词，尽量具体，可包含时间、地点、人名等限定词" },
      count: { type: "integer", description: "返回结果条数，1-10，默认 5", minimum: 1, maximum: MAX_COUNT },
    },
    required: ["query"],
  },
};

function baseOf(provider: SearchProvider): string {
  return (provider.apiBase || findSearchPreset(provider.vendor)?.apiBase || "").replace(/\/$/, "");
}

function apiKeyOf(provider: SearchProvider): string {
  if (!provider.apiKey) throw new Error("未配置 API Key");
  return decryptSecret(provider.apiKey);
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const res = await fetchWithTimeout(url, {
    method: "POST",
    timeoutMs: SEARCH_TIMEOUT_MS,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`搜索请求失败（${res.status}）：${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error("搜索接口返回了非 JSON 内容");
  }
}

function pickString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalize(results: WebSearchResult[], count: number): WebSearchResult[] {
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const r of results) {
    const title = (r.title || "").trim();
    const url = (r.url || "").trim();
    const snippet = (r.snippet || "").trim();
    if (!title && !snippet) continue;
    const key = url || `${title}\n${snippet}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title || url || "搜索结果", url, snippet });
    if (out.length >= count) break;
  }
  return out;
}

async function searchDeepSeek(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const data = await postJson(
    `${baseOf(provider)}/tools/search`,
    { Authorization: `Bearer ${apiKeyOf(provider)}` },
    { query, count, need_content: false },
  );
  const rows = Array.isArray(data?.results) ? data.results : [];
  return normalize(
    rows.map((r: any) => ({ title: r.title, url: r.url, snippet: r.snippet })),
    count,
  );
}

/** 从方舟 Responses API 的返回里提取文本与引用链接。 */
export function extractVolcengineResults(data: any, count: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const output = Array.isArray(data?.output) ? data.output : [];
  for (const item of output) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const c of contents) {
      const text = pickString(c?.text);
      if (!text) continue;
      const annotations = Array.isArray(c?.annotations) ? c.annotations : [];
      for (const a of annotations) {
        const url = pickString(a?.url, a?.link);
        if (!url) continue;
        results.push({ title: pickString(a?.title, a?.site_name) || url, url, snippet: text.slice(0, 500) });
      }
      if (!annotations.length) results.push({ title: "联网搜索结果", url: "", snippet: text.slice(0, 1500) });
    }
  }
  const fallbackText = pickString(data?.output_text);
  if (!results.length && fallbackText) {
    results.push({ title: "联网搜索结果", url: "", snippet: fallbackText.slice(0, 1500) });
  }
  return normalize(results, count);
}

async function searchVolcengine(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const model = provider.model || findSearchPreset("volcengine")?.model || "doubao-seed-1-6-250615";
  const data = await postJson(
    `${baseOf(provider)}/responses`,
    { Authorization: `Bearer ${apiKeyOf(provider)}` },
    {
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: query }] }],
      tools: [{ type: "web_search" }],
      stream: false,
    },
  );
  const results = extractVolcengineResults(data, count);
  if (!results.length) throw new Error("联网搜索没有返回可用结果");
  return results;
}

async function searchTavily(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const data = await postJson(
    `${baseOf(provider)}/search`,
    {},
    { api_key: apiKeyOf(provider), query, max_results: count, search_depth: "basic", include_answer: false },
  );
  const rows = Array.isArray(data?.results) ? data.results : [];
  return normalize(
    rows.map((r: any) => ({ title: r.title, url: r.url, snippet: r.content })),
    count,
  );
}

async function searchBocha(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const data = await postJson(
    `${baseOf(provider)}/web-search`,
    { Authorization: `Bearer ${apiKeyOf(provider)}` },
    { query, summary: true, count },
  );
  const rows = data?.data?.webPages?.value ?? data?.webPages?.value ?? [];
  return normalize(
    (Array.isArray(rows) ? rows : []).map((r: any) => ({
      title: r.name,
      url: r.url,
      snippet: r.summary ?? r.snippet,
    })),
    count,
  );
}

async function searchExa(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const data = await postJson(
    `${baseOf(provider)}/search`,
    { "x-api-key": apiKeyOf(provider) },
    { query, numResults: count, contents: { text: { maxCharacters: 600 } } },
  );
  const rows = Array.isArray(data?.results) ? data.results : [];
  return normalize(
    rows.map((r: any) => ({ title: r.title, url: r.url, snippet: r.text ?? r.summary })),
    count,
  );
}

async function searchSerper(provider: SearchProvider, query: string, count: number): Promise<WebSearchResult[]> {
  const data = await postJson(
    `${baseOf(provider)}/search`,
    { "X-API-KEY": apiKeyOf(provider) },
    { q: query, num: count },
  );
  const rows = Array.isArray(data?.organic) ? data.organic : [];
  return normalize(
    rows.map((r: any) => ({ title: r.title, url: r.link, snippet: r.snippet })),
    count,
  );
}

const ADAPTERS: Record<
  SearchProvider["vendor"],
  (provider: SearchProvider, query: string, count: number) => Promise<WebSearchResult[]>
> = {
  deepseek: searchDeepSeek,
  volcengine: searchVolcengine,
  tavily: searchTavily,
  bocha: searchBocha,
  exa: searchExa,
  serper: searchSerper,
};

/** 执行一次联网搜索，结果已按查询去重并截断。 */
export async function runWebSearch(
  provider: SearchProvider,
  query: string,
  count = DEFAULT_COUNT,
): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) throw new Error("搜索词不能为空");
  const n = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(count) || DEFAULT_COUNT)));
  const adapter = ADAPTERS[provider.vendor];
  if (!adapter) throw new Error(`不支持的搜索提供商：${provider.vendor}`);
  logger.info({ vendor: provider.vendor, query: q, count: n }, "web search requested");
  return adapter(provider, q, n);
}

/** 把搜索结果渲染成回填给模型的可读文本。 */
export function formatSearchResults(query: string, results: WebSearchResult[]): string {
  if (!results.length) return `搜索「${query}」没有找到结果。`;
  const lines = results.map((r, i) => {
    const head = `${i + 1}. ${r.title}`;
    const url = r.url ? `\n   ${r.url}` : "";
    const snippet = r.snippet ? `\n   ${r.snippet}` : "";
    return `${head}${url}${snippet}`;
  });
  return `搜索「${query}」的结果：\n\n${lines.join("\n\n")}`;
}

