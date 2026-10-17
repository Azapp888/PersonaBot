import type { ModelRecord } from "../types";

/**
 * 按「提供商地址（apiBase）」归类模型。
 *
 * 灵感来自两个开源实践：
 * - LiteLLM 的 `custom_openai/<model>` 前缀：同一个协议下用「上游地址」区分第三方，而不是仅靠固定枚举；
 * - models.dev 的 provider 目录：以 host / 官方域名 / env 名刻画一个提供商。
 *
 * 结论：分类的最小事实单元是「地址」，不是「provider 字符串」。
 * 两个配置即便 provider 名相同，只要 apiBase 不同就是不同上游；地址相同而密钥不同，
 * 则归为同一提供商的多个凭据。
 */

/** 已知提供商的地址特征（host 子串 -> 规范标识）。参考 models.dev 的官方域名。 */
interface HostRule {
  /** 匹配 host 的子串（小写）。 */
  match: string;
  /** 规范提供商标识。 */
  vendor: string;
  /** 面向人的展示名。 */
  label: string;
}

const HOST_RULES: HostRule[] = [
  { match: "api.anthropic.com", vendor: "anthropic", label: "Anthropic Claude" },
  { match: "api.openai.com", vendor: "openai", label: "OpenAI" },
  { match: "api.deepseek.com", vendor: "deepseek", label: "DeepSeek" },
  { match: "ark.cn-beijing.volces.com", vendor: "volcengine", label: "火山引擎方舟（豆包）" },
  { match: "volces.com", vendor: "volcengine", label: "火山引擎方舟（豆包）" },
  { match: "dashscope.aliyuncs.com", vendor: "dashscope", label: "阿里云百炼（通义千问）" },
  { match: "aliyuncs.com", vendor: "dashscope", label: "阿里云百炼（通义千问）" },
  { match: "openrouter.ai", vendor: "openrouter", label: "OpenRouter" },
  { match: "siliconflow.cn", vendor: "siliconflow", label: "SiliconFlow 硅基流动" },
  { match: "siliconflow.com", vendor: "siliconflow", label: "SiliconFlow 硅基流动" },
  { match: "moonshot.cn", vendor: "moonshot", label: "Moonshot 月之暗面" },
  { match: "api.moonshot.", vendor: "moonshot", label: "Moonshot 月之暗面" },
  { match: "bigmodel.cn", vendor: "zhipu", label: "智谱 GLM" },
  { match: "zhipuai.cn", vendor: "zhipu", label: "智谱 GLM" },
  { match: "minimax", vendor: "minimax", label: "MiniMax" },
  { match: "baidubce.com", vendor: "qianfan", label: "百度千帆" },
  { match: "qianfan", vendor: "qianfan", label: "百度千帆" },
  { match: "tencentcloudapi.com", vendor: "tencent", label: "腾讯混元" },
  { match: "hunyuan", vendor: "tencent", label: "腾讯混元" },
  { match: "xf-yun.com", vendor: "spark", label: "讯飞星火" },
  { match: "generativelanguage.googleapis.com", vendor: "google", label: "Google Gemini" },
  { match: "googleapis.com", vendor: "google", label: "Google Gemini" },
  { match: "api.x.ai", vendor: "xai", label: "xAI Grok" },
  { match: "mistral.ai", vendor: "mistral", label: "Mistral" },
  { match: "groq.com", vendor: "groq", label: "Groq" },
  { match: "localhost", vendor: "local", label: "本地 / 内网网关" },
  { match: "127.0.0.1", vendor: "local", label: "本地 / 内网网关" },
  { match: "0.0.0.0", vendor: "local", label: "本地 / 内网网关" },
];

/** 固定枚举 provider 到 addr 的默认地址（与 factory/dist 保持一致的默认值）。 */
const PROVIDER_DEFAULT_BASE: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  anthropic: "https://api.anthropic.com",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  google: "https://generativelanguage.googleapis.com",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
};

export interface ProviderGroupKey {
  /** 归一化后的稳定分组键：优先用 host，其次用规范 provider 名。 */
  key: string;
  /** 展示名。 */
  label: string;
  /** 归一化后的地址（去掉协议与尾部斜杠，保留 host+path 结构）。 */
  addr: string;
  /** 规范提供商标识（若能识别）；否则回退到记录里的 provider。 */
  vendor: string;
  /** 是否是已知的官方地址。 */
  known: boolean;
}

/**
 * 归一化 apiBase：去掉末尾斜杠、统一小写 host、去掉常见冗余段。
 * 返回 host + path（不含协议），空地址返回空串。
 */
export function normalizeBase(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = raw.trim();
  if (!s) return "";
  // 去掉协议
  s = s.replace(/^https?:\/\//i, "");
  // 去掉末尾斜杠与查询
  s = s.split("?")[0].replace(/\/+$/, "");
  if (!s) return "";
  // host 部分转小写，path 保持原样
  const slash = s.indexOf("/");
  if (slash === -1) return s.toLowerCase();
  return s.slice(0, slash).toLowerCase() + s.slice(slash);
}

function hostOf(addr: string): string {
  const slash = addr.indexOf("/");
  return (slash === -1 ? addr : addr.slice(0, slash)).toLowerCase();
}

/**
 * 把一个模型（或一组隐式配置）归入「提供商地址分组」。
 *
 * - 有 apiBase：以 apiBase 为事实依据；
 * - 无 apiBase：回退到该 provider 的官方默认地址；
 * - mock：单独分组。
 */
export function classify(model: Pick<ModelRecord, "provider" | "apiBase">): ProviderGroupKey {
  if (model.provider === "mock") {
    return { key: "mock", label: "Mock（本地联调）", addr: "mock://local", vendor: "mock", known: true };
  }
  const effectiveBase = model.apiBase || PROVIDER_DEFAULT_BASE[model.provider] || "";
  const addr = normalizeBase(effectiveBase);
  const host = hostOf(addr);
  const rule = host ? HOST_RULES.find((r) => host.includes(r.match)) : undefined;
  if (rule) {
    // 同一官方域名下不同路径（如 dashscope 的 compatible-mode）仍归同一提供商
    return { key: rule.vendor, label: rule.label, addr, vendor: rule.vendor, known: true };
  }
  if (addr) {
    // 未知地址：以 host+path 为分组键，确保同地址同组、不同地址分列
    return { key: `addr:${addr}`, label: host || addr, addr, vendor: model.provider, known: false };
  }
  // 无地址且非已知官方默认：按 provider 名分组
  const vendor = model.provider || "custom";
  return { key: `provider:${vendor}`, label: vendor, addr: "", vendor, known: false };
}

/**
 * 同一「提供商地址」下是否可视为同一上游。
 * 地址相同（归一化后）即视为同一上游；host 不同则不是。
 */
export function sameEndpoint(a: Pick<ModelRecord, "provider" | "apiBase">, b: Pick<ModelRecord, "provider" | "apiBase">): boolean {
  return classify(a).key === classify(b).key;
}

/** 每个地址分组下可用的凭据数（不同密钥视为不同凭据）。 */
export interface CredentialSummary {
  /** 该分组下的去重密钥数量（以加密存储的存在性计，明文不离开仓库层）。 */
  count: number;
}

/** 供前端展示的单个分组。 */
export interface ProviderGroupView {
  key: string;
  label: string;
  addr: string;
  vendor: string;
  known: boolean;
  models: number;
  credentials: number;
  visionModels: number;
}
