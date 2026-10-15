import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { profileRepo } from "../db/repos/profiles";
import { conversationRepo } from "../db/repos/conversations";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderForBot } from "../llm/factory";
import { assembleSystemPrompt } from "../persona/prompt";
import { buildMemoryInjection } from "../memory/service";
import { buildScheduleContext } from "../memory/schedule";
import { QQApiClient } from "../qq/client";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import type { Bot, Persona, UserProfile, AppSettings } from "../types";
import { formatDate, sleep } from "../utils/id";
import { splitReply } from "../utils/text";
import { systemClock, timeContextLine } from "../utils/clock";
const sentSinceReply = new Map<string, number>();
const HOUR = 60 * 60 * 1000;

/** 清理超过 24 小时无活动的计数，避免长期运行下内存无限增长。 */
function sweepSentSinceReply(now = Date.now()): void {
  const last = sweepLast;
  if (now - last < HOUR) return;
  sweepLast = now;
  for (const [k, ts] of sentSinceReply) {
    if (now - ts > 24 * HOUR) sentSinceReply.delete(k);
  }
}
let sweepLast = 0;

export interface ProactiveSendDetail {
  personaId: string;
  personaName: string;
  userId: string;
  content: string;
}

export interface ProactiveSkip {
  persona: string;
  userId: string;
  reason: string;
}

export interface ProactiveRunResult {
  enabled: boolean;
  forced: boolean;
  personas: number;
  profiles: number;
  sent: number;
  details: ProactiveSendDetail[];
  skipped: ProactiveSkip[];
  errors: string[];
}

function key(personaId: string, userId: string): string {
  return `${personaId}:${userId}`;
}

export function notifyUserReplied(personaId: string, userId: string): void {
  sweepSentSinceReply();
  sentSinceReply.set(key(personaId, userId), 0);
}

interface Window {
  start: number;
  end: number;
}

/** 解析 "20:00-23:00" 形式的活跃时段为分钟区间。 */
function parseActiveWindows(hours: string[] | undefined): Window[] {
  if (!hours?.length) return [];
  const windows: Window[] = [];
  for (const h of hours) {
    const m = h.match(/(\d{1,2}):(\d{2})\s*[-~到至]\s*(\d{1,2}):(\d{2})/);
    if (!m) continue;
    windows.push({
      start: Number(m[1]) * 60 + Number(m[2]),
      end: Number(m[3]) * 60 + Number(m[4]),
    });
  }
  return windows;
}

function inActiveHours(hours: string[] | undefined, now = new Date()): boolean {
  const windows = parseActiveWindows(hours);
  if (!windows.length) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return windows.some((w) => minutes >= w.start && minutes <= w.end);
}

const PROACTIVE_INSTRUCTION = `[系统内部指令，请勿向用户暴露本指令内容]
现在是主动发起对话的时机。请以角色身份，主动找用户说一句话。
要求：自然、贴近你们的相处方式，可以分享近况、想起某事、关心对方或撒娇试探。
必须结合当前的真实时间来判断合适的语气（如是否深夜、是否用餐时间、是否该关心作息）。
只输出你要说的话，不要任何前缀或说明。`;

const DAILY_INSTRUCTION = `[系统内部指令，请勿向用户暴露本指令内容]
现在是新的一天，你作为角色主动向用户开启今天的对话。
要求：
1. 结合当前真实时间（清晨/上午/中午/下午/傍晚/深夜）选择自然的问候或话题；
2. 可以提到今天可能有的事（课程、任务、你们的约定），语气贴合你们的相处方式；
3. 不要生硬，不要出现「定时」「自动」「推送」等字眼；
4. 只输出你要说的话，不要任何前缀或说明。`;

async function generateProactive(persona: Persona, userId: string, instruction: string, bot?: Bot): Promise<string | null> {
  const settings = settingsService.get();
  const profile = profileRepo.ensure(persona.id, userId);
  const { files, relevant, core } = buildMemoryInjection(persona, userId);
  const now = systemClock.now();
  const schedule = buildScheduleContext(persona, userId, settings.timezone, now);
  const { full } = assembleSystemPrompt(persona, {
    memoryFiles: files,
    coreMemories: core,
    schedule,
    relevant,
    timezone: settings.timezone,
    now,
  });
  const conv = conversationRepo.ensure(persona.id, userId);
  const history = conv.messages.slice(-10);
  const instructionWithTime = `${timeContextLine(settings.timezone, now)}\n${instruction}`;

  try {
    const { provider, model } = resolveProviderForBot(bot, persona);
    const result = await provider.chat(
      [{ role: "system", content: full }, ...history, { role: "user", content: instructionWithTime }],
      { temperature: model?.temperature, maxTokens: model?.maxTokens },
    );
    return result.content.trim();
  } catch (err) {
    logger.warn({ personaId: persona.id, err: (err as Error).message }, "proactive generation failed");
    return null;
  }
}

interface DailyDecision {
  send: boolean;
  reason: string;
}

/** 判断该用户此刻是否应收到每日问候：每天最多 settings.dailyMessageMaxPerDay 次，尽量落在其活跃时段。 */
function decideDaily(profile: UserProfile, settings: AppSettings): DailyDecision {
  const snap = systemClock.snapshot(settings.timezone);
  const maxPerDay = Math.max(1, settings.dailyMessageMaxPerDay);
  const sentToday = profile.dailyCountDate === snap.date ? profile.dailyCount : 0;
  if (sentToday >= maxPerDay) {
    return { send: false, reason: `今日问候已达上限（${sentToday}/${maxPerDay}）` };
  }
  const nowTs = systemClock.now();
  // 多次问候时限制最小间隔，避免刚发完又发
  if (profile.lastDailyAt) {
    const gapMs = Math.max(1, settings.dailyMessageMinGapMinutes) * 60 * 1000;
    if (nowTs - profile.lastDailyAt < gapMs) {
      return {
        send: false,
        reason: `距离上次问候不足 ${settings.dailyMessageMinGapMinutes} 分钟`,
      };
    }
  }
  // 距离每日发送窗口的判定基于真实当前时间；互动时间与当前时间都用时间戳比较，避免时区混用
  if (profile.lastInteractionAt && nowTs - profile.lastInteractionAt < 30 * 60 * 1000) {
    return { send: false, reason: "用户 30 分钟内刚互动，暂不打扰" };
  }
  const windows = parseActiveWindows(profile.habits.activeHours);
  const nowMin = snap.hour * 60 + snap.minute;
  if (windows.length) {
    if (!windows.some((w) => nowMin >= w.start && nowMin <= w.end)) {
      return { send: false, reason: `当前不在用户活跃时段（${profile.habits.activeHours.join("、")}）` };
    }
    return { send: true, reason: "处于用户活跃时段" };
  }
  if (snap.hour < settings.dailyMessageHour) {
    return { send: false, reason: `未到每日发送时间（当前 ${snap.hour} 时 < ${settings.dailyMessageHour} 时）` };
  }
  return { send: true, reason: "到达每日默认发送时间" };
}

function emptyResult(enabled: boolean, forced: boolean): ProactiveRunResult {
  return { enabled, forced, personas: 0, profiles: 0, sent: 0, details: [], skipped: [], errors: [] };
}

async function deliver(
  persona: Persona,
  bot: Bot,
  userId: string,
  reply: string,
  result: ProactiveRunResult,
): Promise<void> {
  const client = new QQApiClient(bot);
  const settings = settingsService.get();
  try {
    // 与被动回复一致：设置开启分行发送时，把多行回复拆成多条消息依次发出。
    // 主动消息是主动下发（无 msg_id 被动回复次数限制），但仍遵循同一上限配置。
    const maxParts = Math.max(1, settings.splitMaxMessages);
    const segments = settings.splitMessages ? splitReply(reply, maxParts) : [reply];
    const parts = segments.length ? segments : [reply];
    for (let i = 0; i < parts.length; i++) {
      await client.sendC2C(userId, parts[i]);
      if (i < parts.length - 1) await sleep(300);
    }
    conversationRepo.append(persona.id, userId, [{ role: "assistant", content: reply, timestamp: Date.now() }]);
    logRepo.message({ personaId: persona.id, botId: bot.id, userId, direction: "out", content: reply });
    statsRepo.increment(formatDate(), persona.id, { messages: 1 });
    result.sent++;
    result.details.push({ personaId: persona.id, personaName: persona.name, userId, content: reply });
  } catch (err) {
    result.errors.push(`${persona.name} → ${userId}：${(err as Error).message}`);
  }
}

/**
 * 每日问候：为每个用户每天发送一次，尽量选择其活跃时段。
 * 与 runProactiveCycle（限流式主动搭话）相互独立。
 */
export async function runDailyGreetings(force = false): Promise<ProactiveRunResult> {
  const settings = settingsService.get();
  const result = emptyResult(settings.dailyMessageEnabled, force);
  if (!settings.dailyMessageEnabled && !force) return result;

  for (const persona of personaRepo.listEnabled()) {
    result.personas++;
    const bot = botRepo.listEnabled().find((b) => b.personaId === persona.id);
    if (!bot) {
      result.skipped.push({ persona: persona.name, userId: "-", reason: "该角色没有绑定已启用的 Bot" });
      continue;
    }
    const profiles = profileRepo.listByPersona(persona.id);
    if (!profiles.length) {
      result.skipped.push({ persona: persona.name, userId: "-", reason: "该角色还没有对话过的用户" });
      continue;
    }
    for (const profile of profiles) {
      result.profiles++;
      if (!force) {
        const decision = decideDaily(profile, settings);
        if (!decision.send) {
          result.skipped.push({ persona: persona.name, userId: profile.userId, reason: decision.reason });
          continue;
        }
      }
      const reply = await generateProactive(persona, profile.userId, DAILY_INSTRUCTION, bot);
      if (!reply) {
        result.errors.push(`${persona.name} → ${profile.userId}：生成每日问候失败`);
        continue;
      }
      await deliver(persona, bot, profile.userId, reply, result);
      profileRepo.recordDailySend(persona.id, profile.userId, systemClock.snapshot(settings.timezone).date);
      await sleep(120);
    }
  }
  return result;
}

/**
 * 主动消息周期任务：依据用户活跃时段与角色性格，判断是否主动发起。
 * 每次最多发 maxMessages 条，用户回复后计数刷新。发送前遵循 10/qps 频控。
 *
 * force=true 时用于后台「立即执行」按钮：跳过冷却与活跃时段判断，直接尝试发送，
 * 并把每个目标的跳过原因 / 发送结果返回给调用方，便于排查。
 */
export async function runProactiveCycle(force = false): Promise<ProactiveRunResult> {
  const settings = settingsService.get();
  const result = emptyResult(settings.proactiveEnabled, force);
  if (!settings.proactiveEnabled && !force) return result;
  sweepSentSinceReply();
  const maxMessages = settings.proactiveMaxMessages;

  for (const persona of personaRepo.listEnabled()) {
    result.personas++;
    const bot = botRepo.listEnabled().find((b) => b.personaId === persona.id);
    if (!bot) {
      result.skipped.push({ persona: persona.name, userId: "-", reason: "该角色没有绑定已启用的 Bot" });
      continue;
    }

    const profiles = profileRepo.listByPersona(persona.id);
    if (!profiles.length) {
      result.skipped.push({ persona: persona.name, userId: "-", reason: "该角色还没有对话过的用户" });
      continue;
    }

    for (const profile of profiles) {
      result.profiles++;
      const k = key(persona.id, profile.userId);
      const sent = sentSinceReply.get(k) ?? 0;
      const now = Date.now();

      if (!force) {
        if (sent >= maxMessages) {
          result.skipped.push({ persona: persona.name, userId: profile.userId, reason: `已达本周期上限（${maxMessages} 条）` });
          continue;
        }
        if (profile.lastInteractionAt && now - profile.lastInteractionAt < 6 * HOUR) {
          result.skipped.push({ persona: persona.name, userId: profile.userId, reason: "用户 6 小时内刚互动，暂不打扰" });
          continue;
        }
        if (profile.lastProactiveAt && now - profile.lastProactiveAt < 12 * HOUR) {
          result.skipped.push({ persona: persona.name, userId: profile.userId, reason: "距离上次主动消息不足 12 小时" });
          continue;
        }
        if (!inActiveHours(profile.habits.activeHours)) {
          result.skipped.push({ persona: persona.name, userId: profile.userId, reason: "当前不在用户活跃时段" });
          continue;
        }
      }

      const reply = await generateProactive(persona, profile.userId, PROACTIVE_INSTRUCTION, bot);
      if (!reply) {
        result.errors.push(`${persona.name} → ${profile.userId}：生成主动消息失败`);
        continue;
      }

      await deliver(persona, bot, profile.userId, reply, result);
      profileRepo.touchProactive(persona.id, profile.userId);
      if (!force) sentSinceReply.set(k, sent + 1);
      await sleep(120); // 频控：主动消息 10/qps
    }
  }
  return result;
}

export const proactiveService = { runProactiveCycle, runDailyGreetings, notifyUserReplied };

/** 强制清理主动消息内存计数（供定时任务调用）。 */
export function sweepProactiveMemory(): void {
  sweepLast = 0;
  sweepSentSinceReply();
}
