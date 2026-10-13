import cron, { type ScheduledTask } from "node-cron";
import { personaRepo } from "../db/repos/personas";
import { memoryRepo } from "../db/repos/memories";
import { conversationRepo } from "../db/repos/conversations";
import { statsRepo } from "../db/repos/stats";
import { refreshExpiringTokens } from "../qq/token";
import { syncSkillsFromGithub } from "../skills/manager";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import { formatDate, addDays, sleep } from "../utils/id";
import { resolveIanaTimezone } from "../utils/clock";
import {
  generateBiweeklyMemory,
  generateDailyMemory,
  generateMonthlyMemory,
  generateThreeDayMemory,
} from "../memory/summarizer";
import { runProactiveCycle, runDailyGreetings, sweepProactiveMemory } from "../proactive/service";
import { botManager } from "../qq/manager";
import { appendDailyMemoryToFiles, pruneDailyMemories } from "../memory/service";
import { generateDailySchedule } from "../memory/schedule";

const tasks: ScheduledTask[] = [];

async function forEachUser(personaId: string, fn: (personaId: string, userId: string) => Promise<void>): Promise<void> {
  const persona = personaRepo.find(personaId);
  if (!persona) return;
  const userIds = new Set(memoryRepo.distinctUsers(personaId));
  for (const conv of conversationRepo.listByPersona(personaId)) {
    userIds.add(conv.userId);
  }
  for (const userId of userIds) {
    try {
      await fn(personaId, userId);
    } catch (err) {
      logger.warn({ personaId, userId, err: (err as Error).message }, "scheduled memory task failed");
    }
  }
}

async function runDailyMemories(): Promise<void> {
  const appendEnabled = settingsService.get().memoryFileAppendEnabled;
  for (const persona of personaRepo.listEnabled()) {
    await forEachUser(persona.id, async (pid, uid) => {
      const p = personaRepo.find(pid);
      if (!p) return;
      const content = await generateDailyMemory(p, uid, addDays(new Date(), -1));
      // 记忆文件 AI 追加：仅当全局开关打开、且该文件标记为可追加时，把当日新记忆累积进去
      if (appendEnabled && content) appendDailyMemoryToFiles(p, uid, formatDate(addDays(new Date(), -1)), content);
    });
  }
  logger.info("daily memory task finished");
}

/** 为每个启用的角色生成「今天」的日程，让角色行为符合身份与作息。 */
async function runDailySchedules(): Promise<void> {
  if (!settingsService.get().scheduleEnabled) return;
  for (const persona of personaRepo.listEnabled()) {
    await generateDailySchedule(persona, formatDate());
    await sleep(200);
  }
  logger.info("daily schedule task finished");
}

async function runThreeDayMemories(): Promise<void> {
  for (const persona of personaRepo.listEnabled()) {
    await forEachUser(persona.id, async (pid, uid) => {
      const p = personaRepo.find(pid);
      if (!p) return;
      await generateThreeDayMemory(p, uid);
      // 三日记忆生成后，剪掉已被浓缩的旧日记忆（只保留最近 N 天，N 默认 2）
      const removed = pruneDailyMemories(p, uid);
      if (removed) logger.info({ personaId: pid, userId: uid, removed }, "pruned consolidated daily memories");
    });
  }
  logger.info("three-day memory task finished");
}

async function runBiweeklyMemories(): Promise<void> {
  for (const persona of personaRepo.listEnabled()) {
    await forEachUser(persona.id, (pid, uid) => generateBiweeklyMemory(personaRepo.find(pid)!, uid).then(() => undefined));
  }
  logger.info("biweekly memory task finished");
}

async function runMonthlyMemories(): Promise<void> {
  for (const persona of personaRepo.listEnabled()) {
    await forEachUser(persona.id, (pid, uid) => generateMonthlyMemory(personaRepo.find(pid)!, uid).then(() => undefined));
  }
  logger.info("monthly memory task finished");
}

let skillTask: ScheduledTask | null = null;

function scheduleSkillUpdate(): void {
  if (skillTask) {
    skillTask.stop();
    skillTask = null;
  }
  const expr = settingsService.get().skillUpdateCron;
  if (!cron.validate(expr)) {
    logger.warn({ expr }, "invalid skill update cron expression, skip");
    return;
  }
  skillTask = cron.schedule(expr, () => {
    void syncSkillsFromGithub().catch((err) => logger.warn({ err: err.message }, "scheduled skill sync failed"));
  });
}

export function startScheduler(): void {
  // 所有定时任务跟随用户配置的时区，避免容器默认 UTC 导致「00:00」跑到北京时间早 8 点。
  // 注意：必须解析成真实 IANA 名再传给 node-cron，别名 "server" 会让它抛错导致调度器崩溃。
  const timezone = resolveIanaTimezone(settingsService.get().timezone);
  const schedule = (expr: string, fn: () => void): ScheduledTask =>
    cron.schedule(expr, fn, timezone ? { timezone } : undefined);

  // 日记忆：每天 00:00
  tasks.push(schedule("0 0 * * *", () => void runDailyMemories()));
  // 每日日程：按配置小时生成（默认 0 点，即你说的「每天晚上 12 点」）
  const scheduleHour = Math.max(0, Math.min(23, settingsService.get().scheduleGenerateHour));
  tasks.push(schedule(`0 ${scheduleHour} * * *`, () => void runDailySchedules()));
  // 统计重置：每天 00:05（新的一天从零开始）
  tasks.push(
    schedule("5 0 * * *", () => {
      statsRepo.resetDate(formatDate());
      logger.info("stats reset for new day");
    }),
  );
  // 三日记忆：每 3 天 01:00（生成后剪掉已浓缩的旧日记忆）
  tasks.push(schedule("0 1 */3 * *", () => void runThreeDayMemories()));
  // 精简记忆：每 2 周 02:00
  tasks.push(schedule("0 2 */14 * *", () => void runBiweeklyMemories()));
  // 月记忆：每月 1 日 03:00
  tasks.push(schedule("0 3 1 * *", () => void runMonthlyMemories()));
  // Token 刷新：每天 04:00
  tasks.push(schedule("0 4 * * *", () => void refreshExpiringTokens()));
  // 主动消息：每 30 分钟一次
  tasks.push(schedule("*/30 * * * *", () => void runProactiveCycle()));
  // 每日问候：每 15 分钟检查一次，命中用户活跃时段且当天未发时发送
  tasks.push(schedule("*/15 * * * *", () => void runDailyGreetings()));
  // 内存清理：每天 04:30 清理主动消息内存计数（防止长期运行内存增长）
  tasks.push(
    schedule("30 4 * * *", () => {
      sweepProactiveMemory();
      logger.info("proactive in-memory counters swept");
    }),
  );
  // Bot 网关状态同步：每 5 分钟
  tasks.push(schedule("*/5 * * * *", () => void botManager.reload()));
  // Skill 自动更新：可配置
  scheduleSkillUpdate();

  logger.info({ count: tasks.length, timezone }, "scheduler started");
}

export function stopScheduler(): void {
  for (const t of tasks) t.stop();
  tasks.length = 0;
  skillTask?.stop();
  skillTask = null;
}

export function rescheduleSkillUpdate(): void {
  scheduleSkillUpdate();
}
