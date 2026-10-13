import { resolveProviderForPersona } from "../llm/factory";
import { scheduleRepo } from "../db/repos/schedules";
import { settingsService } from "../settings/service";
import { systemClock, timeContextLine } from "../utils/clock";
import { logger } from "../logger";
import { addDays, formatDate } from "../utils/id";
import { truncate } from "../utils/json";
import type { ChatMessage, Persona, PersonaSchedule, ScheduleSegment } from "../types";

/**
 * 每日日程：为角色生成「今天几点在做什么」，注入 prompt，让角色当前行为符合身份
 * （例如高中生上课时段就不该在刷抖音）。
 *
 * 生成优先级：角色日程底稿（scheduleTemplate）> 纯按人设生成。
 * 结果按 (personaId, date) 落库，跨天自动用新日程。
 */

const SCHEDULE_SYSTEM = `你是一个角色日程编排助手。请根据角色设定，为 TA 生成「今天」一天的作息日程，让角色的行为符合其身份与生活节奏。

要求：
1. 覆盖一整天，按时间顺序分成若干时间段（清晨起床、上午、午休、下午、傍晚、晚上、睡前等）；
2. 每个时段写清楚：start/end（HH:mm，24 小时制）、activity（在做什么，具体到符合身份的细节）、note（状态说明，如「上课中，不能长时间回消息」「课间，可以聊天」「已休息」）；
3. 严格结合角色身份：学生就要有上课/晚自习/写作业，上班族要有通勤/上班，自由职业者作息可松散；
4. 若是工作日/周末，合理安排差异（周末可睡懒觉、出去玩）；
5. 不要编造与角色设定矛盾的内容，时间要连续、不重叠、覆盖 00:00-24:00。

只输出 JSON，不要解释或代码块：
{"segments":[{"start":"07:00","end":"07:30","activity":"起床洗漱吃早饭","note":"准备上学"},{"start":"07:30","end":"08:00","activity":"上学路上","note":"通勤中"}]}`;

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

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

function sanitizeSegments(list: any[]): ScheduleSegment[] {
  const out: ScheduleSegment[] = [];
  for (const item of list) {
    const start = String(item?.start ?? "").trim();
    const end = String(item?.end ?? "").trim();
    const activity = String(item?.activity ?? "").trim();
    if (!TIME_RE.test(start) || !TIME_RE.test(end) || !activity) continue;
    out.push({
      start,
      end,
      activity: truncate(activity, 80),
      note: truncate(String(item?.note ?? "").trim(), 60),
    });
  }
  return out.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

/**
 * 生成角色某一天的日程并落库。失败返回 null（不影响主流程）。
 * date 默认为服务器「今天」。
 */
export async function generateDailySchedule(persona: Persona, date = formatDate()): Promise<PersonaSchedule | null> {
  try {
    const settings = settingsService.get();
    const { provider } = resolveProviderForPersona(persona);
    const parts = [
      `角色名：${persona.name}`,
      persona.description ? `角色简介：${persona.description}` : "",
      persona.systemPrompt ? `角色设定：${persona.systemPrompt}` : "",
      persona.scheduleTemplate ? `【固定作息底稿（必须遵守）】\n${persona.scheduleTemplate}` : "",
      `日期：${date}`,
    ].filter(Boolean);

    const messages: ChatMessage[] = [
      { role: "system", content: SCHEDULE_SYSTEM },
      { role: "user", content: `${timeContextLine(settings.timezone)}\n\n${parts.join("\n")}` },
    ];
    const result = await provider.chat(messages, { temperature: 0.6, maxTokens: 1400 });
    const parsed = extractJson(result.content);
    const list = Array.isArray(parsed?.segments) ? parsed.segments : [];
    const segments = sanitizeSegments(list);
    if (!segments.length) {
      logger.warn({ personaId: persona.id, date }, "schedule generation produced no valid segments");
      return null;
    }
    const saved = scheduleRepo.upsert(persona.id, date, segments);
    // 日程只保留最近 14 天
    scheduleRepo.removeBefore(persona.id, formatDate(addDays(new Date(), -14)));
    logger.info({ personaId: persona.id, date, segments: segments.length }, "daily schedule generated");
    return saved;
  } catch (err) {
    logger.warn({ personaId: persona.id, date, err: (err as Error).message }, "schedule generation failed");
    return null;
  }
}

/** 读取当天日程；不存在则返回 null。 */
export function getTodaySchedule(personaId: string, date = formatDate()): PersonaSchedule | null {
  return scheduleRepo.find(personaId, date);
}

/** 取当前时刻所在的日程段（按角色时区判断），无匹配返回 null。 */
export function currentSegment(schedule: PersonaSchedule | null, timezone?: string, ts: number = Date.now()): ScheduleSegment | null {
  if (!schedule?.segments.length) return null;
  const snap = systemClock.snapshotAt(ts, timezone);
  const nowMin = snap.hour * 60 + snap.minute;
  // 跨零点时段（如 23:00-07:00）单独处理：start > end 表示跨夜
  for (const seg of schedule.segments) {
    const start = toMinutes(seg.start);
    const end = toMinutes(seg.end);
    if (start <= end) {
      if (nowMin >= start && nowMin < end) return seg;
    } else if (nowMin >= start || nowMin < end) {
      return seg;
    }
  }
  return null;
}

/**
 * 生成注入 prompt 的「角色当前日程」文本。
 * 优先展示当前时段，同时附上今日完整日程，避免模型跨时段答错。
 */
export function buildScheduleContext(persona: Persona, userId: string, timezone?: string, ts: number = Date.now()): string | undefined {
  if (!settingsService.get().scheduleEnabled) return undefined;
  const schedule = getTodaySchedule(persona.id);
  if (!schedule?.segments.length) return undefined;

  const lines: string[] = [];
  const seg = currentSegment(schedule, timezone, ts);
  if (seg) {
    lines.push(`现在（约 ${seg.start}-${seg.end}）你正在：${seg.activity}${seg.note ? `（${seg.note}）` : ""}`);
    lines.push("请让当前状态与身份和作息保持一致，不要出现与日程矛盾的行为。");
  } else {
    lines.push("请让行为与你的身份和作息保持一致。");
  }
  lines.push("", "今日日程：");
  for (const s of schedule.segments) {
    lines.push(`- ${s.start}-${s.end} ${s.activity}${s.note ? `（${s.note}）` : ""}`);
  }
  return lines.join("\n");
}
