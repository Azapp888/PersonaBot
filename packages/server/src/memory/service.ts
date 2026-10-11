import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { memoryRepo } from "../db/repos/memories";
import { profileRepo } from "../db/repos/profiles";
import { memoryFileRepo } from "../db/repos/memoryFiles";
import type { Memory, Persona } from "../types";
import { addDays, formatDate } from "../utils/id";
import type { MemoryFiles } from "../persona/prompt";
import { logger } from "../logger";
import { retrieveRelevantMemories } from "./relevant";
import { truncate } from "../utils/json";

/** 三个可由用户在网页端直接编辑的记忆文件。 */
export const MEMORY_FILE_NAMES = ["MEMORY.md", "USER.md", "persona-state.md"] as const;

function memoryDir(personaId: string, userId: string): string {
  const dir = resolve(config.dataDir, "memory", personaId, userId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

interface FileBundle {
  "MEMORY.md": string;
  "USER.md": string;
  "persona-state.md": string;
}

/** 依据数据库中的结构化记忆 / 画像，生成三个记忆文件的默认内容。 */
function generateFileContents(persona: Persona, userId: string): FileBundle {
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

  return { "MEMORY.md": memoryMd, "USER.md": userMd, "persona-state.md": stateMd };
}

/**
 * 将结构化记忆与人设状态落盘为 Markdown 文件（文件化记忆架构）。
 * 已被用户手动编辑过的文件不会被自动生成内容覆盖。
 */
export function syncMemoryFiles(persona: Persona, userId: string): void {
  const dir = memoryDir(persona.id, userId);
  const generated = generateFileContents(persona, userId);

  try {
    for (const name of MEMORY_FILE_NAMES) {
      const override = memoryFileRepo.find(persona.id, userId, name);
      const content = override?.userEdited ? override.content : generated[name];
      writeFileSync(resolve(dir, name), content, "utf8");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "sync memory files failed");
  }
}

/** 读取三个记忆文件内容（供注入 System Prompt）。会先按最新数据同步未被手动编辑的文件。 */
export function loadMemoryFiles(persona: Persona, userId: string): MemoryFiles {
  syncMemoryFiles(persona, userId);
  return {
    memory: readMemoryFile(persona.id, userId, "MEMORY.md") ?? undefined,
    user: readMemoryFile(persona.id, userId, "USER.md") ?? undefined,
    personaState: readMemoryFile(persona.id, userId, "persona-state.md") ?? undefined,
  };
}

/**
 * 组装记忆注入内容：三个记忆文件 + 与当前话题相关的记忆片段。
 * 短期对话由 pipeline 直接附带。
 */
export function buildMemoryInjection(
  persona: Persona,
  userId: string,
  _now = Date.now(),
  query = "",
): { files: MemoryFiles; relevant?: string } {
  const files = loadMemoryFiles(persona, userId);
  let relevant: string | undefined;
  if (query.trim()) {
    const hits = retrieveRelevantMemories(persona.id, userId, query, 4, []);
    if (hits.length) {
      relevant = hits.map((h) => `- (${h.sourceDate}) ${truncate(h.content, 240)}`).join("\n");
    }
  }
  return { files, relevant };
}

export function listMemories(personaId: string, userId: string): Memory[] {
  return memoryRepo.listByUser(personaId, userId);
}

export function readMemoryFile(personaId: string, userId: string, name: string): string | null {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const override = memoryFileRepo.find(personaId, userId, safe);
  if (override?.userEdited) return override.content;
  const file = resolve(memoryDir(personaId, userId), safe);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** 列出（并确保生成）三个记忆文件，供后台编辑。 */
export function listMemoryFiles(persona: Persona, userId: string): string[] {
  syncMemoryFiles(persona, userId);
  const dir = memoryDir(persona.id, userId);
  const extra = (() => {
    try {
      return readdirSync(dir).filter((f) => f.endsWith(".md") && !MEMORY_FILE_NAMES.includes(f as any));
    } catch {
      return [];
    }
  })();
  return [...MEMORY_FILE_NAMES, ...extra];
}

/** 用户手动保存记忆文件：落库标记为「手动编辑」，并同步写盘。 */
export function writeMemoryFile(persona: Persona, userId: string, name: string, content: string): void {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safe) throw new Error("非法文件名");
  memoryFileRepo.save(persona.id, userId, safe, content, true);
  const dir = memoryDir(persona.id, userId);
  writeFileSync(resolve(dir, safe), content, "utf8");
}

/** 放弃手动编辑，恢复为自动生成内容。 */
export function resetMemoryFile(persona: Persona, userId: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  memoryFileRepo.save(persona.id, userId, safe, "", false);
  syncMemoryFiles(persona, userId);
  return readMemoryFile(persona.id, userId, safe) ?? "";
}
