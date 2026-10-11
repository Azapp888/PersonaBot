import { extname } from "node:path";
import type { QQAttachment } from "../types";
import { logger } from "../logger";
import { settingsService } from "../settings/service";

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

async function download(url: string, maxBytes: number): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载失败 ${res.status}`);
    const lenHeader = Number(res.headers.get("content-length") ?? "0");
    if (lenHeader && lenHeader > maxBytes) throw new Error(`文件过大（${Math.round(lenHeader / 1024)}KB）`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error(`文件过大（${Math.round(buf.length / 1024)}KB）`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
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
