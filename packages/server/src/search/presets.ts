import type { SearchVendor } from "../types";

export interface SearchPreset {
  vendor: SearchVendor;
  label: string;
  /** 默认 API Base，用户可覆盖。 */
  apiBase: string;
  /** 部分厂商需要指定执行搜索的模型（火山方舟 Responses API）。 */
  model: string | null;
  description: string;
  /** 申请/管理密钥的控制台地址。 */
  consoleUrl: string;
  keyHint: string;
}

/**
 * 内置联网搜索提供商。
 *
 * 这些厂商都提供可直接调用的搜索接口：
 * - DeepSeek：/v1/tools/search
 * - 火山方舟：/api/v3/responses + tools:[{type:"web_search"}]
 * - Tavily / Exa / Serper / 博查：各自的 web search API
 */
export const SEARCH_PRESETS: SearchPreset[] = [
  {
    vendor: "deepseek",
    label: "DeepSeek 搜索",
    apiBase: "https://api.deepseek.com/v1",
    model: null,
    description: "DeepSeek 自研搜索引擎，返回带排序分数的网页结果，国内直连。",
    consoleUrl: "https://platform.deepseek.com/api_keys",
    keyHint: "sk-...",
  },
  {
    vendor: "volcengine",
    label: "火山引擎（方舟）",
    apiBase: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615",
    description: "通过方舟 Responses API 的 web_search 内置工具联网，返回检索摘要与引用链接。",
    consoleUrl: "https://console.volcengine.com/ark",
    keyHint: "ARK API Key",
  },
  {
    vendor: "tavily",
    label: "Tavily",
    apiBase: "https://api.tavily.com",
    model: null,
    description: "面向 AI Agent 的搜索 API，结果干净、延迟低，海外服务。",
    consoleUrl: "https://app.tavily.com/home",
    keyHint: "tvly-...",
  },
  {
    vendor: "bocha",
    label: "博查 Bocha",
    apiBase: "https://api.bochaai.com/v1",
    model: null,
    description: "国内中文搜索 API，覆盖网页与摘要，适合中文时效性问题。",
    consoleUrl: "https://open.bochaai.com",
    keyHint: "sk-...",
  },
  {
    vendor: "exa",
    label: "Exa",
    apiBase: "https://api.exa.ai",
    model: null,
    description: "语义搜索 API，可返回网页正文，适合资料型查询。",
    consoleUrl: "https://dashboard.exa.ai/api-keys",
    keyHint: "exa-...",
  },
  {
    vendor: "serper",
    label: "Serper (Google)",
    apiBase: "https://google.serper.dev",
    model: null,
    description: "Google 搜索结果 API，时效性与覆盖面好，海外服务。",
    consoleUrl: "https://serper.dev/api-key",
    keyHint: "Serper API Key",
  },
];

export function findSearchPreset(vendor: string): SearchPreset | null {
  return SEARCH_PRESETS.find((p) => p.vendor === vendor) ?? null;
}
