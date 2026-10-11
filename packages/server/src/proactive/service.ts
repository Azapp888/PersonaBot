import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { profileRepo } from "../db/repos/profiles";
import { conversationRepo } from "../db/repos/conversations";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderForPersona } from "../llm/factory";
import { assembleSystemPrompt } from "../persona/prompt";
import { buildMemoryInjection } from "../memory/service";
import { QQApiClient } from "../qq/client";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import type { Bot, Persona, UserProfile, AppSettings } from "../types";
import { formatDate, sleep } from "../utils/id";
import { systemClock } from "../utils/clock";

const sentSinceReply = new Map<string, number>();
const HOUR = 60 * 60 * 1000;

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

async function generateProactive(persona: Persona, userId: string, instruction: string): Promise<string | null> {
  const settings = settingsService.get();
  const profile = profileRepo.ensure(persona.id, userId);
  const { files, relevant } = buildMemoryInjection(persona, userId);
  const { full } = assembleSystemPrompt(persona, {
    memoryFiles: files,
    relevant,
    timezone: settings.timezone,
    now: systemClock.now(),
  });
  const conv = conversationRepo.ensure(persona.id, userId);
  const history = conv.messages.slice(-10);

  try {
    const { provider, model } = resolveProviderForPersona(persona);
    const result = await provider.chat(
      [{ role: "system", content: full }, ...history, { role: "user", content: instruction }],
      { temperature: persona.modelConfig.temperature ?? model?.temperature, maxTokens: persona.modelConfig.maxTokens },
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

/** 判断该用户此刻是否应收到每日问候：每天最多一次，尽量落在其活跃时段。 */
function decideDaily(profile: UserProfile, settings: AppSettings): DailyDecision {
  const snap = systemClock.snapshot(settings.timezone);
  if (profile.lastDailyAt) {
    const last = systemClock.snapshotAt(profile.lastDailyAt, settings.timezone);
    if (last.date === snap.date) return { send: false, reason: "今日已发送" };
  }
  if (profile.lastInteractionAt && Date.now() - profile.lastInteractionAt < 30 * 60 * 1000) {
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
  try {
    await client.sendC2C(userId, reply);
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
      const reply = await generateProactive(persona, profile.userId, DAILY_INSTRUCTION);
      if (!reply) {
        result.errors.push(`${persona.name} → ${profile.userId}：生成每日问候失败`);
        continue;
      }
      await deliver(persona, bot, profile.userId, reply, result);
      profileRepo.touchDaily(persona.id, profile.userId);
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

      const reply = await generateProactive(persona, profile.userId, PROACTIVE_INSTRUCTION);
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
