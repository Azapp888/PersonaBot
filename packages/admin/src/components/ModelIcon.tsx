/**
 * 模型/提供商图标：根据「提供商名称 / 模型 ID / 名称」里的关键字自动识别厂商，
 * 渲染仓库内置的品牌 SVG 资源；无法识别时回退到轻量的品牌色字母标记。
 *
 * - 图标为本地 SVG，构建期打包，不依赖外网；
 * - 匹配顺序从具体到宽泛，命中即返回；
 * - 识别依据优先取「提供商名称」（用户自定义名称里含 openai / gemini 等即会命中）。
 */

import anthropic from "@/assets/providers/anthropic.svg";
import baidu from "@/assets/providers/baidu.svg";
import custom from "@/assets/providers/custom.svg";
import dashscope from "@/assets/providers/dashscope.svg";
import deepseek from "@/assets/providers/deepseek.svg";
import google from "@/assets/providers/google.svg";
import groq from "@/assets/providers/groq.svg";
import minimax from "@/assets/providers/minimax.svg";
import mistral from "@/assets/providers/mistral.svg";
import mock from "@/assets/providers/mock.svg";
import moonshot from "@/assets/providers/moonshot.svg";
import openai from "@/assets/providers/openai.svg";
import openrouter from "@/assets/providers/openrouter.svg";
import qianfan from "@/assets/providers/qianfan.svg";
import qwen from "@/assets/providers/qwen.svg";
import siliconflow from "@/assets/providers/siliconflow.svg";
import spark from "@/assets/providers/spark.svg";
import tencent from "@/assets/providers/tencent.svg";
import volcengine from "@/assets/providers/volcengine.svg";
import xai from "@/assets/providers/xai.svg";
import yi from "@/assets/providers/yi.svg";
import zhipu from "@/assets/providers/zhipu.svg";

export interface ModelBrand {
  /** 品牌标识 key，便于测试与排查。 */
  key: string;
  /** 展示名，用于 tooltip。 */
  label: string;
  /** 本地 SVG 资源 URL。 */
  icon: string;
  /** 回退用的品牌主色（无 SVG 时）。 */
  color: string;
  /** 回退用的字形（最多 2 个字符）。 */
  glyph: string;
}

interface BrandRule extends Omit<ModelBrand, "icon"> {
  icon?: string;
  /** 命中该品牌的关键字/正则（对 provider 名、模型 id 与名称做小写后匹配）。 */
  patterns: RegExp[];
}

const RULES: BrandRule[] = [
  {
    key: "anthropic",
    label: "Anthropic Claude",
    icon: anthropic,
    color: "#D97757",
    glyph: "C",
    patterns: [/anthropic/, /claude/],
  },
  {
    key: "openai",
    label: "OpenAI GPT",
    icon: openai,
    color: "#10A37F",
    glyph: "G",
    patterns: [/openai/, /\bgpt\b/, /\bgpt-/, /gpt/, /\bo[1-4](-|$)/, /chatgpt/, /\bo3\b/, /\bo4\b/, /davinci/, /whisper/],
  },
  {
    key: "google",
    label: "Google Gemini",
    icon: google,
    color: "#4285F4",
    glyph: "G",
    patterns: [/google/, /gemini/, /gemma/, /palm/, /bison/],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    icon: deepseek,
    color: "#4D6BFE",
    glyph: "D",
    patterns: [/deepseek/, /\bds-/, /deepseek-(chat|reasoner|coder|vl|vision)/],
  },
  {
    key: "qwen",
    label: "通义千问 Qwen",
    icon: qwen,
    color: "#615CED",
    glyph: "Q",
    patterns: [/qwen/, /\bqvq\b/, /tongyi/, /dashscope/, /aliyun/, /bailian/],
  },
  {
    key: "volcengine",
    label: "字节豆包 Doubao",
    icon: volcengine,
    color: "#1664FF",
    glyph: "豆",
    patterns: [/doubao/, /volc/, /volcengine/, /seed-1/, /ep-\d/],
  },
  {
    key: "zhipu",
    label: "智谱 GLM",
    icon: zhipu,
    color: "#3859FF",
    glyph: "智",
    patterns: [/glm/, /chatglm/, /zhipu/, /bigmodel/],
  },
  {
    key: "moonshot",
    label: "Moonshot 月之暗面",
    icon: moonshot,
    color: "#0A0A0A",
    glyph: "K",
    patterns: [/moonshot/, /kimi/],
  },
  {
    key: "qianfan",
    label: "百度文心 ERNIE",
    icon: qianfan,
    color: "#2932E1",
    glyph: "文",
    patterns: [/ernie/, /wenxin/, /qianfan/, /baidu/],
  },
  {
    key: "tencent",
    label: "腾讯混元 Hunyuan",
    icon: tencent,
    color: "#0052D9",
    glyph: "混",
    patterns: [/hunyuan/, /tencent/],
  },
  {
    key: "spark",
    label: "讯飞星火 Spark",
    icon: spark,
    color: "#1A6EFF",
    glyph: "星",
    patterns: [/spark/, /xinghuo/, /xf-yun/, /iflytek/],
  },
  {
    key: "minimax",
    label: "MiniMax",
    icon: minimax,
    color: "#FF5D5D",
    glyph: "M",
    patterns: [/minimax/, /\babab/],
  },
  {
    key: "xai",
    label: "xAI Grok",
    icon: xai,
    color: "#000000",
    glyph: "X",
    patterns: [/\bgrok\b/, /grok-/, /\bxai\b/],
  },
  {
    key: "mistral",
    label: "Mistral",
    icon: mistral,
    color: "#FA520F",
    glyph: "M",
    patterns: [/mistral/, /mixtral/, /codestral/],
  },
  {
    key: "siliconflow",
    label: "SiliconFlow 硅基流动",
    icon: siliconflow,
    color: "#7C5CFF",
    glyph: "S",
    patterns: [/siliconflow/, /silicon/],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    icon: openrouter,
    color: "#6467F2",
    glyph: "OR",
    patterns: [/openrouter/],
  },
  {
    key: "groq",
    label: "Groq",
    icon: groq,
    color: "#F55036",
    glyph: "G",
    patterns: [/groq/],
  },
  {
    key: "baidu",
    label: "百度 BAIDU",
    icon: baidu,
    color: "#0866FF",
    glyph: "B",
    patterns: [/baidu/],
  },
  {
    key: "yi",
    label: "零一万物 Yi",
    icon: yi,
    color: "#1B1B1B",
    glyph: "Yi",
    patterns: [/\byi-/, /yi-vision/, /01\.ai/, /lingyi/],
  },
  {
    key: "dashscope",
    label: "阿里云百炼",
    icon: dashscope,
    color: "#3B82F6",
    glyph: "阿",
    patterns: [/dashscope/],
  },
  {
    key: "mock",
    label: "Mock（本地联调）",
    icon: mock,
    color: "#8A8A8A",
    glyph: "M",
    patterns: [/mock/],
  },
  {
    key: "custom",
    label: "自定义（OpenAI 兼容）",
    icon: custom,
    color: "#4B5563",
    glyph: "自",
    patterns: [/^custom$/, /openai-compatible/, /自定义/],
  },
];

/** 匹配文本优先级：提供商名称 > 展示名 > 模型 ID。 */
function haystack(providerName?: string | null, label?: string | null, modelId?: string | null): string {
  return [providerName, label, modelId].filter(Boolean).join(" ").toLowerCase();
}

/** 依据提供商名称 / 模型 id / 名称匹配品牌；无匹配返回 null。 */
export function matchModelBrand(
  modelId: string | null | undefined,
  name?: string | null,
  providerName?: string | null,
): ModelBrand | null {
  const hay = haystack(providerName, name, modelId);
  if (!hay.trim()) return null;
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(hay))) {
      return {
        key: rule.key,
        label: rule.label,
        icon: rule.icon ?? custom,
        color: rule.color,
        glyph: rule.glyph,
      };
    }
  }
  return null;
}

/**
 * 模型/提供商图标。
 * @param modelId 模型 ID（用于回退识别）
 * @param name 展示名（提供商名或模型名，优先参与识别）
 * @param size 边长像素
 */
export function ModelIcon({
  modelId,
  name,
  providerName,
  size = 16,
}: {
  modelId: string;
  name?: string;
  providerName?: string;
  size?: number;
}) {
  const brand = matchModelBrand(modelId, name, providerName);
  if (!brand) return null;
  return (
    <img
      src={brand.icon}
      alt={brand.label}
      title={brand.label}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className="inline-block shrink-0 select-none object-contain"
      style={{ width: size, height: size }}
    />
  );
}
