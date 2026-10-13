import { resolveProviderForPersona } from "../llm/factory";
import { memoryRepo } from "../db/repos/memories";
import { settingsService } from "../settings/service";
import { timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { formatDate } from "../utils/id";
import { truncate } from "../utils/json";
import type { ChatMessage, MemoryKind, Persona } from "../types";

/**
 * 实时记忆：在对话进行中就把「值得长期记住」的信息落库，不必等到每日记忆整理。
 * 通过「信号词 + 长度」做低成本门控，只有疑似含关键信息的消息才触发一次轻量 LLM 抽取，
 * 命中后立即写入 type=fact，走核心记忆注入，下一轮即可被想起。
 */

const SIGNAL_WORDS = [
  "约定",
  "约好",
  "答应",
  "说好",
  "以后",
  "每次",
  "每周",
  "每天",
  "生日",
  "纪念日",
  "喜欢",
  "最爱",
  "讨厌",
  "害怕",
  "习惯",
  "过敏",
  "忌口",
  "称呼",
  "叫我",
  "住在",
  "搬到",
  "上班",
  "上学",
  "考试",
  "面试",
  "生病",
  "住院",
  "记住",
  "别忘了",
  "提醒我",
  "重要",
  "第一次",
  "分手",
  "在一起",
  "吵架",
  "生日",
];

const REALTIME_SYSTEM = `你是一个长期记忆提炼助手。请判断这轮对话里，用户是否表达了值得角色长期记住的信息。
值得记住的包括：约定/承诺、稳定偏好或忌讳、称呼、重要客观事实（住址/职业/学业/健康/关系）、对关系有影响的事件。
一次性寒暄、日常情绪波动、无信息量的闲聊都不算。

对每条值得记住的信息输出：
- text：第三人称、客观、单句、60 字以内，保留关键细节；
- importance：1-10 的重要性评分；
- kind：agreement(约定/承诺) | preference(稳定偏好/忌讳/称呼) | fact(稳定客观事实) | event(重要事件) | trivial(琐事)；
- pinned：是否必须永久记住。

规则：约定、承诺、纪念日、专属称呼 → agreement/preference，pinned=true，importance>=8；稳定偏好、忌讳 → preference，pinned=true，importance>=7；重要事件 → event，importance>=6。没有值得记住的内容就返回空数组。
只输出 JSON，不要解释或代码块：
{"facts":[{"text":"","importance":5,"kind":"event","pinned":false}]}`;

const KINDS: MemoryKind[] = ["agreement", "preference", "fact", "event", "trivial"];

function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** 低成本门控：短消息或未命中任何信号词时直接跳过，避免每轮都调 LLM。 */
export function shouldExtract(userText: string): boolean {
  const text = userText.trim();
  if (text.length < 8) return false;
  return SIGNAL_WORDS.some((w) => text.includes(w));
}

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
      /* try next */
    }
  }
  return null;
}

export interface RealtimeFact {
  text: string;
  importance: number;
  kind: MemoryKind;
  pinned: boolean;
}

/** 与已有事实做近似去重：归一化后一方包含另一方即视为重复。 */
function isDuplicate(text: string, existing: string[]): boolean {
  const n = normalize(text);
  if (!n) return true;
  return existing.some((e) => {
    const m = normalize(e);
    return m === n || m.includes(n) || n.includes(m);
  });
}

/**
 * 从一轮对话中提炼原子事实。用户消息必须命中门控信号词才会真正调用模型。
 * 失败时返回空数组，绝不影响主流程。
 */
export async function extractRealtimeFacts(
  persona: Persona,
  userText: string,
  replyText: string,
): Promise<RealtimeFact[]> {
  const settings = settingsService.get();
  if (!settings.realtimeFactEnabled) return [];
  if (!shouldExtract(userText)) return [];

  try {
    const { provider } = resolveProviderForPersona(persona);
    const messages: ChatMessage[] = [
      { role: "system", content: REALTIME_SYSTEM },
      {
        role: "user",
        content: `${timeContextLine(settings.timezone)}\n【用户】${userText}\n【角色】${replyText}`,
      },
    ];
    const result = await provider.chat(messages, { temperature: 0.2, maxTokens: 600 });
    const parsed = extractJson(result.content);
    const list = Array.isArray(parsed?.facts) ? parsed.facts : [];
    return list
      .map((item: any) => {
        const text = String(item?.text ?? "").trim();
        const kind: MemoryKind = KINDS.includes(item?.kind) ? item.kind : "event";
        const importance = Math.max(1, Math.min(10, Math.round(Number(item?.importance) || 5)));
        const pinned = item?.pinned === true || kind === "agreement" || importance >= 8;
        return { text: truncate(text, 120), importance, kind, pinned };
      })
      .filter((f: RealtimeFact) => f.text.length >= 4)
      .filter((f: RealtimeFact) => f.kind !== "trivial")
      .slice(0, 3);
  } catch (err) {
    logger.warn({ personaId: persona.id, err: (err as Error).message }, "realtime fact extraction failed");
    return [];
  }
}

/**
 * 实时记忆的完整流程：门控 → 抽取 → 去重 → 落库。
 * 由 pipeline 在回复完成后异步调用，不阻塞回复。
 * 返回新增的条数。
 */
export async function captureRealtimeFacts(
  persona: Persona,
  userId: string,
  userText: string,
  replyText: string,
): Promise<number> {
  const settings = settingsService.get();
  if (!settings.realtimeFactEnabled) return 0;

  const sourceDate = formatDate();
  const todaysFacts = memoryRepo.listFactsByDate(persona.id, userId, sourceDate);
  // 单用户当日实时事实上限，防止异常刷写
  const dailyCap = Math.max(1, settings.memoryCoreMaxFacts);
  if (todaysFacts.length >= dailyCap) return 0;

  const facts = await extractRealtimeFacts(persona, userText, replyText);
  if (!facts.length) return 0;

  const recent = memoryRepo.listByUser(persona.id, userId).filter((m) => m.type === "fact");
  const existing = recent.map((m) => m.content);

  let created = 0;
  for (const fact of facts) {
    if (todaysFacts.length + created >= dailyCap) break;
    if (isDuplicate(fact.text, existing)) continue;
    memoryRepo.create({
      personaId: persona.id,
      userId,
      type: "fact",
      content: fact.text,
      sourceDate,
      importance: fact.importance,
      pinned: fact.pinned,
      kind: fact.kind,
      origin: "realtime",
    });
    existing.push(fact.text);
    created++;
  }
  return created;
}
