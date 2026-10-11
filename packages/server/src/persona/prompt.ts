import type { Persona } from "../types";
import { getSkillContent } from "../skills/manager";
import { systemClock, timeContextLine } from "../utils/clock";
import { renderState, type ConversationState } from "../context/state";

export interface MemoryFiles {
  memory?: string;
  user?: string;
  personaState?: string;
}

export interface PromptContext {
  /** 三个可编辑记忆文件的当前内容（MEMORY.md / USER.md / persona-state.md） */
  memoryFiles?: MemoryFiles;
  /** 与当前话题相关的记忆片段（Top-K） */
  relevant?: string;
  now?: number;
  timezone?: string;
  contextSummary?: string;
  conversationState?: ConversationState;
  agentEnabled?: boolean;
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
 * 动态后缀：当前时间 + 记忆档案（三个可编辑 md 文件）+ 相关记忆 + 状态。
 * 放在 system prompt 末尾，作为已预热请求的"前缀扩展"。
 *
 * 时间始终注入：所有模型动作都必须基于真实当前时间下定论。
 */
export function buildDynamicSuffix(persona: Persona, ctx: PromptContext = {}): string {
  const lines: string[] = [];
  const now = ctx.now ?? systemClock.now();

  lines.push("", "# 当前上下文");
  lines.push(timeContextLine(ctx.timezone, now));

  const files = ctx.memoryFiles;
  if (files && (files.memory?.trim() || files.user?.trim() || files.personaState?.trim())) {
    lines.push("", "# 记忆档案（由后台维护，可直接编辑，是你长期记住用户与自身设定的依据）");
    if (files.memory?.trim()) lines.push("## MEMORY.md\n" + files.memory.trim());
    if (files.user?.trim()) lines.push("## USER.md\n" + files.user.trim());
    if (files.personaState?.trim()) lines.push("## persona-state.md\n" + files.personaState.trim());
  }

  if (ctx.relevant?.trim()) {
    lines.push("", "# 与当前话题相关的记忆片段", ctx.relevant.trim());
  }

  // 滚动摘要（更早对话的压缩，含用户画像 / 当前状态 / 未完成任务 / 长期记忆点）
  if (ctx.contextSummary) {
    lines.push("", "# 对话上下文摘要（更早对话的长期记录）", ctx.contextSummary);
  }

  if (ctx.agentEnabled) {
    lines.push("", "# 服务器 Agent 能力");
    lines.push(
      "你运行在用户本人的服务器上，具备在本机执行 shell 命令的能力（工具名 run_shell）。" +
        "当用户希望你完成需要命令行才能做到的事情（查询系统/文件、运行脚本、计算、处理文件等）时，" +
        "可以调用该工具，并在拿到结果后用你的口吻向用户汇报。命令执行有超时与输出截断限制。",
    );
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
