import { resolveProviderForPersona } from "../llm/factory";
import type { ChatMessage, Persona } from "../types";
import { memoryRepo } from "../db/repos/memories";
import { settingsService } from "../settings/service";
import { timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { formatDate } from "../utils/id";
import { truncate } from "../utils/json";

export interface ImportedEntry {
  sourceDate: string;
  content: string;
}

const IMPORT_SYSTEM = `你是一个记忆整理助手。用户上传了与角色「{name}」过往交流 / 记录的原始文本，请阅读并提炼成高质量的长期记忆条目。

要求：
1. 只保留对角色理解用户、维持长期关系有帮助的信息：重要事实、事件、约定、承诺、用户偏好与忌讳、称呼与昵称、关系进展与情感变化等；
2. 不要编造原文不存在的内容，剔除寒暄与无意义的闲聊；
3. 若文本中能识别出明确的日期或时间线索，写入 date 字段（格式 YYYY-MM-DD），否则 date 留空字符串；
4. 可将内容拆分为 1-5 条主题明确的记忆，每条 content 用第三人称、客观、信息密度高、200 字以内；
5. 严格只输出 JSON，不要输出任何解释、前言或 Markdown 代码块。

输出格式：
{"entries":[{"date":"","title":"简短主题","content":"记忆正文"}]}`;

/** 按行边界把长文本切成若干块，避免超出模型上下文。 */
function chunkText(text: string, size = 6000): string[] {
  const lines = text.split("\n");
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    if (current.length + line.length + 1 > size && current) {
      chunks.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** 从模型输出中稳健地提取 JSON 对象（容忍 ```json 代码块与多余文字）。 */
function extractJson(raw: string): any | null {
  const cleaned = raw.replace(/```json/gi, "```");
  const segments = [raw, ...cleaned.split("```")];
  for (const segment of segments) {
    const start = segment.indexOf("{");
    const end = segment.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(segment.slice(start, end + 1));
    } catch {
      /* try next segment */
    }
  }
  return null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 使用角色绑定的模型解析上传的记忆文本，产出结构化的记忆条目。
 * 解析失败时退化为直接保存该段原文，确保不丢数据。
 */
export async function analyzeImportedText(
  persona: Persona,
  userId: string,
  filename: string,
  raw: string,
): Promise<ImportedEntry[]> {
  const text = (raw ?? "").trim();
  if (!text) return [];

  const { provider } = resolveProviderForPersona(persona);
  const tz = settingsService.get().timezone;
  const chunks = chunkText(text);
  const entries: ImportedEntry[] = [];

  for (const piece of chunks) {
    let parsed: any = null;
    try {
      const messages: ChatMessage[] = [
        { role: "system", content: IMPORT_SYSTEM.replace("{name}", persona.name) },
        { role: "user", content: `${timeContextLine(tz)}\n（请据此推断文本中的相对日期；无法确定的日期留空）\n\n文件名：${filename}\n\n原始文本：\n${piece}` },
      ];
      const result = await provider.chat(messages, { temperature: 0.2, maxTokens: 2000 });
      parsed = extractJson(result.content);
    } catch (err) {
      logger.warn({ personaId: persona.id, userId, err: (err as Error).message }, "memory import LLM failed, fallback");
    }

    const list = Array.isArray(parsed?.entries) ? parsed.entries : null;
    if (list && list.length) {
      for (const item of list) {
        const content = String(item?.content ?? "").trim();
        if (!content) continue;
        const title = String(item?.title ?? "").trim();
        const date = String(item?.date ?? "").trim();
        entries.push({
          sourceDate: DATE_RE.test(date) ? date : formatDate(new Date()),
          content: title ? `**${title}**\n${content}` : content,
        });
      }
    } else {
      entries.push({ sourceDate: formatDate(new Date()), content: truncate(piece, 1500) });
    }
  }

  return entries;
}

/** 将解析结果写入记忆表（type=imported，可累积多条）。 */
export function persistImported(personaId: string, userId: string, entries: ImportedEntry[]): number {
  for (const entry of entries) {
    memoryRepo.create({ personaId, userId, type: "imported", content: entry.content, sourceDate: entry.sourceDate });
  }
  return entries.length;
}
