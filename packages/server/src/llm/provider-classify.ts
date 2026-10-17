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
  moonshot: "https://api.moonshot.cn/v1",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  minimax: "https://api.minimax.chat/v1",
  qianfan: "https://qianfan.baidubce.com/v2",
  tencent: "https://api.hunyuan.cloud.tencent.com/v1",
  spark: "https://spark-api-open.xf-yun.com/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
};

export interface ProviderGroupKey {
  /** 归一化后的稳定分组键：由「提供商名称 + 归一化地址」共同决定。 */
  key: string;
  /** 展示名。 */
  label: string;
  /** 归一化后的地址（去掉协议与尾部斜杠，保留 host+path 结构）。 */
  addr: string;
  /** 规范化后的提供商名称（用户自定义名或内置预设）。 */
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

/** 内置预设的展示名（用户自定义名称不在其中）。 */
export const PRESET_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  deepseek: "DeepSeek",
  volcengine: "火山引擎方舟（豆包）",
  google: "Google Gemini",
  dashscope: "阿里云百炼（通义千问）",
  moonshot: "Moonshot 月之暗面",
  zhipu: "智谱 GLM",
  minimax: "MiniMax",
  qianfan: "百度千帆",
  tencent: "腾讯混元",
  spark: "讯飞星火",
  xai: "xAI Grok",
  openrouter: "OpenRouter",
  siliconflow: "SiliconFlow 硅基流动",
  custom: "自定义（OpenAI 兼容）",
  mock: "Mock（本地联调）",
};

/**
 * 把一个模型（或一组隐式配置）归入「提供商分组」。
 *
 * 分组键 = 「提供商名称 + 归一化地址」：
 * - 名称相同但地址不同 -> 不同分组（不因 provider 同名而合并）；
 * - 地址相同但名称不同 -> 不同分组（保留用户自定义命名）；
 * - 无地址时退化为仅按名称分组。
 *
 * 展示名优先使用用户填写的提供商名称，未命中预设时回退到主机名或预设名。
 */
export function classify(model: Pick<ModelRecord, "provider" | "apiBase">): ProviderGroupKey {
  const vendor = (model.provider || "custom").trim() || "custom";
  if (vendor === "mock") {
    return { key: "mock", label: PRESET_LABELS.mock, addr: "mock://local", vendor, known: true };
  }
  const effectiveBase = model.apiBase || PROVIDER_DEFAULT_BASE[vendor] || "";
  const addr = normalizeBase(effectiveBase);
  const host = hostOf(addr);
  const rule = host ? HOST_RULES.find((r) => host.includes(r.match)) : undefined;
  // 展示名：用户自定义名优先 > 预设名 > 官方地址规则名 > 主机名
  const label = customLabelOr(vendor, rule?.label ?? host ?? vendor);
  if (!addr) {
    return { key: `provider:${vendor}`, label, addr: "", vendor, known: false };
  }
  return {
    key: `${vendor}@${addr}`,
    label,
    addr,
    vendor,
    known: !!rule,
  };
}

/**
 * 若 provider 是内置预设（或其别名），用官方展示名；否则保留用户自定义名称。
 * 这样「自定义名称」既能显示，又不会让内置预设显示成裸 id。
 */
export function customLabelOr(provider: string, fallback: string): string {
  const preset = PRESET_LABELS[provider];
  if (!preset) return provider || fallback;
  return preset;
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
