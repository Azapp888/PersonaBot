import { resolveProviderForPersona } from "../llm/factory";
import type { ChatMessage, Persona, UserHabits } from "../types";
import { logRepo } from "../db/repos/logs";
import { profileRepo } from "../db/repos/profiles";
import { settingsService } from "../settings/service";
import { timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { addDays, formatDate } from "../utils/id";

const EXTRACT_SYSTEM = `你是一个用户画像分析助手。请根据聊天记录提取用户的习惯与特征。
只输出 JSON，不要任何解释，格式如下：
{
  "activeHours": ["活跃时段，如 20:00-23:00"],
  "expressions": ["常用表达/口头禅"],
  "interests": ["兴趣爱好"],
  "emotionTriggers": ["情绪触发点"],
  "summary": "一段 100 字以内的用户画像总结"
}`;

function heuristicHabits(personaId: string, userId: string, since: number): UserHabits {
  const rows = logRepo.messagesSince(personaId, userId, since).filter((r: any) => r.direction === "in");
  const hourBuckets = new Map<number, number>();
  for (const row of rows) {
    const h = new Date(row.created_at).getHours();
    const bucket = Math.floor(h / 2) * 2;
    hourBuckets.set(bucket, (hourBuckets.get(bucket) ?? 0) + 1);
  }
  const activeHours = [...hourBuckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([h]) => `${String(h).padStart(2, "0")}:00-${String(h + 2).padStart(2, "0")}:00`);
  return {
    activeHours,
    expressions: [],
    interests: [],
    emotionTriggers: [],
    summary: rows.length ? `近期互动 ${rows.length} 条，活跃于 ${activeHours.join("、") || "未知时段"}。` : "",
  };
}

export async function extractUserHabits(persona: Persona, userId: string): Promise<UserHabits> {
  const since = addDays(new Date(), -14).getTime();
  const rows = logRepo.messagesSince(persona.id, userId, since);
  if (!rows.length) {
    return profileRepo.ensure(persona.id, userId).habits;
  }
  const transcript = rows
    .map((r: any) => `${r.direction === "in" ? "用户" : "角色"}: ${r.content}`)
    .join("\n")
    .slice(0, 6000);

  const heuristic = heuristicHabits(persona.id, userId, since);
  try {
    const { provider } = resolveProviderForPersona(persona);
    const tz = settingsService.get().timezone;
    const messages: ChatMessage[] = [
      { role: "system", content: EXTRACT_SYSTEM },
      { role: "user", content: `${timeContextLine(tz)}\n（请据此理解聊天记录中的相对时间与用户作息）\n\n${transcript}` },
    ];
    const result = await provider.chat(messages, { temperature: 0.2, maxTokens: 800 });
    const jsonText = result.content.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(jsonText) as Partial<UserHabits>;
    const habits: UserHabits = {
      activeHours: parsed.activeHours?.length ? parsed.activeHours : heuristic.activeHours,
      expressions: parsed.expressions ?? [],
      interests: parsed.interests ?? [],
      emotionTriggers: parsed.emotionTriggers ?? [],
      summary: parsed.summary ?? heuristic.summary,
    };
    profileRepo.updateHabits(persona.id, userId, habits);
    return habits;
  } catch (err) {
    logger.warn({ personaId: persona.id, userId, err: (err as Error).message }, "habit extraction fell back to heuristic");
    profileRepo.updateHabits(persona.id, userId, heuristic);
    return heuristic;
  }
}

export function lastInteractionLabel(personaId: string, userId: string): string {
  const profile = profileRepo.find(personaId, userId);
  return profile?.lastInteractionAt ? formatDate(profile.lastInteractionAt) : "—";
}
