/**
 * 模型/提供商图标：根据「提供商名称 / 模型 ID / 名称」里的关键字自动识别厂商，
 * 内联渲染仓库内置的品牌 SVG 资源（取自开源图标集，单色 currentColor）；
 * 无法识别时回退到轻量的品牌色字母标记。
 *
 * - 图标为本地 SVG，构建期以原始文本内联，不依赖外网、不受 mask 兼容性影响；
 * - 官方图标为单色，内联后按品牌主色着色；
 * - 识别依据优先取「提供商名称」（名称里含 openai / gemini 等即会命中）。
 */

import anthropicSvg from "@/assets/providers/anthropic.svg?raw";
import baiduSvg from "@/assets/providers/baidu.svg?raw";
import customSvg from "@/assets/providers/custom.svg?raw";
import dashscopeSvg from "@/assets/providers/dashscope.svg?raw";
import deepseekSvg from "@/assets/providers/deepseek.svg?raw";
import googleSvg from "@/assets/providers/google.svg?raw";
import groqSvg from "@/assets/providers/groq.svg?raw";
import minimaxSvg from "@/assets/providers/minimax.svg?raw";
import mistralSvg from "@/assets/providers/mistral.svg?raw";
import mockSvg from "@/assets/providers/mock.svg?raw";
import moonshotSvg from "@/assets/providers/moonshot.svg?raw";
import openaiSvg from "@/assets/providers/openai.svg?raw";
import openrouterSvg from "@/assets/providers/openrouter.svg?raw";
import qianfanSvg from "@/assets/providers/qianfan.svg?raw";
import qwenSvg from "@/assets/providers/qwen.svg?raw";
import siliconflowSvg from "@/assets/providers/siliconflow.svg?raw";
import sparkSvg from "@/assets/providers/spark.svg?raw";
import tencentSvg from "@/assets/providers/tencent.svg?raw";
import volcengineSvg from "@/assets/providers/volcengine.svg?raw";
import xaiSvg from "@/assets/providers/xai.svg?raw";
import yiSvg from "@/assets/providers/yi.svg?raw";
import zhipuSvg from "@/assets/providers/zhipu.svg?raw";

export interface ModelBrand {
  /** 品牌标识 key，便于测试与排查。 */
  key: string;
  /** 展示名，用于 tooltip。 */
  label: string;
  /** 内联 SVG 原始文本（单色 currentColor）。 */
  svg: string;
  /** 品牌主色。 */
  color: string;
  /** 回退用的字形（最多 2 个字符，无 SVG 时使用）。 */
  glyph: string;
}

interface BrandRule extends ModelBrand {
  /** 命中该品牌的关键字/正则（对 provider 名、模型 id 与名称做小写后匹配）。 */
  patterns: RegExp[];
}

const RULES: BrandRule[] = [
  {
    key: "anthropic",
    label: "Anthropic Claude",
    svg: anthropicSvg,
    color: "#D97757",
    glyph: "C",
    patterns: [/anthropic/, /claude/],
  },
  {
    key: "openai",
    label: "OpenAI GPT",
    svg: openaiSvg,
    color: "#10A37F",
    glyph: "G",
    patterns: [/openai/, /\bgpt\b/, /\bgpt-/, /gpt/, /\bo[1-4](-|$)/, /chatgpt/, /\bo3\b/, /\bo4\b/, /davinci/, /whisper/],
  },
  {
    key: "google",
    label: "Google Gemini",
    svg: googleSvg,
    color: "#4285F4",
    glyph: "G",
    patterns: [/google/, /gemini/, /gemma/, /palm/, /bison/],
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    svg: deepseekSvg,
    color: "#4D6BFE",
    glyph: "D",
    patterns: [/deepseek/, /\bds-/, /deepseek-(chat|reasoner|coder|vl|vision)/],
  },
  {
    key: "qwen",
    label: "通义千问 Qwen",
    svg: qwenSvg,
    color: "#615CED",
    glyph: "Q",
    patterns: [/qwen/, /\bqvq\b/, /tongyi/, /dashscope/, /aliyun/, /bailian/],
  },
  {
    key: "volcengine",
    label: "字节豆包 Doubao",
    svg: volcengineSvg,
    color: "#1664FF",
    glyph: "豆",
    patterns: [/doubao/, /volc/, /volcengine/, /seed-1/, /ep-\d/],
  },
  {
    key: "zhipu",
    label: "智谱 GLM",
    svg: zhipuSvg,
    color: "#3859FF",
    glyph: "智",
    patterns: [/glm/, /chatglm/, /zhipu/, /bigmodel/],
  },
  {
    key: "moonshot",
    label: "Moonshot 月之暗面",
    svg: moonshotSvg,
    color: "#0A0A0A",
    glyph: "K",
    patterns: [/moonshot/, /kimi/],
  },
  {
    key: "qianfan",
    label: "百度文心 ERNIE",
    svg: qianfanSvg,
    color: "#2932E1",
    glyph: "文",
    patterns: [/ernie/, /wenxin/, /qianfan/, /baidu/],
  },
  {
    key: "tencent",
    label: "腾讯混元 Hunyuan",
    svg: tencentSvg,
    color: "#0052D9",
    glyph: "混",
    patterns: [/hunyuan/, /tencent/],
  },
  {
    key: "spark",
    label: "讯飞星火 Spark",
    svg: sparkSvg,
    color: "#1A6EFF",
    glyph: "星",
    patterns: [/spark/, /xinghuo/, /xf-yun/, /iflytek/],
  },
  {
    key: "minimax",
    label: "MiniMax",
    svg: minimaxSvg,
    color: "#FF5D5D",
    glyph: "M",
    patterns: [/minimax/, /\babab/],
  },
  {
    key: "xai",
    label: "xAI Grok",
    svg: xaiSvg,
    color: "#000000",
    glyph: "X",
    patterns: [/\bgrok\b/, /grok-/, /\bxai\b/],
  },
  {
    key: "mistral",
    label: "Mistral",
    svg: mistralSvg,
    color: "#FA520F",
    glyph: "M",
    patterns: [/mistral/, /mixtral/, /codestral/],
  },
  {
    key: "siliconflow",
    label: "SiliconFlow 硅基流动",
    svg: siliconflowSvg,
    color: "#7C5CFF",
    glyph: "S",
    patterns: [/siliconflow/, /silicon/],
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    svg: openrouterSvg,
    color: "#6467F2",
    glyph: "OR",
    patterns: [/openrouter/],
  },
  {
    key: "groq",
    label: "Groq",
    svg: groqSvg,
    color: "#F55036",
    glyph: "G",
    patterns: [/groq/],
  },
  {
    key: "baidu",
    label: "百度 BAIDU",
    svg: baiduSvg,
    color: "#0866FF",
    glyph: "B",
    patterns: [/baidu/],
  },
  {
    key: "yi",
    label: "零一万物 Yi",
    svg: yiSvg,
    color: "#1B1B1B",
    glyph: "Yi",
    patterns: [/\byi-/, /yi-vision/, /01\.ai/, /lingyi/],
  },
  {
    key: "dashscope",
    label: "阿里云百炼",
    svg: dashscopeSvg,
    color: "#3B82F6",
    glyph: "阿",
    patterns: [/dashscope/],
  },
  {
    key: "mock",
    label: "Mock（本地联调）",
    svg: mockSvg,
    color: "#8A8A8A",
    glyph: "M",
    patterns: [/mock/],
  },
  {
    key: "custom",
    label: "自定义（OpenAI 兼容）",
    svg: customSvg,
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
        svg: rule.svg,
        color: rule.color,
        glyph: rule.glyph,
      };
    }
  }
  return null;
}

/** 把单色 SVG 文本内的 currentColor 替换为品牌色，使其以真实品牌色渲染。 */
function colorizedSvg(svg: string, color: string): string {
  return svg.replace(/currentColor/gi, color).replace(/<title>[\s\S]*?<\/title>/gi, "");
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
  const html = colorizedSvg(brand.svg, brand.color);
  return (
    <span
      role="img"
      aria-label={brand.label}
      title={brand.label}
      className="inline-flex shrink-0 select-none items-center justify-center align-middle [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
