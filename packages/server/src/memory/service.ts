import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "../config";
import { memoryRepo } from "../db/repos/memories";
import { profileRepo } from "../db/repos/profiles";
import { memoryFileRepo } from "../db/repos/memoryFiles";
import { settingsService } from "../settings/service";
import type { Memory, MemoryKind, Persona } from "../types";
import { addDays, formatDate } from "../utils/id";
import type { MemoryFiles } from "../persona/prompt";
import { logger } from "../logger";
import { retrieveRelevantMemories } from "./relevant";
import { truncate } from "../utils/json";

/** 三个可由用户在网页端直接编辑的记忆文件。 */
export const MEMORY_FILE_NAMES = ["MEMORY.md", "USER.md", "persona-state.md"] as const;

/**
 * AI 追加区标记：用户原文与其后的 AI 累积内容以此为界。
 * 追加时只在该标记之后写入，用户原文（标记之前）永不被修改。
 */
export const APPEND_MARKER = "<!-- AI:APPEND -->";

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
  const settings = settingsService.get();
  const byType = (t: string) => memories.filter((m) => m.type === t);
  const core = memoryRepo.listCore(persona.id, userId, settings.memoryCoreImportance, settings.memoryCoreMaxFacts);

  const memoryMd = [
    `# MEMORY.md · ${persona.name} ← ${userId}`,
    "",
    "## 核心记忆（永久保留，受保护，未经允许不得遗忘）",
    ...(core.length
      ? core.map((m) => `- [${kindLabel(m.kind)}] ${m.content}`)
      : ["（暂无）"]),
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
 * 组装记忆注入内容：三个记忆文件 + 核心记忆（受保护原子事实）+ 与当前话题相关的记忆片段。
 * 短期对话由 pipeline 直接附带。
 */
export function buildMemoryInjection(
  persona: Persona,
  userId: string,
  _now = Date.now(),
  query = "",
): { files: MemoryFiles; relevant?: string; core?: string } {
  const files = loadMemoryFiles(persona, userId);
  const core = buildCoreMemory(persona, userId);
  let relevant: string | undefined;
  if (query.trim()) {
    const hits = retrieveRelevantMemories(persona.id, userId, query, 4, []);
    if (hits.length) {
      relevant = hits.map((h) => `- (${h.sourceDate}) ${truncate(h.content, 240)}`).join("\n");
    }
  }
  return { files, relevant, core };
}

/** 记忆类别 → 中文标签（用于核心记忆展示）。 */
export function kindLabel(kind: MemoryKind): string {
  switch (kind) {
    case "agreement":
      return "约定";
    case "preference":
      return "偏好";
    case "fact":
      return "事实";
    case "trivial":
      return "琐事";
    default:
      return "事件";
  }
}

/**
 * 核心记忆（受保护区）：pinned 或高重要性的原子事实。
 * 独立于记忆文件注入，即使文件被手动编辑冻结也不会丢失。
 */
export function buildCoreMemory(persona: Persona, userId: string): string | undefined {
  const settings = settingsService.get();
  const facts = memoryRepo.listCore(persona.id, userId, settings.memoryCoreImportance, settings.memoryCoreMaxFacts);
  if (!facts.length) return undefined;
  return facts.map((m) => `- [${kindLabel(m.kind)}] ${m.content}`).join("\n");
}

/**
 * 剪枝已浓缩进上层记忆的日记忆：只保留最近 memoryDailyRetainDays 天。
 * 原子事实（type=fact）不受影响，重要内容靠核心记忆长期保留。
 * 返回被删除的条数。
 */
export function pruneDailyMemories(persona: Persona, userId: string): number {
  const settings = settingsService.get();
  const retain = Math.max(1, settings.memoryDailyRetainDays);
  const cutoff = formatDate(addDays(new Date(), -retain));
  try {
    return memoryRepo.removeDailyBefore(persona.id, userId, cutoff);
  } catch (err) {
    logger.warn({ personaId: persona.id, userId, err: (err as Error).message }, "prune daily memory failed");
    return 0;
  }
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

/** 拆分文件为「用户原文」与「AI 追加区」两部分（标记之前为用户原文）。 */
export function splitAppendRegion(content: string): { base: string; appended: string } {
  const idx = content.indexOf(APPEND_MARKER);
  if (idx === -1) return { base: content, appended: "" };
  return {
    base: content.slice(0, idx),
    appended: content.slice(idx + APPEND_MARKER.length),
  };
}

/** 把追加区文本按行规范化，去掉空行与重复行（保持首次出现顺序）。 */
export function normalizeAppendLines(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const key = line.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * 将 newContent 追加到记忆文件的 AI 追加区，不改动用户原文。
 * - 已在追加区或用户原文中出现过的行会被去重跳过；
 * - 若文件尚无追加区，则在用户原文之后补一个分隔标记；
 * - 返回本次新增的行数。
 */
export function appendToMemoryFile(
  persona: Persona,
  userId: string,
  name: string,
  newContent: string,
): number {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safe) return 0;

  const current = readMemoryFile(persona.id, userId, safe) ?? "";
  const { base, appended } = splitAppendRegion(current);

  const existingKeys = new Set(
    normalizeAppendLines(appended).map((l) => l.trim()),
  );
  for (const line of base.split("\n")) {
    const key = line.trim();
    if (key) existingKeys.add(key);
  }

  const fresh = normalizeAppendLines(newContent).filter((l) => !existingKeys.has(l.trim()));
  if (!fresh.length) return 0;

  const appendedLines = [...normalizeAppendLines(appended), ...fresh];
  const nextAppended = "\n" + appendedLines.join("\n") + "\n";
  const basePart = base.trimEnd();
  const next = `${basePart}\n\n${APPEND_MARKER}${nextAppended}`;

  const dir = memoryDir(persona.id, userId);
  writeFileSync(resolve(dir, safe), next, "utf8");
  memoryFileRepo.saveAppended(persona.id, userId, safe, next, basePart);
  return fresh.length;
}

/** 是否允许对该文件执行 AI 追加（需全局开关 + 文件级开关，且文件已被用户编辑过）。 */
export function canAppendMemoryFile(
  persona: Persona,
  userId: string,
  name: string,
  globalEnabled: boolean,
): boolean {
  if (!globalEnabled) return false;
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  const record = memoryFileRepo.find(persona.id, userId, safe);
  if (!record || !record.userEdited || !record.appendEnabled) return false;
  return true;
}

/** 为某个记忆文件设置「是否允许 AI 追加」。 */
export function setMemoryFileAppendEnabled(
  personaId: string,
  userId: string,
  name: string,
  enabled: boolean,
): boolean {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safe) return false;
  memoryFileRepo.setAppendEnabled(personaId, userId, safe, enabled);
  return true;
}

/**
 * 每日记忆生成后，把当日记忆追加进「允许追加」的记忆文件。
 * 生成内容按日期分节，追加时依赖 appendToMemoryFile 的行级去重避免重复。
 * 返回各文件新增行数，便于观测。
 */
export function appendDailyMemoryToFiles(
  persona: Persona,
  userId: string,
  sourceDate: string,
  dailyContent: string,
): Record<string, number> {
  const section = [`### ${sourceDate}`, dailyContent.trim()].join("\n");
  const result: Record<string, number> = {};
  for (const name of MEMORY_FILE_NAMES) {
    // 每日记忆默认只进 MEMORY.md；USER.md / persona-state.md 由各自开关控制
    if (name !== "MEMORY.md") continue;
    if (!canAppendMemoryFile(persona, userId, name, true)) continue;
    try {
      const added = appendToMemoryFile(persona, userId, name, section);
      if (added > 0) result[name] = added;
    } catch (err) {
      logger.warn({ personaId: persona.id, userId, name, err: (err as Error).message }, "append daily memory failed");
    }
  }
  return result;
}
