import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { conversationRepo } from "../db/repos/conversations";
import { contextRepo } from "../db/repos/context";
import { profileRepo } from "../db/repos/profiles";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderForBot, resolveVisionFallbackModel } from "../llm/factory";
import { contentToText } from "../llm/provider";
import { isVisionRejection } from "../llm/vision";
import { imageLimitFor } from "../llm/multimodal";
import { describeImagesWithFallback } from "../llm/vision-describe";
import { assembleSystemPrompt, buildTurnContext } from "../persona/prompt";
import { buildMemoryInjection, syncMemoryFiles } from "../memory/service";
import { extractUserHabits } from "../memory/profile";
import { captureRealtimeFacts } from "../memory/realtime";
import { buildScheduleContext } from "../memory/schedule";
import { generatePainting, canPaint, type PaintingResult } from "../painting/service";
import { notifyUserReplied } from "../proactive/service";
import { QQApiClient } from "../qq/client";
import { settingsService } from "../settings/service";
import { logger } from "../logger";
import { sysLog } from "../logging";
import type { Bot, ChatMessage, ContentPart, ImageContentPart, LLMUsage, Persona, QQAttachment, QQMessageEvent } from "../types";
import { formatDate, sleep } from "../utils/id";
import { splitReply } from "../utils/text";
import { systemClock } from "../utils/clock";
import { buildConversationContext } from "../context/manager";
import { buildGuardrail, violatesGuardrail, sanitizeReply } from "../context/state";
import { buildFileContext, renderFileContext, buildImageParts } from "../attachments/service";
import { pickQQImages, mediaPlaceholder, QQ_IMAGE_MAX_BYTES } from "../qq/capabilities";
import { detectShellCommand, formatShellReply, runAgentLoop } from "../agent";
import { isUserAllowedForShell, runShellCommand } from "../agent/shell";
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
  /** 本轮用户发来的图片（多模态），仅注入当前请求，不写入会话历史 */
  imageParts?: ImageContentPart[];
  /** 主模型不支持读图时，由视觉副模型生成的图片文本转述 */
  imageContext?: string;
  /** 本轮上下文（相关记忆 / 当前状态 / 当前时间），注入用户消息一侧而非 system，保持 system 前缀稳定 */
  turnContext?: string;
  /** 用户本轮是否发了表情包（低权重上下文标注） */
  hasFaces?: boolean;
  /** 用于中止在途 LLM / 工具调用（消息打断） */
  signal?: AbortSignal;
}

function buildUserContent(
  fileContext: string | undefined,
  imageContext: string | undefined,
  processed: string,
  imageParts: ImageContentPart[] | undefined,
  hasFaces: boolean | undefined,
  turnContext: string | undefined,
): ChatMessage["content"] {
  const textBlocks: string[] = [];
  if (turnContext?.trim()) textBlocks.push(turnContext.trim());
  if (fileContext) textBlocks.push(fileContext);
  if (imageContext) textBlocks.push(`【用户发来的图片内容（视觉模型转述，供你理解）】\n${imageContext}`);
  let main = processed;
  if (hasFaces) main = main ? `${main}\n（用户还发了一个表情包，权重很低，通常无需专门回应）` : "（用户发了一个表情包，权重很低，通常无需专门回应）";
  if (main) textBlocks.push(main);
  const text = textBlocks.join("\n\n");
  if (imageParts?.length) {
    const parts: ContentPart[] = [];
    if (text) parts.push({ type: "text", text });
    parts.push(...imageParts);
    return parts;
  }
  return text;
}

/** 把最近一条用户消息里的图片替换为视觉模型转述，供不支持读图的上游重试。 */
function injectImageDescription(messages: ChatMessage[], description: string): ChatMessage[] {
  const index = messages.map((m) => m.role).lastIndexOf("user");
  if (index === -1) return messages;
  const text = [contentToText(messages[index].content), `【用户图片内容（视觉模型转述）】\n${description}`]
    .filter(Boolean)
    .join("\n\n");
  const next = [...messages];
  next[index] = { ...messages[index], content: text };
  return next;
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

  // 模型按 Bot 分配：优先 Bot 上配置的模型，未配置或不可用时回退到角色配置
  const boundBot = botId ? botRepo.find(botId) : null;
  const resolved = resolveProviderForBot(boundBot, persona);

  // 滑动窗口 + 滚动摘要 + 状态机（每次请求都按最新用户输入更新）
  const context = await buildConversationContext(persona, userId, userText);

  // 按当前话题检索相关记忆，避免全量注入
  const query = [userText, context.state.pendingSubjects.join(" ")].filter(Boolean).join(" ");
  const { files: memoryFiles, relevant, core } = buildMemoryInjection(
    persona,
    userId,
    now,
    query,
    context.state.memoryFileDigests,
  );
  // 记忆文件增量注入会就地对摘要快照打标，持久化回状态，供下一轮判断是否变化
  contextRepo.saveState(persona.id, userId, context.state);
  const schedule = buildScheduleContext(persona, userId, settings.timezone, now);

  // 强制状态校验指令（作业未完成时禁止催睡）
  const guardrail = settings.guardrailEnabled ? buildGuardrail(context.state, persona.name) : null;

  const { full } = assembleSystemPrompt(persona, {
    memoryFiles,
    coreMemories: core,
    schedule,
    contextSummary: context.summary,
    agentEnabled: opts.agentEnabled,
  });

  // 每轮可能变化的内容（相关记忆 / 当前状态 / 当前时间）注入用户消息一侧，
  // 让上方 system prompt 在整段会话内保持字节级稳定，提升 prompt cache 命中率。
  const turnContext = buildTurnContext({
    relevant,
    timezone: settings.timezone,
    now,
    conversationState: context.state,
  });

  const processed = applyCommands(persona, userText);
  const userContent = buildUserContent(
    opts.fileContext,
    opts.imageContext,
    processed,
    opts.imageParts,
    opts.hasFaces,
    turnContext,
  );
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
    const { provider, model } = resolved;
    modelId = model?.id ?? null;
    const temperature = model?.temperature;
    const maxTokens = model?.maxTokens;
    const signal = opts.signal;

    sysLog.info(
      "pipeline",
      "开始生成回复",
      { personaId: persona.id, botId, userId, modelId, stage: "start" },
      {
        persona: persona.name,
        provider: model?.provider ?? null,
        model: model?.modelId ?? null,
        historyCount: context.history.length,
        hasImages: !!opts.imageParts?.length,
        agentEnabled: !!opts.agentEnabled,
        userText,
      },
    );

    // 启用服务器 Agent 且模型支持工具调用时，走「模型自主决定执行 shell」的循环
    const callModel = async (msgs: ChatMessage[]) => {
      // 记录一次模型请求的完整上下文，便于事后复现与排查
      const startedAt = Date.now();
      const toolsEnabled = !!(opts.agentEnabled && provider.supportsTools && provider.chatWithTools);
      const totalChars = msgs.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0);
      sysLog.info(
        "model",
        `请求模型 ${model?.modelId ?? model?.id ?? "unknown"}`,
        {
          personaId: persona.id,
          botId,
          userId,
          modelId: model?.id ?? null,
          provider: model?.provider ?? null,
          stage: "request",
        },
        {
          modelId: model?.modelId ?? null,
          provider: model?.provider ?? null,
          apiBase: model?.apiBase ?? null,
          temperature,
          maxTokens,
          messageCount: msgs.length,
          totalChars,
          toolsEnabled,
          messages: msgs.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "[多模态内容]" })),
        },
      );
      try {
        const result = toolsEnabled
          ? await runAgentLoop(provider, msgs, { temperature, maxTokens, signal })
          : await provider.chat(msgs, { temperature, maxTokens, signal });
        const durationMs = Date.now() - startedAt;
        sysLog.info(
          "model",
          `模型响应成功（${durationMs}ms）`,
          {
            personaId: persona.id,
            botId,
            userId,
            modelId: model?.id ?? null,
            provider: model?.provider ?? null,
            stage: "response",
            durationMs,
          },
          {
            replyChars: result.content?.length ?? 0,
            reply: result.content,
            usage: result.usage,
          },
        );
        return result;
      } catch (err) {
        const durationMs = Date.now() - startedAt;
        sysLog.error(
          "error",
          `模型请求失败：${(err as Error).message}`,
          {
            personaId: persona.id,
            botId,
            userId,
            modelId: model?.id ?? null,
            provider: model?.provider ?? null,
            stage: "model_request",
            durationMs,
          },
          {
            error: (err as Error).message,
            name: (err as Error).name,
            status: (err as any)?.status ?? null,
            stack: (err as Error).stack,
          },
        );
        throw err;
      }
    };

    try {
      const run = await callModel(messages);
      reply = run.content.trim();
      usage = run.usage;
      if (!reply && opts.agentEnabled && provider.supportsTools && provider.chatWithTools) {
        reply = "（命令已经执行完了，不过我没有需要额外补充的。）";
      }
    } catch (err) {
      // 模型自报支持读图、上游却拒绝图片：用视觉副模型转述后重试一次纯文本请求。
      if (!opts.imageParts?.length || !isVisionRejection(err)) throw err;
      logger.warn({ personaId: persona.id, modelId: model?.id }, "upstream rejected image input, retrying with converted description");
      sysLog.warn(
        "vision",
        "上游拒绝图片输入，改用视觉副模型转述后重试",
        { personaId: persona.id, botId, userId, modelId, stage: "vision_fallback" },
        { error: (err as Error).message },
      );
      const described = await describeImagesWithFallback(opts.imageParts, { primaryModelId: model?.id, signal });
      if (!described) throw err;
      const retry = await callModel(injectImageDescription(messages, described.text));
      reply = retry.content.trim();
      usage = retry.usage;
    }

    // 请求后拦截校验：作业未完成却输出催睡词 -> 丢弃并带强制警告重试一次
    if (guardrail && violatesGuardrail(reply, context.state)) {
      logger.warn({ personaId: persona.id, userId }, "guardrail violated, retrying with forced instruction");
      sysLog.warn(
        "pipeline",
        "回复触发状态护栏，带强制指令重试",
        { personaId: persona.id, botId, userId, modelId, stage: "guardrail" },
        { reply },
      );
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
    sysLog.error(
      "error",
      `生成回复失败：${(err as Error).message}`,
      { personaId: persona.id, botId, userId, modelId, stage: "generate_reply" },
      {
        error: (err as Error).message,
        name: (err as Error).name,
        stack: (err as Error).stack,
        aborted: attemptedAbort,
      },
    );
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

  // 实时记忆：命中重要信息时立即落库（异步，不阻塞回复），下一轮即可想起
  void captureRealtimeFacts(persona, userId, userText, reply).catch(() => undefined);

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
  faceCount: number;
  imageUrls: string[];
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
    const hasFaces = !!event.faces?.length;
    const hasImages = !!event.imageUrls?.length;
    if (!event.content && !hasAttachments && !hasFaces && !hasImages) return;
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
        faceCount: 0,
        imageUrls: [],
        lastEvent: event,
        timer: null,
        abort: null,
        running: false,
      };
      this.batches.set(key, batch);
    }
    if (event.content) batch.contents.push(event.content);
    if (hasAttachments) batch.attachments.push(...event.attachments!);
    if (hasFaces) batch.faceCount += event.faces!.length;
    if (hasImages) batch.imageUrls.push(...event.imageUrls!);
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
    const faceCount = batch.faceCount;
    const imageUrls = batch.imageUrls;
    batch.contents = [];
    batch.attachments = [];
    batch.faceCount = 0;
    batch.imageUrls = [];
    const hasRealContent = merged.trim().length > 0 || attachments.length > 0 || imageUrls.length > 0;
    // 只有表情包、没有文字/图片/文件时不触发回复
    if (!hasRealContent) {
      if (faceCount > 0) {
        logger.debug({ key }, "emoji-only message ignored");
      }
      this.batches.delete(key);
      return;
    }

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
        if (!isUserAllowedForShell(settings.agentShellAllowedUsers, batch.userId)) {
          await this.send(batch, "当前用户没有执行服务器命令的权限。");
          this.batches.delete(key);
          return;
        }
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

    // 图片处理：主模型支持视觉就直接发图；不支持则用视觉副模型转述成文本。
    let imageParts: ImageContentPart[] = [];
    let imageContext = "";
    if (imageUrls.length) {
      const { model } = resolveProviderForBot(batch.bot, batch.persona);
      const supportsVision = !!model?.supportsVision;
      const fallback = supportsVision ? null : resolveVisionFallbackModel(model?.id);
      if (!supportsVision && !fallback) {
        logger.info({ key, modelId: model?.id }, "image received but no vision model available");
        await this.send(batch, "【当前模型不支持读图，且未配置视觉副模型。请切换支持读图的模型，或在设置中选择视觉副模型】");
        this.batches.delete(key);
        return;
      }

      // 按 QQ 开放平台约束收敛图片：仅图片类型，单条最多 5 张
      const imageAtts: QQAttachment[] = imageUrls.map((url) => ({ url }));
      const { images, overflow } = pickQQImages(imageAtts);
      if (overflow > 0) {
        logger.info({ key, overflow }, "qq attachment count exceeds platform limit, extra images ignored");
      }
      // 同时满足 QQ 平台与上游厂商的大小/格式限制（取更严格的一方）
      const providerLimit = imageLimitFor(model?.provider);
      const limit = { ...providerLimit, maxBytes: Math.min(QQ_IMAGE_MAX_BYTES, providerLimit.maxBytes) };
      const { parts, skipped } = await buildImageParts(images, limit);
      imageParts = parts;
      if (!imageParts.length) {
        logger.warn({ key, skipped }, "all images failed to decode");
        if (!merged.trim() && !fileContext) {
          const reason = skipped[0]?.reason ?? "下载失败";
          await this.send(batch, `【图片读取失败：${reason}】`);
          this.batches.delete(key);
          return;
        }
      }

      if (imageParts.length && !supportsVision) {
        const described = await describeImagesWithFallback(imageParts, { primaryModelId: model?.id });
        if (!described) {
          await this.send(batch, "【图片暂时无法识别，请稍后再试，或切换支持读图的模型】");
          this.batches.delete(key);
          return;
        }
        imageContext = described.text;
        imageParts = [];
      }

      // 纯图片消息没有正文：注入平台占位符，保证模型仍能起一轮对话
      if (!merged.trim() && !fileContext && (imageParts.length || imageContext)) {
        merged = mediaPlaceholder(imageAtts) ?? "(image)";
      }
    }

    batch.running = true;
    const abort = new AbortController();
    batch.abort = abort;
    registerAbort(key, abort);

    try {
      const { reply, painting } = await generateReply(batch.persona, batch.userId, merged, batch.bot.id, {
        agentEnabled: batch.bot.agentEnabled,
        fileContext,
        imageContext,
        imageParts,
        hasFaces: faceCount > 0,
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
    if (!batch.timer && batch.contents.length === 0 && batch.attachments.length === 0 && batch.imageUrls.length === 0 && batch.faceCount === 0) {
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
