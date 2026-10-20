import type { QQAttachment } from "../types";

/**
 * QQ 开放平台（Bot API v2）富媒体能力与约束。
 *
 * 这里的常量来自 QQ 开放平台的官方说明，作为「读图」链路的硬约束，
 * 参照 Qwen Code 等开源实现的同类参数：
 * - 单张图片最大 8MB，视频最大 20MB；
 * - 单条消息最多处理 5 个附件；
 * - 纯媒体消息没有文本，需要用占位符起一轮对话；
 * - 图片作为视觉输入交给模型，因此只有声明支持读图的模型才会真正收到图片。
 */
export const QQ_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const QQ_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
export const QQ_MAX_ATTACHMENTS = 5;

/** 图片扩展名白名单（QQ 富媒体 file_type=1 为图片）。 */
export const QQ_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

/**
 * 是否属于 QQ 平台的图片附件（按 content_type 或文件名）。
 *
 * QQ 不一定按标准 MIME 上报图片，可能只有 `image` 前缀（没有 `/子类型`），
 * 也可能完全不报 MIME；此时退化为扩展名判断。
 */
export function isQQImageAttachment(att: QQAttachment): boolean {
  const mime = (att.contentType ?? "").trim().toLowerCase();
  if (mime.startsWith("image")) return true;
  const name = (att.filename ?? att.url ?? "").split("?")[0];
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return QQ_IMAGE_EXTENSIONS.has(ext);
}

/** QQ 有时下发不带协议头的媒体地址，补全为可直接下载的 https URL。 */
export function normalizeMediaUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

/** 纯媒体消息在送入模型前使用的占位符（对齐 QQ 平台的 (image)/(file) 约定）。 */
export function mediaPlaceholder(attachments: QQAttachment[] | undefined): string | null {
  if (!attachments?.length) return null;
  const hasImage = attachments.some(isQQImageAttachment);
  return hasImage ? "(image)" : "(file)";
}

/** 按平台上限截断附件数量（默认最多 5 个）。 */
export function limitAttachments<T>(attachments: T[], max = QQ_MAX_ATTACHMENTS): T[] {
  return attachments.length > max ? attachments.slice(0, max) : attachments;
}

export interface QQImageIntake {
  /** 可交给多模态模型的图片附件（已按图片类型筛选并截断到平台上限）。 */
  images: QQAttachment[];
  /** 超出平台上限被忽略的数量。 */
  overflow: number;
}

/** 从附件中挑选可读图片，并按 QQ 平台约束（仅图片、最多 5 个）收敛。 */
export function pickQQImages(attachments: QQAttachment[] | undefined): QQImageIntake {
  const all = (attachments ?? []).filter((a) => !!a.url && isQQImageAttachment(a));
  const images = limitAttachments(all);
  return { images, overflow: all.length - images.length };
}
