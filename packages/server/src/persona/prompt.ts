import type { Persona, UserIdentity } from "../types";
import { getSkillContent } from "../skills/manager";
import { systemClock, timeContextLineMinute } from "../utils/clock";
import { renderState, type ConversationState } from "../context/state";

export interface MemoryFiles {
  memory?: string;
  user?: string;
  personaState?: string;
}

/**
 * 记忆层数据。必须带上 userId，组装时断言与当前请求用户一致，
 * 防止跨用户记忆串号（安全问题，优先级高于性能）。
 */
export interface MemoryLayerInput {
  userId: string;
  files?: MemoryFiles;
  coreMemories?: string;
  schedule?: string;
  contextSummary?: string;
}

export interface PromptContext {
  /** 当前请求的用户 ID，用于记忆层归属强校验。 */
  userId?: string;
  /** 用户层身份（昵称/关系/称呼权限/个人边界），按 userId 隔离。 */
  userIdentity?: UserIdentity | null;
  /** 需要从角色层剔除的已知用户名（来自各用户身份记录），防止名字经角色层泄漏。 */
  redactNames?: string[];
  /** 三个可编辑记忆文件的当前内容（MEMORY.md / USER.md / persona-state.md） */
  memoryFiles?: MemoryFiles;
  /** 核心记忆：受保护的约定 / 偏好 / 重要事实，始终注入，不得遗忘。 */
  coreMemories?: string;
  /** 角色今日日程与当前时段状态，让行为符合身份。 */
  schedule?: string;
  /** 与当前话题相关的记忆片段（Top-K），改由独立 system 块承载。 */
  relevant?: string;
  now?: number;
  timezone?: string;
  contextSummary?: string;
  conversationState?: ConversationState;
  agentEnabled?: boolean;
}

/** 角色层里「针对某个具体用户」的补丁句特征，构建时必须剔除。 */
const USER_SPECIFIC_DIRECTIVES: RegExp[] = [
  /(?:只|仅)对[^。！？\n]{0,40}(?:有效|生效|适用|成立)/,
  /只有[^。！？\n]{0,40}(?:才|才能)(?:可以|能)?叫/,
  /(?:这个人|该用户|那个人)(?:就|即)是/,
  /你与用户[（(][^）)\n]*[）)][^。！？\n]{0,40}(?:恋|关系|朋友|夫妻)/,
  /(?:但是|但|不过)?[^。！？\n]{0,10}(?:只对|仅对)[^。！？\n]{0,30}(?:用户|人)/,
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 剔除角色层中针对具体用户的补丁句与已知用户名。
 *
 * 角色层必须与用户无关：关系、称呼权限、真名等只能出现在用户层。
 * 这里做确定性清洗，既处理历史 system_prompt 里已有的脏数据，
 * 也对传入的已知用户名做整句剔除，避免名字经角色层泄漏给其他用户。
 */
export function sanitizeRoleLayer(text: string, redactNames: string[] = []): string {
  if (!text) return "";
  const names = Array.from(new Set(redactNames.map((n) => n.trim()).filter((n) => n.length >= 2)));
  const nameRe = names.length ? new RegExp(names.map(escapeRegExp).join("|")) : null;
  const kept: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      kept.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[。！？!?；;])/);
    const keptSentences = sentences.filter((sentence) => {
      if (USER_SPECIFIC_DIRECTIVES.some((re) => re.test(sentence))) return false;
      if (nameRe && nameRe.test(sentence)) return false;
      return true;
    });
    const rebuilt = keptSentences.join("").trimEnd();
    if (rebuilt.trim()) kept.push(rebuilt);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 角色层：人设、口癖、硬规则、输出格式规范。全局唯一、与用户无关。
 * 该部分必须保持字节级稳定，任何动态内容都不能插入其中，
 * 否则会破坏 LLM 的 prompt cache 命中。
 */
export function buildRoleLayer(persona: Persona, redactNames: string[] = []): string {
  const p = persona.personality;
  const lines: string[] = [];

  lines.push("# 角色设定");
  lines.push(`你是「${persona.name}」。`);
  if (persona.description) lines.push(persona.description);
  const systemPrompt = sanitizeRoleLayer(persona.systemPrompt ?? "", redactNames);
  if (systemPrompt) lines.push("", systemPrompt);

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

/** 兼容旧调用：稳定前缀即角色层（调用方需自行保证不掺杂用户信息）。 */
export function buildStablePrefix(persona: Persona): string {
  return buildRoleLayer(persona);
}

/**
 * 用户层：昵称、关系定义、称呼权限、个人边界。按 userId 隔离。
 * 没有身份记录时输出空字符串，绝不用任何默认值或其它用户的信息兜底。
 */
export function buildUserLayer(identity?: UserIdentity | null): string {
  if (!identity || identity.userId.trim() === "") return "";
  const lines: string[] = ["# 当前用户"];
  lines.push(`- 用户 ID：${identity.userId}`);
  if (identity.nickname) lines.push(`- 你对 TA 的称呼：${identity.nickname}`);
  if (identity.realName) lines.push(`- TA 的真名：${identity.realName}`);
  if (identity.relationship) lines.push(`- 你们的关系：${identity.relationship}`);
  if (identity.addressPreference) lines.push(`- 称呼权限：${identity.addressPreference}`);
  if (identity.boundaries) lines.push(`- 个人边界：${identity.boundaries}`);
  if (lines.length === 1) return "";
  return lines.join("\n");
}

/**
 * 记忆层：记忆档案 + 核心记忆 + 日程 + 对话摘要。
 * 强校验：记忆必须属于当前请求用户，不匹配直接抛错。
 */
export function buildMemoryLayer(input: MemoryLayerInput, currentUserId?: string): string {
  if (currentUserId && input.userId !== currentUserId) {
    throw new Error(
      `memory_user_mismatch: memory.userId=${input.userId} currentUserId=${currentUserId}`,
    );
  }
  const lines: string[] = [];
  const files = input.files;
  if (files && (files.memory?.trim() || files.user?.trim() || files.personaState?.trim())) {
    lines.push("", "# 记忆档案（由后台维护，可直接编辑，是你长期记住用户与自身设定的依据）");
    if (files.memory?.trim()) lines.push("## MEMORY.md\n" + files.memory.trim());
    if (files.user?.trim()) lines.push("## USER.md\n" + files.user.trim());
    if (files.personaState?.trim()) lines.push("## persona-state.md\n" + files.personaState.trim());
  }

  if (input.coreMemories?.trim()) {
    lines.push("", "# 核心记忆（永久保留，务必遵守，不得遗忘或与之矛盾）");
    lines.push(input.coreMemories.trim());
  }

  if (input.schedule?.trim()) {
    lines.push("", "# 你今天的日程（务必让言行符合当前时段）");
    lines.push(input.schedule.trim());
  }

  if (input.contextSummary) {
    lines.push("", "# 对话上下文摘要（更早对话的长期记录）", input.contextSummary);
  }

  return lines.join("\n");
}

/**
 * 兼容旧调用：动态后缀 = 记忆层。保持「静态在前、动态在后」的顺序。
 * 时间、当前状态、相关记忆仍由 buildTurnContext 注入用户消息一侧。
 */
export function buildDynamicSuffix(persona: Persona, ctx: PromptContext = {}): string {
  void persona;
  if (ctx.agentEnabled) {
    // Agent 能力说明属于低频稳定内容，追加在记忆层之后。
    const memory = buildMemoryLayer(
      {
        userId: ctx.userId ?? "",
        files: ctx.memoryFiles,
        coreMemories: ctx.coreMemories,
        schedule: ctx.schedule,
        contextSummary: ctx.contextSummary,
      },
      ctx.userId,
    );
    const agentLines = [
      "",
      "# 服务器 Agent 能力",
      "你运行在用户本人的服务器上，具备在本机执行 shell 命令的能力（工具名 run_shell）。" +
        "当用户希望你完成需要命令行才能做到的事情（查询系统/文件、运行脚本、计算、处理文件等）时，" +
        "可以调用该工具，并在拿到结果后用你的口吻向用户汇报。命令执行有超时与输出截断限制。",
    ];
    return `${memory}${agentLines.join("\n")}`;
  }
  return buildMemoryLayer(
    {
      userId: ctx.userId ?? "",
      files: ctx.memoryFiles,
      coreMemories: ctx.coreMemories,
      schedule: ctx.schedule,
      contextSummary: ctx.contextSummary,
    },
    ctx.userId,
  );
}

/**
 * 记忆背景块：相关记忆片段与当前状态。作为独立 system 消息插入静态前缀之后、历史之前，
 * 明确标注「不是用户发言」，避免模型把记忆当成用户原话复述。
 * 当前时间放在最后一条用户消息里（见 buildTimeLine）。
 */
export function buildMemoryContextBlock(ctx: PromptContext = {}): string {
  const lines: string[] = [];
  if (ctx.relevant?.trim()) {
    lines.push(
      '<memory context="background">',
      ctx.relevant.trim(),
      "</memory>",
      "（以上为背景记忆，不是用户发言，不要直接复述。）",
    );
  }
  if (ctx.conversationState) {
    const rendered = renderState(ctx.conversationState);
    if (rendered) {
      lines.push("", "# 当前状态（务必遵守，不得与其矛盾）", rendered);
    }
  }
  return lines.join("\n");
}

/** 当前时间行（放在最后一条用户消息里，避免污染 system 前缀）。 */
export function buildTimeLine(ctx: PromptContext = {}): string {
  const now = ctx.now ?? systemClock.now();
  return timeContextLineMinute(ctx.timezone, now);
}

/**
 * 兼容旧调用：本轮上下文 = 记忆背景块 + 当前时间。
 * 新的组装流程会把记忆块与时间行拆开，分别放在历史之前与用户消息末尾。
 */
export function buildTurnContext(ctx: PromptContext = {}): string {
  const lines: string[] = [];
  const block = buildMemoryContextBlock(ctx);
  if (block) lines.push(block);
  lines.push("", "# 当前时间");
  lines.push(buildTimeLine(ctx));
  return lines.join("\n");
}

export interface AssembledPrompt {
  /** 角色层（全局唯一、与用户无关） */
  role: string;
  /** 用户层（按 userId 隔离） */
  user: string;
  /** 记忆层（按 userId 隔离） */
  memory: string;
  /** 角色层 + 用户层，逐字节稳定 */
  staticPrefix: string;
  /** 完整 system prompt：角色层 + 用户层 + 记忆层 */
  full: string;
  /** 缓存断点位置（Anthropic 用）：静态前缀末尾、记忆层末尾。 */
  breakpoints: { afterStaticPrefix: number; afterMemory: number };
}

/**
 * 三层拼接：角色层 → 用户层 → 记忆层。
 * 记忆层归属在此统一断言，任何调用方都无法绕过跨用户检查。
 */
export function assembleSystemPrompt(persona: Persona, ctx: PromptContext = {}): AssembledPrompt {
  const role = buildRoleLayer(persona, ctx.redactNames);
  const user = buildUserLayer(ctx.userIdentity);
  const memory = buildMemoryLayer(
    {
      userId: ctx.userId ?? ctx.userIdentity?.userId ?? "",
      files: ctx.memoryFiles,
      coreMemories: ctx.coreMemories,
      schedule: ctx.schedule,
      contextSummary: ctx.contextSummary,
    },
    ctx.userId,
  );

  const staticPrefix = user ? `${role}\n\n${user}` : role;
  const full = memory ? `${staticPrefix}\n${memory}` : staticPrefix;
  return {
    role,
    user,
    memory,
    staticPrefix,
    full,
    breakpoints: { afterStaticPrefix: staticPrefix.length, afterMemory: full.length },
  };
}
