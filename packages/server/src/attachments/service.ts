import { extname } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ImageContentPart, QQAttachment } from "../types";
import { logger } from "../logger";
import { settingsService } from "../settings/service";
import { fetchWithTimeout } from "../utils/http";
import { imageLimitFor, toImageDataUrl, type ImageLimit, type SupportedImageMime } from "../llm/multimodal";
import { isQQImageAttachment, normalizeMediaUrl } from "../qq/capabilities";

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

/** IPv4 是否落在私网/环回/链路本地等保留段。 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // 链路本地（含云元数据 169.254.169.254）
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "::" ||
    h === "::1" ||
    h.startsWith("fe80") || // 链路本地
    h.startsWith("fc") ||
    h.startsWith("fd") || // ULA fc00::/7
    h.startsWith("::ffff:127.") ||
    h.startsWith("::ffff:10.") ||
    h.startsWith("::ffff:192.168.")
  );
}

/**
 * SSRF 防护：校验下载目标为公网 http(s) 地址。
 * 主机名先经 DNS 解析，再对解析出的每个地址做私网判定，防止 DNS rebinding 绕过。
 */
async function assertPublicHttpUrl(raw: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("非法的下载地址");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅允许 http(s) 下载地址");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new Error("不允许访问内网地址");
  }
  const literal = isIP(host);
  if (literal === 4) {
    if (isPrivateIPv4(host)) throw new Error("不允许访问内网地址");
    return;
  }
  if (literal === 6) {
    if (isPrivateIPv6(host)) throw new Error("不允许访问内网地址");
    return;
  }
  let resolved: { address: string }[];
  try {
    resolved = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("下载地址无法解析");
  }
  for (const { address } of resolved) {
    if (
      (isIP(address) === 4 && isPrivateIPv4(address)) ||
      (isIP(address) === 6 && isPrivateIPv6(address))
    ) {
      throw new Error("不允许访问内网地址");
    }
  }
}

/** 下载图片并转为 data:URL（base64），供多模态模型读取。 */
export async function downloadImageAsDataUrl(
  url: string,
  maxBytes: number,
): Promise<{ dataUrl: string; mediaType: SupportedImageMime }> {
  const target = normalizeMediaUrl(url);
  if (!target) throw new Error("缺少下载地址");
  await assertPublicHttpUrl(target);
  const res = await fetchWithTimeout(target, { timeoutMs: 15000 });
  if (!res.ok) throw new Error(`下载失败 ${res.status}`);
  const lenHeader = Number(res.headers.get("content-length") ?? "0");
  if (lenHeader && lenHeader > maxBytes) throw new Error(`图片过大（${Math.round(lenHeader / 1024)}KB）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new Error(`图片过大（${Math.round(buf.length / 1024)}KB）`);
  // 以文件头为准：上游 Content-Type 可能缺失或标错（QQ 常给 application/octet-stream）。
  const { dataUrl, mediaType } = toImageDataUrl(buf);
  return { dataUrl, mediaType };
}

/**
 * 下载用户发来的图片（仅 contentType 为 image/* 或图片扩展名的附件），
 * 转为可注入多模态消息的 data:URL。非图片、格式不支持、超出厂商上限会被跳过。
 */
export async function buildImageParts(
  attachments: QQAttachment[] | undefined,
  limit: ImageLimit = imageLimitFor("custom"),
): Promise<{ parts: ImageContentPart[]; skipped: { name: string; reason: string }[] }> {
  const parts: ImageContentPart[] = [];
  const skipped: { name: string; reason: string }[] = [];
  if (!attachments?.length) return { parts, skipped };
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const name = fileNameOf(att, i);
    if (!att.url || !isQQImageAttachment(att)) continue;
    try {
      const { dataUrl, mediaType } = await downloadImageAsDataUrl(att.url, limit.maxBytes);
      if (!limit.mimes.includes(mediaType)) {
        throw new Error(`当前模型不支持 ${mediaType}（支持：${limit.mimes.join(" / ")}）`);
      }
      parts.push({ type: "image_url", image_url: { url: dataUrl, detail: "auto" } });
    } catch (err) {
      const reason = (err as Error).message || "处理失败";
      logger.warn({ name, reason }, "image attachment parse failed");
      skipped.push({ name, reason });
    }
  }
  return { parts, skipped };
}

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const target = normalizeMediaUrl(url);
  if (!target) throw new Error("缺少下载地址");
  await assertPublicHttpUrl(target);
  const res = await fetchWithTimeout(target, { timeoutMs: 15000 });
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
