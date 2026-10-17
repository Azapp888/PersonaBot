/**
 * 模型图标：根据「模型 ID / 名称」里的关键字自动匹配主流厂商，显示对应标识。
 *
 * - 采用轻量的品牌色 + 字母/几何标记，避免引入外部图片资源；
 * - 匹配顺序从具体到宽泛，命中即返回；
 * - 无法匹配时返回 null，调用方可选择不显示图标。
 */

export interface ModelBrand {
  /** 品牌标识 key，便于测试与排查。 */
  key: string;
  /** 展示名，用于 tooltip。 */
  label: string;
  /** 品牌主色。 */
  color: string;
  /** 图标内的字形（最多 2 个字符）。 */
  glyph: string;
}

interface BrandRule extends ModelBrand {
  /** 命中该品牌的关键字/正则（对模型 id 与名称做小写后匹配）。 */
  patterns: RegExp[];
}

const RULES: BrandRule[] = [
  {
    key: "anthropic",
    label: "Anthropic Claude",
    color: "#D97757",
    glyph: "C",
    patterns: [/claude/],
  },
  {
    key: "openai",
    label: "OpenAI GPT",
    color: "#10A37F",
    glyph: "G",
    patterns: [/\bgpt\b/, /\bgpt-/, /gpt/, /\bo[1-4](-|$)/, /chatgpt/, /\bo3\b/, /\bo4\b/, /davinci/, /\bdall-e/, /whisper/],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    color: "#4D6BFE",
    glyph: "D",
    patterns: [/deepseek/, /\bds-/, /deepseek-(chat|reasoner|coder|vl|vision)/],
  },
  {
    key: "google",
    label: "Google Gemini",
    color: "#4285F4",
    glyph: "G",
    patterns: [/gemini/, /gemma/, /palm/, /bison/],
  },
  {
    key: "qwen",
    label: "通义千问 Qwen",
    color: "#615CED",
    glyph: "Q",
    patterns: [/qwen/, /\bqvq\b/, /tongyi/],
  },
  {
    key: "doubao",
    label: "字节豆包 Doubao",
    color: "#1664FF",
    glyph: "豆",
    patterns: [/doubao/, /seed-1/, /ep-\d/],
  },
  {
    key: "zhipu",
    label: "智谱 GLM",
    color: "#3859FF",
    glyph: "智",
    patterns: [/glm/, /chatglm/, /zhipu/],
  },
  {
    key: "moonshot",
    label: "Moonshot 月之暗面",
    color: "#0A0A0A",
    glyph: "K",
    patterns: [/moonshot/, /kimi/],
  },
  {
    key: "baidu",
    label: "百度文心 ERNIE",
    color: "#2932E1",
    glyph: "文",
    patterns: [/ernie/, /wenxin/, /qianfan/],
  },
  {
    key: "tencent",
    label: "腾讯混元 Hunyuan",
    color: "#0052D9",
    glyph: "混",
    patterns: [/hunyuan/, /tencent/],
  },
  {
    key: "xinghuo",
    label: "讯飞星火 Spark",
    color: "#1A6EFF",
    glyph: "星",
    patterns: [/spark/, /xinghuo/, /xf-yun/],
  },
  {
    key: "minimax",
    label: "MiniMax",
    color: "#FF5D5D",
    glyph: "M",
    patterns: [/minimax/, /\babab/],
  },
  {
    key: "xai",
    label: "xAI Grok",
    color: "#000000",
    glyph: "X",
    patterns: [/\bgrok\b/, /grok-/],
  },
  {
    key: "mistral",
    label: "Mistral",
    color: "#FA520F",
    glyph: "M",
    patterns: [/mistral/, /mixtral/, /codestral/],
  },
  {
    key: "meta",
    label: "Meta Llama",
    color: "#0866FF",
    glyph: "L",
    patterns: [/llama/, /meta-/],
  },
  {
    key: "yi",
    label: "零一万物 Yi",
    color: "#1B1B1B",
    glyph: "Yi",
    patterns: [/\byi-/, /yi-vision/],
  },
  {
    key: "mock",
    label: "Mock（本地联调）",
    color: "#8A8A8A",
    glyph: "M",
    patterns: [/mock/],
  },
];

/** 依据模型 id / 名称匹配品牌；无匹配返回 null。 */
export function matchModelBrand(modelId: string | null | undefined, name?: string | null): ModelBrand | null {
  const hay = `${modelId ?? ""} ${name ?? ""}`.toLowerCase();
  if (!hay.trim()) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(hay))) {
      return { key: rule.key, label: rule.label, color: rule.color, glyph: rule.glyph };
    }
  }
  return null;
}

/** 模型名称前的品牌图标；无法识别时不渲染任何内容。 */
export function ModelIcon({ modelId, name, size = 16 }: { modelId: string; name?: string; size?: number }) {
  const brand = matchModelBrand(modelId, name);
  if (!brand) return null;
  return (
    <span
      title={brand.label}
      aria-label={brand.label}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] font-mono font-semibold leading-none"
      style={{
        width: size,
        height: size,
        background: brand.color,
        color: "#fff",
        fontSize: size <= 14 ? 9 : 10,
      }}
    >
      {brand.glyph}
    </span>
  );
}
