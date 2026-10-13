import type { Persona } from "../types";
import { getSkillContent } from "../skills/manager";
import { systemClock, timeContextLineMinute } from "../utils/clock";
import { renderState, type ConversationState } from "../context/state";

export interface MemoryFiles {
  memory?: string;
  user?: string;
  personaState?: string;
}

export interface PromptContext {
  /** 三个可编辑记忆文件的当前内容（MEMORY.md / USER.md / persona-state.md） */
  memoryFiles?: MemoryFiles;
  /** 核心记忆：受保护的约定 / 偏好 / 重要事实，始终注入，不得遗忘。 */
  coreMemories?: string;
  /** 角色今日日程与当前时段状态，让行为符合身份。 */
  schedule?: string;
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
 * 动态后缀：记忆档案 + 相关记忆 + 状态 + 当前时间。
 *
 * 为最大化 prompt cache 命中率，这里遵循两条铁律：
 * 1. 「静态在前，动态在后」——按内容变化频率从低到高排列：
 *    记忆档案（低频）→ 核心记忆（低频）→ 日程（每天一变）
 *    → 相关记忆（每轮可能变）→ 对话摘要 → 当前状态（每轮多变）
 *    → 当前时间（每轮必变，精确到分钟，放在整个 prompt 的最末尾）。
 *    只要时间在最后，它前面的所有内容就构成一个稳定的可复用前缀。
 * 2. 「稳定性优先」——尽可能让同一分钟内的多次请求字节级一致；清空的可选段落直接省略，
 *    避免用空行等固定占位制造假差异。
 */
export function buildDynamicSuffix(persona: Persona, ctx: PromptContext = {}): string {
  const lines: string[] = [];
  const now = ctx.now ?? systemClock.now();

  // 依变化频率注入：低频在前，高频在后。

  const files = ctx.memoryFiles;
  if (files && (files.memory?.trim() || files.user?.trim() || files.personaState?.trim())) {
    lines.push("", "# 记忆档案（由后台维护，可直接编辑，是你长期记住用户与自身设定的依据）");
    if (files.memory?.trim()) lines.push("## MEMORY.md\n" + files.memory.trim());
    if (files.user?.trim()) lines.push("## USER.md\n" + files.user.trim());
    if (files.personaState?.trim()) lines.push("## persona-state.md\n" + files.personaState.trim());
  }

  if (ctx.coreMemories?.trim()) {
    lines.push("", "# 核心记忆（永久保留，务必遵守，不得遗忘或与之矛盾）");
    lines.push(ctx.coreMemories.trim());
  }

  if (ctx.schedule?.trim()) {
    lines.push("", "# 你今天的日程（务必让言行符合当前时段）");
    lines.push(ctx.schedule.trim());
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

  // 当前状态放动态段末、时间之前：利用近因效应强化对“未完成任务/情绪”的遵守
  if (ctx.conversationState) {
    const rendered = renderState(ctx.conversationState);
    if (rendered) {
      lines.push("", "# 当前状态（务必遵守，不得与其矛盾）", rendered);
    }
  }

  // 当前时间固定放在 system prompt 最末尾：它是唯一每轮必变的内容，
  // 放在末尾后其前面的全部内容都成为稳定前缀，可被 prompt cache 复用。
  // 精确到分钟（不含秒），进一步降低同分钟内的抖动。
  lines.push("", "# 当前时间");
  lines.push(timeContextLineMinute(ctx.timezone, now));

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
