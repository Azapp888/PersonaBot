import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { memoryRepo } from "../db/repos/memories";
import { profileRepo } from "../db/repos/profiles";
import type { Memory, Persona } from "../types";
import { addDays, formatDate } from "../utils/id";
import type { PromptMemory } from "../persona/prompt";
import { logger } from "../logger";
import { retrieveRelevantMemories } from "./relevant";
import { truncate } from "../utils/json";

function memoryDir(personaId: string, userId: string): string {
  const dir = resolve(config.dataDir, "memory", personaId, userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 按优先级检索记忆用于注入：
 * 1. 前一天日记忆（保证时间连续性）
 * 2. 三日记忆（补充中期）
 * 3. 月记忆（长期，仅在有内容时注入）
 * 4. 与当前话题相关的记忆片段（Top-K，避免全量塞入导致 Token 爆炸）
 * 短期对话由 pipeline 直接附带。
 */
export function buildMemoryInjection(personaId: string, userId: string, now = Date.now(), query = ""): PromptMemory {
  const result: PromptMemory = {};
  const usedIds: string[] = [];
  const yesterday = formatDate(addDays(now, -1));
  const daily = memoryRepo.latest(personaId, userId, "daily");
  if (daily && daily.sourceDate === yesterday) {
    result.daily = daily.content;
    usedIds.push(daily.id);
  } else if (daily) {
    // 前一天没有则退化为最近一次日记忆
    result.daily = daily.content;
    usedIds.push(daily.id);
  }

  const threeDay = memoryRepo.latest(personaId, userId, "three_day");
  if (threeDay && threeDay.content) {
    result.threeDay = threeDay.content;
    usedIds.push(threeDay.id);
  }

  const monthly = memoryRepo.latest(personaId, userId, "monthly");
  if (monthly && monthly.content) {
    result.monthly = monthly.content;
    usedIds.push(monthly.id);
  }

  const imported = memoryRepo
    .listByUser(personaId, userId)
    .filter((m) => m.type === "imported")
    .slice(0, 3);
  if (imported.length) {
    result.imported = imported.map((m) => `- (${m.sourceDate}) ${m.content}`).join("\n");
    usedIds.push(...imported.map((m) => m.id));
  }

  // 按当前话题检索相关记忆片段（Top-K）
  if (query.trim()) {
    const hits = retrieveRelevantMemories(personaId, userId, query, 4, usedIds);
    if (hits.length) {
      result.relevant = hits.map((h) => `- (${h.sourceDate}) ${truncate(h.content, 240)}`).join("\n");
    }
  }

  return result;
}

export function listMemories(personaId: string, userId: string): Memory[] {
  return memoryRepo.listByUser(personaId, userId);
}

/** 将结构化记忆与人设状态落盘为 Markdown 文件（文件化记忆架构）。 */
export function syncMemoryFiles(persona: Persona, userId: string): void {
  const dir = memoryDir(persona.id, userId);
  const memories = memoryRepo.listByUser(persona.id, userId);
  const profile = profileRepo.find(persona.id, userId);

  const byType = (t: string) => memories.filter((m) => m.type === t);

  const memoryMd = [
    `# MEMORY.md · ${persona.name} ← ${userId}`,
    "",
    "## 长期记忆（月）",
    ...byType("monthly").map((m) => `- (${m.sourceDate}) ${m.content}`),
    "",
    "## 中期记忆（两周精简 / 三日）",
    ...byType("biweekly").map((m) => `- (${m.sourceDate}) ${m.content}`),
    ...byType("three_day").map((m) => `- (${m.sourceDate}) ${m.content}`),
    "",
    "## 近期记忆（日）",
    ...byType("daily").map((m) => `### ${m.sourceDate}\n${m.content}`),
    "",
    "## 导入的历史记忆",
    ...byType("imported").map((m) => `### ${m.sourceDate}\n${m.content}`),
    "",
  ].join("\n");

  const userMd = [
    `# USER.md · 用户画像`,
    "",
    `- 用户 ID: ${userId}`,
    `- 最后互动: ${profile?.lastInteractionAt ? formatDate(profile.lastInteractionAt) : "—"}`,
    `- 最后主动消息: ${profile?.lastProactiveAt ? formatDate(profile.lastProactiveAt) : "—"}`,
    "",
    "## 习惯画像",
    profile?.habits?.summary ?? "（暂无）",
    "",
    `- 活跃时段: ${(profile?.habits?.activeHours ?? []).join("、") || "—"}`,
    `- 常用表达: ${(profile?.habits?.expressions ?? []).join("、") || "—"}`,
    `- 兴趣爱好: ${(profile?.habits?.interests ?? []).join("、") || "—"}`,
    `- 情绪触发点: ${(profile?.habits?.emotionTriggers ?? []).join("、") || "—"}`,
    "",
  ].join("\n");

  const stateMd = [
    `# persona-state.md · ${persona.name}`,
    "",
    `- 角色: ${persona.name}`,
    `- 简介: ${persona.description || "—"}`,
    `- 性格: ${(persona.personality.traits ?? []).join("、") || "—"}`,
    `- 情绪倾向: ${persona.personality.emotionalTendency || "—"}`,
    `- 已启用技能: ${(persona.skills ?? []).join("、") || "—"}`,
    `- 更新时间: ${new Date().toISOString()}`,
    "",
  ].join("\n");

  try {
    writeFileSync(resolve(dir, "MEMORY.md"), memoryMd, "utf8");
    writeFileSync(resolve(dir, "USER.md"), userMd, "utf8");
    writeFileSync(resolve(dir, "persona-state.md"), stateMd, "utf8");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "sync memory files failed");
  }
}

export function readMemoryFile(personaId: string, userId: string, name: string): string | null {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const file = resolve(memoryDir(personaId, userId), safe);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

export function listMemoryFiles(personaId: string, userId: string): string[] {
  const dir = memoryDir(personaId, userId);
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}
