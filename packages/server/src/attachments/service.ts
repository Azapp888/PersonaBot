import { extname } from "node:path";
import type { ImageContentPart, QQAttachment } from "../types";
import { logger } from "../logger";
import { settingsService } from "../settings/service";
import { fetchWithTimeout } from "../utils/http";

/** 可直接按纯文本读取的扩展名白名单 */
const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "mdx", "json", "jsonc", "json5", "csv", "tsv", "log",
  "yaml", "yml", "xml", "html", "htm", "ini", "toml", "conf", "cfg", "env",
  "sql", "sh", "bash", "zsh", "py", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "java", "go", "rs", "c", "h", "cpp", "hpp", "cc", "cs", "php", "rb", "kt",
  "swift", "lua", "r", "m", "gradle", "properties", "bat", "ps1", "diff", "patch",
]);

const TEXT_MIME_PREFIXES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-javascript",
  "application/x-yaml",
  "application/yaml",
  "application/x-httpd-php",
  "application/sql",
];

const PER_FILE_CHARS = 6000;
const TOTAL_CHARS = 14000;

export interface ParsedFile {
  name: string;
  content: string;
  truncated: boolean;
}

export interface FileContextResult {
  files: ParsedFile[];
  skipped: { name: string; reason: string }[];
}

function fileNameOf(att: QQAttachment, index: number): string {
  if (att.filename && att.filename.trim()) return att.filename.trim();
  const fromUrl = att.url ? decodeURIComponent(att.url.split("?")[0].split("/").pop() ?? "") : "";
  return fromUrl || `附件${index + 1}`;
}

function isTextLike(att: QQAttachment, name: string): boolean {
  const ext = extname(name).replace(/^\./, "").toLowerCase();
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  const mime = (att.contentType ?? "").toLowerCase();
  if (!mime) return !!ext && TEXT_EXTENSIONS.has(ext);
  if (TEXT_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  // QQ 有时把文件统一标注为 "file"，此时完全依赖扩展名判断
  if (mime === "file" || mime === "application/octet-stream") return !!ext && TEXT_EXTENSIONS.has(ext);
  return false;
}

function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 1024));
  let nulls = 0;
  for (const b of sample) if (b === 0) nulls++;
  return nulls > sample.length * 0.1;
}

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"]);

function isImageLike(att: QQAttachment, name: string): boolean {
  const mime = (att.contentType ?? "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  const ext = extname(name).replace(/^\./, "").toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

/** 下载图片并转为 data:URL（base64），供多模态模型读取。 */
export async function downloadImageAsDataUrl(
  url: string,
  maxBytes: number,
): Promise<{ dataUrl: string; mediaType: string }> {
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  const lenHeader = Number(res.headers.get("content-length") ?? "0");
  if (lenHeader && lenHeader > maxBytes) throw new Error(`图片过大（${Math.round(lenHeader / 1024)}KB）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`图片过大（${Math.round(buf.length / 1024)}KB）`);
  const headerType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const mediaType = headerType.startsWith("image/") ? headerType : "image/jpeg";
  return { dataUrl: `data:${mediaType};base64,${buf.toString("base64")}`, mediaType };
}

/**
 * 下载用户发来的图片（仅 contentType 为 image/* 或图片扩展名的附件），
 * 转为可注入多模态消息的 data:URL。非图片会被忽略。
 */
export async function buildImageParts(
  attachments: QQAttachment[] | undefined,
  maxPerImageBytes: number,
): Promise<{ parts: ImageContentPart[]; skipped: { name: string; reason: string }[] }> {
  const parts: ImageContentPart[] = [];
  const skipped: { name: string; reason: string }[] = [];
  if (!attachments?.length) return { parts, skipped };
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const name = fileNameOf(att, i);
    if (!att.url || !isImageLike(att, name)) continue;
    try {
      const { dataUrl } = await downloadImageAsDataUrl(att.url, maxPerImageBytes);
      parts.push({ type: "image_url", image_url: { url: dataUrl } });
    } catch (err) {
      const reason = (err as Error).message || "处理失败";
      logger.warn({ name, reason }, "image attachment parse failed");
      skipped.push({ name, reason });
    }
  }
  return { parts, skipped };
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const res = await fetchWithTimeout(url, { timeoutMs: 15000 });
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  const lenHeader = Number(res.headers.get("content-length") ?? "0");
  if (lenHeader && lenHeader > maxBytes) throw new Error(`文件过大（${Math.round(lenHeader / 1024)}KB）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`文件过大（${Math.round(buf.length / 1024)}KB）`);
  return buf;
}

function decode(buf: Buffer): string {
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * 下载并解析用户发来的文本类文件（txt/md/json/csv/log/代码等），
 * 组装为可注入对话上下文的文本块。非文本/超大/下载失败会被跳过并给出原因。
 */
export async function buildFileContext(attachments: QQAttachment[] | undefined): Promise<FileContextResult> {
  const settings = settingsService.get();
  const result: FileContextResult = { files: [], skipped: [] };
  if (!settings.fileHandlingEnabled || !attachments?.length) return result;

  let remaining = TOTAL_CHARS;
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const name = fileNameOf(att, i);
    if (!att.url) {
      result.skipped.push({ name, reason: "缺少下载地址" });
      continue;
    }
    if (!isTextLike(att, name)) {
      result.skipped.push({ name, reason: "暂不支持该文件类型（仅支持文本类）" });
      continue;
    }
    if (remaining <= 0) {
      result.skipped.push({ name, reason: "已达本次文件内容上限" });
      continue;
    }
    try {
      const buf = await download(att.url, settings.fileMaxBytes);
      if (looksBinary(buf)) {
        result.skipped.push({ name, reason: "疑似二进制文件，已跳过" });
        continue;
      }
      let content = decode(buf);
      const limit = Math.min(PER_FILE_CHARS, remaining);
      const truncated = content.length > limit;
      if (truncated) content = content.slice(0, limit);
      remaining -= content.length;
      result.files.push({ name, content, truncated });
    } catch (err) {
      const reason = (err as Error).message || "处理失败";
      logger.warn({ name, reason }, "attachment parse failed");
      result.skipped.push({ name, reason });
    }
  }
  return result;
}

/** 将解析结果渲染为注入给模型的文本块。 */
export function renderFileContext(result: FileContextResult): string {
  const lines: string[] = [];
  for (const f of result.files) {
    lines.push(`【用户上传的文件：${f.name}】`);
    lines.push(f.content + (f.truncated ? "\n…（内容过长已截断）" : ""));
    lines.push("【文件结束】");
  }
  for (const s of result.skipped) {
    lines.push(`（注：用户还上传了 ${s.name}，未能解析：${s.reason}）`);
  }
  return lines.join("\n");
}
