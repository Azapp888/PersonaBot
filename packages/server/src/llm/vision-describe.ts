import type { ContentPart, ImageContentPart } from "../types";
import { resolveVisionFallbackProvider } from "./factory";
import { logger } from "../logger";

/**
 * 当主模型不支持读图时，用专用视觉副模型先把图片转述成文本，
 * 再把转述注入主模型上下文。这样主模型仍是纯文本模型也能「看懂」图片。
 */
export const VISION_DESCRIBE_SYSTEM = `你是一个视觉转述助手。请客观、具体地描述用户发来的图片，供一个看不见图片的角色使用。

要求：
1. 描述场景、人物/物体、动作、外观、颜色、构图与明显情绪；
2. 如果图中有文字（截图、聊天记录、文档、路牌等），逐字转写关键文字；
3. 如果是表情包/梗图，说明画面内容与常见含义；
4. 只描述看得见的内容，不要编造背景故事，不要评价用户；
5. 用第三人称、条理清晰，控制在 400 字以内。`;

export interface ImageDescription {
  text: string;
  modelId: string;
  modelName: string;
}

export interface DescribeImagesOptions {
  /** 主模型 id：自动选择副模型时避免选到同一个。 */
  primaryModelId?: string | null;
  signal?: AbortSignal;
}

/**
 * 把图片转述为文本。没有可用视觉模型、调用失败或返回空时返回 null，
 * 由调用方决定是提示用户还是继续用纯文本回复。
 */
export async function describeImagesWithFallback(
  images: ImageContentPart[],
  opts: DescribeImagesOptions = {},
): Promise<ImageDescription | null> {
  if (!images.length) return null;
  const resolved = resolveVisionFallbackProvider(opts.primaryModelId);
  if (!resolved) {
    logger.info("no vision fallback model available");
    return null;
  }

  const parts: ContentPart[] = [
    { type: "text", text: `请转述用户发来的这 ${images.length} 张图片。` },
    ...images,
  ];

  try {
    const result = await resolved.provider.chat(
      [
        { role: "system", content: VISION_DESCRIBE_SYSTEM },
        { role: "user", content: parts },
      ],
      { temperature: 0.2, maxTokens: 800, signal: opts.signal },
    );
    const text = result.content.trim();
    if (!text) {
      logger.warn({ modelId: resolved.model.id }, "vision fallback returned empty description");
      return null;
    }
    logger.info(
      { modelId: resolved.model.id, model: resolved.model.modelId, images: images.length, chars: text.length },
      "images described by vision fallback model",
    );
    return {
      text: text.slice(0, 2000),
      modelId: resolved.model.id,
      modelName: resolved.model.name,
    };
  } catch (err) {
    logger.warn(
      { modelId: resolved.model.id, err: (err as Error).message },
      "vision fallback description failed",
    );
    return null;
  }
}
