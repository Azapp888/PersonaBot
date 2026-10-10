import type { Persona, UserHabits } from "../types";
import { getSkillContent } from "../skills/manager";
import { systemClock } from "../utils/clock";
import { renderState, type ConversationState } from "../context/state";

export interface PromptMemory {
  daily?: string;
  threeDay?: string;
  monthly?: string;
  imported?: string;
  relevant?: string;
}

export interface PromptContext {
  memory?: PromptMemory;
  userHabits?: UserHabits | null;
  now?: number;
  includeTime?: boolean;
  timezone?: string;
  contextSummary?: string;
  conversationState?: ConversationState;
}

/**
 * 稳定前缀：角色人格定义 + 技能 + 命令。
 * 该部分必须保持字节级稳定，任何动态内容都不能插入其中，
 * 否则会破坏 LLM 的 prompt cache 命中。
 */
export function buildStablePrefix(persona: Persona): string {
  const p = persona.personality;
  const lines: string[] = [];

  lines.push("# 角色设定");
  lines.push(`你是「${persona.name}」。`);
  if (persona.description) lines.push(persona.description);
  if (persona.systemPrompt) lines.push("", persona.systemPrompt);

  lines.push("", "# 性格特征");
  if (p.traits?.length) lines.push(`性格标签：${p.traits.join("、")}`);
  if (p.speakingStyle) lines.push(`说话风格：${p.speakingStyle}`);
  if (p.catchphrases?.length) lines.push(`口癖：${p.catchphrases.join("、")}`);
  if (p.emotionalTendency) lines.push(`情绪倾向：${p.emotionalTendency}`);

  const skillsContent = getSkillContent(persona.skills);
  if (skillsContent) {
    lines.push("", "# 技能插件", skillsContent);
  }

  if (persona.commands?.length) {
    lines.push("", "# 可用命令");
    for (const cmd of persona.commands) {
      lines.push(`- ${cmd.trigger}（${cmd.name}）：${cmd.description || cmd.prompt}`);
    }
  }

  return lines.join("\n");
}

/**
 * 动态后缀：当前时间 + 分层记忆 + 用户画像。
 * 放在 system prompt 末尾，作为已预热请求的"前缀扩展"。
 */
export function buildDynamicSuffix(persona: Persona, ctx: PromptContext = {}): string {
  const lines: string[] = [];
  const now = ctx.now ?? systemClock.now();
  const includeTime = ctx.includeTime ?? true;
  if (includeTime) {
    const snap = systemClock.snapshot(ctx.timezone);
    lines.push("", "# 当前上下文");
    lines.push(`当前系统时间：${systemClock.format(now, ctx.timezone)}（时区 ${snap.timezone}，UTC${snap.utcOffsetMinutes >= 0 ? "+" : "-"}${String(Math.floor(Math.abs(snap.utcOffsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(snap.utcOffsetMinutes) % 60).padStart(2, "0")}）`);
  }

  const mem = ctx.memory;
  if (mem && (mem.daily || mem.threeDay || mem.monthly || mem.imported || mem.relevant)) {
    lines.push("", "# 相关记忆");
    if (mem.imported) lines.push(`## 导入的历史记忆\n${mem.imported}`);
    if (mem.relevant) lines.push(`## 与当前话题相关的记忆片段\n${mem.relevant}`);
    if (mem.daily) lines.push(`## 最近的记忆\n${mem.daily}`);
    if (mem.threeDay) lines.push(`## 中期记忆\n${mem.threeDay}`);
    if (mem.monthly) lines.push(`## 长期记忆\n${mem.monthly}`);
  }

  // 滚动摘要（更早对话的压缩，含用户画像 / 当前状态 / 未完成任务 / 长期记忆点）
  if (ctx.contextSummary) {
    lines.push("", "# 对话上下文摘要（更早对话的长期记录）", ctx.contextSummary);
  }

  const habits = ctx.userHabits;
  if (habits && (habits.summary || habits.interests?.length || habits.expressions?.length)) {
    lines.push("", "# 用户画像摘要");
    if (habits.summary) lines.push(habits.summary);
    if (habits.activeHours?.length) lines.push(`活跃时段：${habits.activeHours.join("、")}`);
    if (habits.interests?.length) lines.push(`兴趣爱好：${habits.interests.join("、")}`);
    if (habits.expressions?.length) lines.push(`常用表达：${habits.expressions.join("、")}`);
    if (habits.emotionTriggers?.length) lines.push(`情绪触发点：${habits.emotionTriggers.join("、")}`);
  }

  // 当前状态放最后，利用近因效应强化对“未完成任务/情绪”的遵守
  if (ctx.conversationState) {
    const rendered = renderState(ctx.conversationState);
    if (rendered) {
      lines.push("", "# 当前状态（务必遵守，不得与其矛盾）", rendered);
    }
  }

  return lines.join("\n");
}

export function assembleSystemPrompt(persona: Persona, ctx: PromptContext = {}): {
  prefix: string;
  suffix: string;
  full: string;
} {
  const prefix = buildStablePrefix(persona);
  const suffix = buildDynamicSuffix(persona, ctx);
  return { prefix, suffix, full: `${prefix}\n${suffix}` };
}
