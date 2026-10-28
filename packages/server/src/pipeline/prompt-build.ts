import { userIdentityRepo } from "../db/repos/user-identities";
import { assembleSystemPrompt, buildMemoryContextBlock, buildTimeLine, type MemoryFiles } from "../persona/prompt";
import type { ChatMessage, ContentPart, ImageContentPart, Persona } from "../types";
import type { ConversationState } from "../context/state";

export interface ReplyPromptInput {
  persona: Persona;
  userId: string;
  /** 处理后的用户本轮文本（已展开命令）。 */
  processed: string;
  history: ChatMessage[];
  memoryFiles: MemoryFiles;
  coreMemories?: string;
  schedule?: string;
  contextSummary?: string;
  relevant?: string;
  state: ConversationState;
  guardrail?: string | null;
  agentEnabled?: boolean;
  fileContext?: string;
  imageContext?: string;
  imageParts?: ImageContentPart[];
  hasFaces?: boolean;
  timezone?: string;
  now?: number;
}

/**
 * 组装一次请求的完整消息序列：
 * [角色层+用户层+记忆层 system] → [背景记忆 system] → [历史] → [本轮用户消息] → [护栏 system]。
 *
 * 用户层与记忆层都按 userId 隔离，记忆层组装时会断言 userId 一致，
 * 从代码层面阻断跨用户提示词串号。
 */
export function buildReplyMessages(input: ReplyPromptInput): ChatMessage[] {
  const identity = userIdentityRepo.find(input.persona.id, input.userId);
  const redactNames = userIdentityRepo
    .listByPersona(input.persona.id)
    .flatMap((i) => [i.nickname, i.realName])
    .filter((n) => n && n.trim().length >= 2);

  const { full } = assembleSystemPrompt(input.persona, {
    userId: input.userId,
    userIdentity: identity,
    redactNames,
    memoryFiles: input.memoryFiles,
    coreMemories: input.coreMemories,
    schedule: input.schedule,
    contextSummary: input.contextSummary,
    agentEnabled: input.agentEnabled,
  });

  const memoryBlock = buildMemoryContextBlock({
    relevant: input.relevant,
    conversationState: input.state,
  });
  const timeLine = buildTimeLine({ timezone: input.timezone, now: input.now });

  const userContent = buildUserContent(
    input.fileContext,
    input.imageContext,
    input.processed,
    input.imageParts,
    input.hasFaces,
    timeLine,
  );

  const messages: ChatMessage[] = [
    { role: "system", content: full },
    ...(memoryBlock ? [{ role: "system" as const, content: memoryBlock }] : []),
    ...input.history,
    { role: "user", content: userContent },
  ];
  if (input.guardrail) messages.push({ role: "system", content: input.guardrail });
  return messages;
}

function buildUserContent(
  fileContext: string | undefined,
  imageContext: string | undefined,
  processed: string,
  imageParts: ImageContentPart[] | undefined,
  hasFaces: boolean | undefined,
  timeLine: string | undefined,
): ChatMessage["content"] {
  const textBlocks: string[] = [];
  if (fileContext) textBlocks.push(fileContext);
  if (imageContext) textBlocks.push(`【用户发来的图片内容（视觉模型转述，供你理解）】\n${imageContext}`);
  let main = processed;
  if (hasFaces) main = main ? `${main}\n（用户还发了一个表情包，权重很低，通常无需专门回应）` : "（用户发了一个表情包，权重很低，通常无需专门回应）";
  if (main) textBlocks.push(main);
  if (timeLine?.trim()) textBlocks.push(`# 当前时间\n${timeLine.trim()}`);
  const text = textBlocks.join("\n\n");
  if (imageParts?.length) {
    const parts: ContentPart[] = [];
    if (text) parts.push({ type: "text", text });
    parts.push(...imageParts);
    return parts;
  }
  return text;
}
