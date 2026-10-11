import { resolveProviderForPersona } from "../llm/factory";
import type { ChatMessage, Persona } from "../types";
import { logRepo } from "../db/repos/logs";
import { memoryRepo } from "../db/repos/memories";
import { settingsService } from "../settings/service";
import { timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { formatDate, addDays } from "../utils/id";
import { truncate } from "../utils/json";

async function summarize(persona: Persona, systemPrompt: string, userContent: string): Promise<string> {
  const { provider } = resolveProviderForPersona(persona);
  const settings = settingsService.get();
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `${timeContextLine(settings.timezone)}\n（请基于上述真实时间理解相对日期与时间关系）\n\n${userContent}` },
  ];
  const result = await provider.chat(messages, { temperature: 0.3, maxTokens: 1600 });
  return result.content.trim();
}

function transcript(personaId: string, userId: string, since: number, until: number): string {
  const rows = logRepo.allMessagesBetween(personaId, userId, since, until);
  if (!rows.length) return "";
  return rows
    .map((r: any) => {
      const who = r.direction === "in" ? "用户" : "角色";
      return `[${formatDate(r.created_at)}] ${who}: ${r.content}`;
    })
    .join("\n");
}

const DAILY_SYSTEM = `你是一个记忆整理助手。请把给定的一天聊天记录整理成一份清晰、客观、信息密度高的日记忆。
要求：
1. 记录用户说了什么、角色如何回应；
2. 提炼用户的行为模式、习惯线索、情绪走向、当天主要话题；
3. 保留关键事实（人名、地点、约定、偏好、重要事件），不要遗漏；
4. 用第三人称陈述，按时间顺序组织，不要编造不存在的内容；
5. 输出纯文本 Markdown，控制在 400 字以内。`;

const THREE_DAY_SYSTEM = `你是一个记忆整合助手。请把过去三天的日记忆整合为一份"三日记忆"。
要求：保留重要事实与情感线，合并重复信息，突出关系变化与持续话题，控制在 400 字以内。`;

const BIWEEKLY_SYSTEM = `你是一个记忆压缩助手。请把过去两周的记忆压缩为一份精简的中期记忆。
要求：只保留对长期关系有影响的关键信息与情感基调，控制在 300 字以内。`;

const MONTHLY_SYSTEM = `你是一个长期记忆整合助手。请把过去一个月的两周精简记忆汇总为一份长期记忆。
要求：提炼稳定的关系模式、用户长期偏好与重要里程碑，控制在 400 字以内。`;

export async function generateDailyMemory(persona: Persona, userId: string, date: Date = addDays(new Date(), -1)): Promise<string | null> {
  const since = new Date(date);
  since.setHours(0, 0, 0, 0);
  const until = new Date(since);
  until.setDate(until.getDate() + 1);
  const text = transcript(persona.id, userId, since.getTime(), until.getTime());
  if (!text) return null;
  const sourceDate = formatDate(date);
  let content: string;
  try {
    content = await summarize(persona, DAILY_SYSTEM, `日期：${sourceDate}\n\n聊天记录：\n${text}`);
  } catch (err) {
    logger.warn({ personaId: persona.id, userId, err: (err as Error).message }, "daily summary LLM failed, fallback");
    content = `# ${sourceDate} 日记忆（自动摘录）\n\n${truncate(text, 800)}`;
  }
  memoryRepo.upsert({ personaId: persona.id, userId, type: "daily", content, sourceDate });
  return content;
}

export async function generateThreeDayMemory(persona: Persona, userId: string, endDate: Date = new Date()): Promise<string | null> {
  const since = addDays(endDate, -3).getTime();
  const dailies = memoryRepo.listByTypeSince(persona.id, userId, "daily", since);
  if (dailies.length < 1) return null;
  const text = dailies.map((m) => `## ${m.sourceDate}\n${m.content}`).join("\n\n");
  const sourceDate = `${formatDate(addDays(endDate, -2))} ~ ${formatDate(endDate)}`;
  let content: string;
  try {
    content = await summarize(persona, THREE_DAY_SYSTEM, text);
  } catch {
    content = truncate(text, 800);
  }
  memoryRepo.upsert({ personaId: persona.id, userId, type: "three_day", content, sourceDate });
  return content;
}

export async function generateBiweeklyMemory(persona: Persona, userId: string, endDate: Date = new Date()): Promise<string | null> {
  const since = addDays(endDate, -14).getTime();
  const items = [
    ...memoryRepo.listByTypeSince(persona.id, userId, "daily", since),
    ...memoryRepo.listByTypeSince(persona.id, userId, "three_day", since),
  ];
  if (!items.length) return null;
  const text = items.map((m) => `## ${m.sourceDate}\n${m.content}`).join("\n\n");
  const sourceDate = `${formatDate(addDays(endDate, -13))} ~ ${formatDate(endDate)}`;
  let content: string;
  try {
    content = await summarize(persona, BIWEEKLY_SYSTEM, text);
  } catch {
    content = truncate(text, 700);
  }
  memoryRepo.upsert({ personaId: persona.id, userId, type: "biweekly", content, sourceDate });
  return content;
}

export async function generateMonthlyMemory(persona: Persona, userId: string, endDate: Date = new Date()): Promise<string | null> {
  const items = memoryRepo.listByPersona(persona.id).filter((m) => m.userId === userId && m.type === "biweekly");
  if (!items.length) return null;
  const text = items.map((m) => `## ${m.sourceDate}\n${m.content}`).join("\n\n");
  const sourceDate = formatDate(endDate);
  let content: string;
  try {
    content = await summarize(persona, MONTHLY_SYSTEM, text);
  } catch {
    content = truncate(text, 800);
  }
  memoryRepo.upsert({ personaId: persona.id, userId, type: "monthly", content, sourceDate });
  return content;
}

export const summarizer = {
  DAILY_SYSTEM,
  THREE_DAY_SYSTEM,
  BIWEEKLY_SYSTEM,
  MONTHLY_SYSTEM,
};
