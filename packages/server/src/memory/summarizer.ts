import { resolveProviderForPersona } from "../llm/factory";
import type { ChatMessage, MemoryKind, Persona } from "../types";
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

const FACTS_SYSTEM = `你是一个长期记忆提炼助手。请从给定的一整天聊天记录中，提炼出值得角色长期记住的「原子事实」。
对每条事实输出：
- text：第三人称、客观、单句、60 字以内，保留关键细节（人名、地点、时间、约定、偏好、称呼、忌讳、情绪触发点）；
- importance：1-10 的重要性评分；
- kind：agreement(约定/承诺) | preference(稳定偏好/忌讳/称呼) | fact(稳定客观事实) | event(当日事件) | trivial(一次性琐事)；
- pinned：是否必须永久记住。

打分与标记规则：
1. 约定、承诺、纪念日、专属称呼 → kind=agreement 或 preference，pinned=true，importance>=8；
2. 稳定的个人偏好、忌讳、习惯（如爱吃什么、作息、害怕什么）→ kind=preference，pinned=true，importance>=7；
3. 对关系有影响的重要事件（重要决定、争吵和解、重大变化）→ kind=event，importance>=6；
4. 一次性寒暄、日常情绪波动、无关琐事 → kind=trivial，importance<=3，pinned=false。

宁可少而准，不要编造。严格只输出 JSON，不要任何解释或代码块：
{"facts":[{"text":"","importance":5,"kind":"event","pinned":false}]}`;

const THREE_DAY_SYSTEM = `你是一个记忆整合助手。请把过去三天的日记忆整合为一份"三日记忆"。
要求：保留重要事实与情感线，合并重复信息，突出关系变化与持续话题，控制在 400 字以内。`;

const BIWEEKLY_SYSTEM = `你是一个记忆压缩助手。请把过去两周的记忆压缩为一份精简的中期记忆。
要求：只保留对长期关系有影响的关键信息与情感基调，控制在 300 字以内。`;

const MONTHLY_SYSTEM = `你是一个长期记忆整合助手。请把过去一个月的两周精简记忆汇总为一份长期记忆。
要求：提炼稳定的关系模式、用户长期偏好与重要里程碑，控制在 400 字以内。`;

export interface DailyFact {
  text: string;
  importance: number;
  kind: MemoryKind;
  pinned: boolean;
}

const KINDS: MemoryKind[] = ["agreement", "preference", "fact", "event", "trivial"];

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

/**
 * 从一天的聊天记录中提炼原子事实（带重要性 / 类型 / 是否永久保留）。
 * 约定、承诺、稳定偏好默认受保护（pinned=true）。
 * 解析失败或模型不可用时返回空数组，不影响日记忆生成。
 */
async function extractFacts(persona: Persona, transcript: string, sourceDate: string): Promise<DailyFact[]> {
  if (!transcript.trim()) return [];
  try {
    const { provider } = resolveProviderForPersona(persona);
    const settings = settingsService.get();
    const result = await provider.chat(
      [
        { role: "system", content: FACTS_SYSTEM },
        { role: "user", content: `${timeContextLine(settings.timezone)}\n日期：${sourceDate}\n\n聊天记录：\n${transcript}` },
      ],
      { temperature: 0.2, maxTokens: 1600 },
    );
    const parsed = extractJson(result.content);
    const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
    const facts: DailyFact[] = [];
    for (const item of list) {
      const text = String(item?.text ?? "").trim();
      if (!text) continue;
      const kind: MemoryKind = KINDS.includes(item?.kind) ? item.kind : "event";
      const importance = Math.max(1, Math.min(10, Math.round(Number(item?.importance) || 5)));
      // 约定 / 稳定偏好 / 高重要性默认受保护，即使模型漏标 pinned 也兜底
      const pinned = item?.pinned === true || kind === "agreement" || importance >= 8;
      facts.push({ text: truncate(text, 120), importance, kind, pinned });
    }
    return facts;
  } catch (err) {
    logger.warn({ personaId: persona.id, err: (err as Error).message }, "daily fact extraction failed, skip facts");
    return [];
  }
}

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

  // 提炼原子事实并落库：日记忆会被剪枝，原子事实按重要性长期保留
  const facts = await extractFacts(persona, text, sourceDate);
  if (facts.length) {
    // 只清理同日的「每日整理」事实，保留实时记忆写入的事实
    memoryRepo.removeByTypeDate(persona.id, userId, "fact", sourceDate, "daily");
    for (const fact of facts) {
      memoryRepo.create({
        personaId: persona.id,
        userId,
        type: "fact",
        content: fact.text,
        sourceDate,
        importance: fact.importance,
        pinned: fact.pinned,
        kind: fact.kind,
        origin: "daily",
      });
    }
  }
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
