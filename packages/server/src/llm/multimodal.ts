import type { ChatMessage, ContentPart, ImageContentPart } from "../types";
import { LLMError } from "./provider";

/**
 * 图片输入的统一处理与厂商适配。
 *
 * 各厂商对图片的承载方式不同：
 * - OpenAI 兼容（OpenAI / DeepSeek / 豆包 / 通义千问兼容模式）：
 *   content 数组 + {type:"image_url",image_url:{url,detail?}}，
 *   url 可以是 https 地址或 data:image/...;base64,...。
 * - Anthropic Claude Messages：{type:"image",source:{type:"base64",media_type,data}}
 *   或 {type:"image",source:{type:"url",url}}。
 * - Google Gemini 原生 generateContent：{inline_data:{mime_type,data}}，
 *   data 为不带 data: 前缀的纯 base64。
 *
 * 这里把「格式校验」和「协议转换」集中到一处，避免各适配器各自猜测。
 */

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const ALL_IMAGE_MIMES: SupportedImageMime[] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export interface ImageLimit {
  /** 单张图片最大字节数 */
  maxBytes: number;
  /** 该厂商支持的图片 MIME */
  mimes: SupportedImageMime[];
  /** 该厂商是否支持把公网 https URL 直接交给上游（否则需要先下载转 base64） */
  supportsRemoteUrl: boolean;
}

const MB = 1024 * 1024;

/**
 * 厂商图片限制。数值来自官方文档的保守值：
 * - OpenAI：单图 20MB，PNG/JPEG/WEBP/GIF（GIF 需非动画）。
 * - Anthropic：单图 5MB，PNG/JPEG/GIF/WEBP。
 * - Gemini：内联请求约 20MB，PNG/JPEG/WEBP。
 * - DeepSeek：视觉模型支持 base64 / URL / Files API。
 * - 通义千问兼容模式：单图 20MB，JPEG/PNG/WEBP。
 *
 * QQ 平台自身还有 8MB 上限，这里取更严格的一方。
 */
export function imageLimitFor(provider: string | null | undefined): ImageLimit {
  const p = (provider ?? "").toLowerCase();
  if (p.includes("anthropic") || p.includes("claude")) {
    return { maxBytes: 5 * MB, mimes: ALL_IMAGE_MIMES, supportsRemoteUrl: true };
  }
  if (p.includes("google") || p.includes("gemini")) {
    return { maxBytes: 20 * MB, mimes: ["image/png", "image/jpeg", "image/webp"], supportsRemoteUrl: false };
  }
  if (p.includes("deepseek")) {
    return { maxBytes: 10 * MB, mimes: ALL_IMAGE_MIMES, supportsRemoteUrl: true };
  }
  if (p.includes("dashscope") || p.includes("qwen")) {
    return { maxBytes: 20 * MB, mimes: ["image/png", "image/jpeg", "image/webp"], supportsRemoteUrl: true };
  }
  return { maxBytes: 20 * MB, mimes: ALL_IMAGE_MIMES, supportsRemoteUrl: true };
}

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * 按文件头（magic bytes）识别真实图片格式。
 * 不信任上游声明的 Content-Type：QQ / 图床经常把它写成 application/octet-stream
 * 或直接标错，按真实字节判断才能避免把 BMP/SVG/HTML 当成图片送给模型。
 */
export function sniffImageMime(buf: Buffer): SupportedImageMime | null {
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (buf.length >= 6 && buf.toString("ascii", 0, 3) === "GIF") {
    const version = buf.toString("ascii", 0, 6);
    if (version === "GIF87a" || version === "GIF89a") return "image/gif";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

/** 把图片二进制转成 data:URL；格式不受支持时抛错。 */
export function toImageDataUrl(buf: Buffer): { dataUrl: string; mediaType: SupportedImageMime } {
  const mediaType = sniffImageMime(buf);
  if (!mediaType) {
    throw new Error("不支持的图片格式（仅支持 PNG / JPEG / GIF / WebP）");
  }
  return { dataUrl: `data:${mediaType};base64,${buf.toString("base64")}`, mediaType };
}

/** 解析 data:image/...;base64,...；不是 base64 图片时返回 null。 */
export function parseImageDataUrl(url: string): { mediaType: SupportedImageMime; data: string } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  const mediaType = match[1].toLowerCase() as SupportedImageMime;
  if (!ALL_IMAGE_MIMES.includes(mediaType)) return null;
  return { mediaType, data: match[2] };
}

function assertSupported(mime: string, supported: SupportedImageMime[]): asserts mime is SupportedImageMime {
  if (!supported.includes(mime as SupportedImageMime)) {
    throw new LLMError(`当前模型不支持 ${mime} 图片（支持：${supported.join(" / ")}）`, 400);
  }
}

/** OpenAI 兼容协议：原样保留 image_url，缺省 detail 用 auto。 */
export function toOpenAIPart(part: ImageContentPart): Record<string, unknown> {
  return {
    type: "image_url",
    image_url: { url: part.image_url.url, detail: part.image_url.detail ?? "auto" },
  };
}

/** Anthropic Messages：data URL -> base64 source；https -> url source。 */
export function toAnthropicImageBlock(
  part: ImageContentPart,
  supported: SupportedImageMime[] = ALL_IMAGE_MIMES,
): Record<string, unknown> {
  const url = part.image_url.url;
  const parsed = parseImageDataUrl(url);
  if (parsed) {
    assertSupported(parsed.mediaType, supported);
    return { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } };
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: "image", source: { type: "url", url } };
  }
  throw new LLMError("Anthropic 仅支持 data:image/*;base64 或公网 https 图片", 400);
}

/** Gemini 原生：data URL -> inline_data（纯 base64，不带前缀）。 */
export function toGeminiPart(
  part: ImageContentPart,
  supported: SupportedImageMime[] = ["image/png", "image/jpeg", "image/webp"],
): Record<string, unknown> {
  const parsed = parseImageDataUrl(part.image_url.url);
  if (!parsed) {
    throw new LLMError("Gemini 原生接口需要 data:image/*;base64 图片，请先下载并转 base64", 400);
  }
  assertSupported(parsed.mediaType, supported);
  return { inline_data: { mime_type: parsed.mediaType, data: parsed.data } };
}

/** 把统一 content 转为 Anthropic content；纯文本保持字符串，兼容性最好。 */
export function toAnthropicContent(content: ChatMessage["content"]): unknown {
  if (typeof content === "string") return content;
  return content.map((p: ContentPart) => {
    if (p.type === "text") return { type: "text", text: p.text };
    return toAnthropicImageBlock(p);
  });
}
