import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { conversationRepo } from "../db/repos/conversations";
import { profileRepo } from "../db/repos/profiles";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderForPersona } from "../llm/factory";
import { assembleSystemPrompt } from "../persona/prompt";
import { buildMemoryInjection, syncMemoryFiles } from "../memory/service";
import { extractUserHabits } from "../memory/profile";
import { generatePainting, canPaint, type PaintingResult } from "../painting/service";
import { notifyUserReplied } from "../proactive/service";
import { QQApiClient } from "../qq/client";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import type { Bot, ChatMessage, LLMUsage, Persona, QQAttachment, QQMessageEvent } from "../types";
import { formatDate, sleep } from "../utils/id";
import { splitReply } from "../utils/text";
import { systemClock } from "../utils/clock";
import { buildConversationContext } from "../context/manager";
import { buildGuardrail, violatesGuardrail, sanitizeReply } from "../context/state";
import { buildFileContext, renderFileContext } from "../attachments/service";
import { detectShellCommand, formatShellReply, runAgentLoop } from "../agent";
import { runShellCommand } from "../agent/shell";
import { filterText } from "../moderation/filter";
import { clearAbort, abortActive, registerAbort } from "./abort-store";

const PAINT_KEYWORDS = ["画一张", "画个", "画幅", "画画", "画一下", "帮我画", "给我画", "作画", "绘一张", "来张图"];

export interface GenerateResult {
  reply: string;
  usage: LLMUsage;
  modelId: string | null;
  painting?: PaintingResult;
}

function applyCommands(persona: Persona, text: string): string {
  if (!persona.commands?.length) return text;
  const trimmed = text.trim();
  const matched = persona.commands.find((c) => c.trigger && trimmed.startsWith(c.trigger));
  if (!matched) return text;
  const rest = trimmed.slice(matched.trigger.length).trim();
  return `[触发命令: ${matched.name}] ${matched.prompt}\n\n${rest}`.trim();
}

function wantsPainting(text: string): boolean {
  return PAINT_KEYWORDS.some((k) => text.includes(k));
}

/**
 * 生成一次角色回复：组装 prompt、调用 LLM、追加会话、记录统计。
 * 同时用于 QQ 消息、主动消息与本地模拟。
 */
export interface GenerateOptions {
  /** 该 Bot 是否启用了服务器本地 Agent（可调用 shell 工具） */
  agentEnabled?: boolean;
  /** 本轮用户上传文件解析出的文本，仅注入当前请求，不写入会话历史 */
  fileContext?: string;
  /** 用于中止在途 LLM / 工具调用（消息打断） */
  signal?: AbortSignal;
}

export async function generateReply(
  persona: Persona,
  userId: string,
  userText: string,
  botId?: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const now = systemClock.now();
  const settings = settingsService.get();

  // 滑动窗口 + 滚动摘要 + 状态机（每次请求都按最新用户输入更新）
  const context = await buildConversationContext(persona, userId, userText);

  // 按当前话题检索相关记忆，避免全量注入
  const query = [userText, context.state.pendingSubjects.join(" ")].filter(Boolean).join(" ");
  const { files: memoryFiles, relevant } = buildMemoryInjection(persona, userId, now, query);

  // 强制状态校验指令（作业未完成时禁止催睡）
  const guardrail = settings.guardrailEnabled ? buildGuardrail(context.state, persona.name) : null;

  const { prefix, full } = assembleSystemPrompt(persona, {
    memoryFiles,
    relevant,
    timezone: settings.timezone,
    now,
    contextSummary: context.summary,
    conversationState: context.state,
    agentEnabled: opts.agentEnabled,
  });

  const processed = applyCommands(persona, userText);
  const userContent = opts.fileContext ? `${opts.fileContext}\n\n${processed}` : processed;
  const messages: ChatMessage[] = [
    { role: "system", content: full },
    ...context.history,
    { role: "user", content: userContent },
  ];
  if (guardrail) messages.push({ role: "system", content: guardrail });

  let reply: string;
  let usage: LLMUsage;
  let modelId: string | null = null;

  // 绘画意图优先
  if (canPaint(persona) && wantsPainting(userText)) {
    const painting = await generatePainting(persona, userId, userText);
    if (painting.ok) {
      reply = `（${persona.name}画好了）${painting.prompt ?? ""}`.trim();
      usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    } else {
      reply = `（${persona.name}没法画出来：${painting.reason}）`;
      usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
    }
    conversationRepo.append(persona.id, userId, [
      { role: "user", content: processed, timestamp: Date.now() },
      { role: "assistant", content: reply, timestamp: Date.now() },
    ]);
    profileRepo.touchInteraction(persona.id, userId);
    logRepo.message({ personaId: persona.id, botId, userId, direction: "in", content: userText });
    logRepo.message({ personaId: persona.id, botId, userId, direction: "out", content: reply });
    statsRepo.increment(formatDate(), persona.id, { messages: 2 });
    syncMemoryFiles(persona, userId);
    return { reply, usage, modelId, painting };
  }

  let attemptedAbort = false;
  try {
    const { provider, model } = resolveProviderForPersona(persona);
    modelId = model?.id ?? null;
    const temperature = persona.modelConfig.temperature ?? model?.temperature;
    const maxTokens = persona.modelConfig.maxTokens ?? model?.maxTokens;
    const signal = opts.signal;

    // 启用服务器 Agent 且模型支持工具调用时，走「模型自主决定执行 shell」的循环
    if (opts.agentEnabled && provider.supportsTools && provider.chatWithTools) {
      const run = await runAgentLoop(provider, messages, { temperature, maxTokens, signal });
      reply = run.content.trim() || "（命令已经执行完了，不过我没有需要额外补充的。）";
      usage = run.usage;
    } else {
      const result = await provider.chat(messages, { temperature, maxTokens, signal });
      reply = result.content;
      usage = result.usage;
    }

    // 请求后拦截校验：作业未完成却输出催睡词 -> 丢弃并带强制警告重试一次
    if (guardrail && violatesGuardrail(reply, context.state)) {
      logger.warn({ personaId: persona.id, userId }, "guardrail violated, retrying with forced instruction");
      const retryMessages: ChatMessage[] = [
        ...messages,
        {
          role: "system",
          content:
            "你上一条回复违反了状态约束：用户在作业未完成时需要的是任务拆解与陪伴，而不是催促休息。请严格遵守上方【系统强制警告】重新回复。",
        },
      ];
      const retry = await provider.chat(retryMessages, { temperature, maxTokens });
      usage = {
        inputTokens: usage.inputTokens + retry.usage.inputTokens,
        outputTokens: usage.outputTokens + retry.usage.outputTokens,
        cacheHitTokens: usage.cacheHitTokens + retry.usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens + retry.usage.cacheMissTokens,
      };
      reply = retry.content;
      // 重试仍违规：代码层兜底，移除催睡句子
      if (violatesGuardrail(reply, context.state)) {
        logger.warn({ personaId: persona.id, userId }, "guardrail still violated after retry, sanitizing");
        reply = sanitizeReply(reply);
      }
    }
  } catch (err) {
    attemptedAbort = (err as Error).message.includes("abort");
    logger.error({ personaId: persona.id, err: (err as Error).message }, "generate reply failed");
    reply = attemptedAbort ? "" : `（${persona.name}走神了，暂时没能回复，请稍后再试）`;
    usage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
  }

  if (attemptedAbort && !reply) {
    throw new Error("aborted");
  }

  conversationRepo.append(persona.id, userId, [
    { role: "user", content: processed, timestamp: Date.now() },
    { role: "assistant", content: reply, timestamp: Date.now() },
  ]);
  profileRepo.touchInteraction(persona.id, userId);
  logRepo.message({ personaId: persona.id, botId, userId, direction: "in", content: userText });
  logRepo.message({ personaId: persona.id, botId, userId, direction: "out", content: reply });
  logRepo.usage({ modelId, personaId: persona.id, usage });
  statsRepo.increment(formatDate(), persona.id, {
    tokenConsumed: usage.inputTokens + usage.outputTokens,
    cacheHitTokens: usage.cacheHitTokens,
    cacheMissTokens: usage.cacheMissTokens,
    messages: 2,
  });
  syncMemoryFiles(persona, userId);

  // 异步更新用户画像，不阻塞回复
  void extractUserHabits(persona, userId).catch(() => undefined);

  return { reply, usage, modelId };
}

interface Batch {
  bot: Bot;
  persona: Persona;
  userId: string;
  contents: string[];
  attachments: QQAttachment[];
  lastEvent: QQMessageEvent;
  timer: NodeJS.Timeout | null;
  abort: AbortController | null;
  running: boolean;
}

/**
 * 消息处理管道：防抖合并 + 取消旧任务 + 单条完整回复。
 */
class MessagePipeline {
  private batches = new Map<string, Batch>();

  handle(bot: Bot, event: QQMessageEvent): void {
    const hasAttachments = !!event.attachments?.length;
    if (!event.content && !hasAttachments) return;
    const persona = bot.personaId ? personaRepo.find(bot.personaId) : null;
    if (!persona || !persona.enabled) {
      logger.debug({ botId: bot.id }, "no enabled persona bound, ignore message");
      return;
    }
    const key = `${bot.id}:${event.authorId}`;
    notifyUserReplied(persona.id, event.authorId);
    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        bot,
        persona,
        userId: event.authorId,
        contents: [],
        attachments: [],
        lastEvent: event,
        timer: null,
        abort: null,
        running: false,
      };
      this.batches.set(key, batch);
    }
    if (event.content) batch.contents.push(event.content);
    if (hasAttachments) batch.attachments.push(...event.attachments!);
    batch.lastEvent = event;
    batch.persona = persona;

    // 取消正在进行的旧任务（消息打断）
    if (batch.running && batch.abort) {
      batch.abort.abort();
      batch.abort = null;
      batch.running = false;
    }
    // 兜底：即便 batch 已丢失本地引用，也中止注册表中的在途请求，避免旧回复覆盖新回复
    abortActive(key);
    if (batch.timer) clearTimeout(batch.timer);

    const debounce = settingsService.get().messageDebounceMs;
    batch.timer = setTimeout(() => void this.flush(key), debounce);
  }

  private async flush(key: string): Promise<void> {
    const batch = this.batches.get(key);
    if (!batch) return;
    batch.timer = null;
    let merged = batch.contents.join("\n");
    const attachments = batch.attachments;
    batch.contents = [];
    batch.attachments = [];
    if (!merged.trim() && attachments.length === 0) return;

    const settings = settingsService.get();

    // 敏感词过滤（可选）：命中用户消息时按策略拦截或替换
    const moderation = filterText(merged);
    if (moderation.filtered && moderation.action === "block") {
      logger.info({ key, matched: moderation.matched }, "message blocked by keyword filter");
      await this.send(batch, "这个话题我们换个方向聊聊吧～");
      this.batches.delete(key);
      return;
    }
    if (moderation.filtered) merged = moderation.text;

    // 服务器 Agent 前缀命令：无需模型参与，直接执行并回传结果
    if (batch.bot.agentEnabled) {
      const command = detectShellCommand(merged, settings.agentShellPrefix);
      if (command) {
        batch.running = true;
        const abort = new AbortController();
        batch.abort = abort;
        try {
          const result = await runShellCommand(command);
          if (abort.signal.aborted) return;
          await this.send(batch, formatShellReply(command, result));
        } catch (err) {
          logger.error({ key, err: (err as Error).message }, "shell command failed");
        } finally {
          this.finishBatch(key, batch, abort);
        }
        return;
      }
    }

    // 解析用户发来的文本类文件，作为本轮请求的临时上下文
    let fileContext = "";
    if (attachments.length) {
      const parsed = await buildFileContext(attachments);
      fileContext = renderFileContext(parsed);
    }

    batch.running = true;
    const abort = new AbortController();
    batch.abort = abort;
    registerAbort(key, abort);

    try {
      const { reply, painting } = await generateReply(batch.persona, batch.userId, merged, batch.bot.id, {
        agentEnabled: batch.bot.agentEnabled,
        fileContext,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      await this.send(batch, reply, painting);
    } catch (err) {
      if ((err as Error).message !== "aborted") {
        logger.error({ key, err: (err as Error).message }, "pipeline flush failed");
      }
    } finally {
      clearAbort(key, abort);
      this.finishBatch(key, batch, abort);
    }
  }

  private finishBatch(key: string, batch: Batch, abort: AbortController): void {
    if (batch.abort === abort) {
      batch.abort = null;
      batch.running = false;
    }
    if (!batch.timer && batch.contents.length === 0 && batch.attachments.length === 0) {
      this.batches.delete(key);
    }
  }

  private async send(batch: Batch, reply: string, painting?: PaintingResult): Promise<void> {
    const client = new QQApiClient(batch.bot);
    const event = batch.lastEvent;
    const settings = settingsService.get();
    try {
      if (painting?.ok && (painting.imageUrl || painting.imageBase64)) {
        const scope =
          event.type === "c2c"
            ? ({ type: "c2c", openid: event.authorId } as const)
            : event.type === "group"
              ? ({ type: "group", groupOpenid: event.groupOpenid! } as const)
              : null;
        if (scope) {
          const fileInfo = await client.uploadFile(scope, { url: painting.imageUrl, base64: painting.imageBase64 });
          if (fileInfo) {
            await client.sendImageByFileInfo(scope, fileInfo, event.msgId);
            return;
          }
        }
      }

      // 多行回复拆分为多条消息，携带同一 msg_id 与递增 msg_seq。
      // 被动回复上限：单聊 4 次 / 群聊 5 次，超出部分合并进最后一条。
      const sceneCap = event.type === "c2c" ? 4 : event.type === "group" ? 5 : settings.splitMaxMessages;
      const maxParts = Math.max(1, Math.min(settings.splitMaxMessages, sceneCap));
      const segments = settings.splitMessages ? splitReply(reply, maxParts) : [reply];
      if (!segments.length) return;

      for (let i = 0; i < segments.length; i++) {
        const msgSeq = i + 1;
        const segment = segments[i];
        if (event.type === "c2c") {
          await client.sendC2C(event.authorId, segment, event.msgId, msgSeq);
        } else if (event.type === "group") {
          await client.sendGroup(event.groupOpenid!, segment, event.msgId, msgSeq);
        } else if (event.type === "guild") {
          await client.sendGuildChannel(event.channelId!, segment, event.msgId);
        } else if (event.type === "direct") {
          await client.sendDirect(event.guildId!, segment, event.msgId);
        }
        if (i < segments.length - 1) await sleep(300);
      }
    } catch (err) {
      logger.error({ botId: batch.bot.id, err: (err as Error).message }, "send reply failed");
    }
  }

  /** 本地模拟：不经 QQ，直接返回角色回复，用于后台调试。 */
  async simulate(personaId: string, userId: string, text: string): Promise<GenerateResult> {
    const persona = personaRepo.find(personaId);
    if (!persona) throw new Error("角色不存在");
    return generateReply(persona, userId, text);
  }

  activeCount(): number {
    return this.batches.size;
  }
}

export const messagePipeline = new MessagePipeline();
