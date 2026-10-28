import { botRepo } from "../db/repos/bots";
import { personaRepo } from "../db/repos/personas";
import { conversationRepo } from "../db/repos/conversations";
import { contextRepo } from "../db/repos/context";
import { profileRepo } from "../db/repos/profiles";
import { logRepo } from "../db/repos/logs";
import { statsRepo } from "../db/repos/stats";
import { resolveProviderChain, resolveProviderForBot, resolveVisionFallbackModel, type ProviderCandidate } from "../llm/factory";
import { circuitBreaker } from "../llm/circuit-breaker";
import { contentToText } from "../llm/provider";
import { isVisionRejection } from "../llm/vision";
import { imageLimitFor } from "../llm/multimodal";
import { describeImagesWithFallback } from "../llm/vision-describe";
import { buildReplyMessages } from "./prompt-build";
import { firstSentenceEnd } from "../llm/stream";
import type { StreamEvent, StreamEventListener } from "./stream-events";
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
import { pickQQImages, mediaPlaceholder, isQQImageAttachment, QQ_IMAGE_MAX_BYTES } from "../qq/capabilities";
import { detectShellCommand, formatShellReply, runToolLoop, SHELL_AGENT_TOOL, type AgentTool } from "../agent";
import { isUserAllowedForShell, runShellCommand } from "../agent/shell";
import { filterText } from "../moderation/filter";
import { clearAbort, abortActive, registerAbort } from "./abort-store";
import { inspectReply, qualityRetryInstruction } from "./reply-quality";
import { searchProviderRepo } from "../db/repos/search-providers";
import { WEB_SEARCH_TOOL, formatSearchResults, runWebSearch } from "../search/service";

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
  /** 流式事件回调：逐块文本、首条气泡、完成与中断。 */
  onEvent?: StreamEventListener;
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
  // 场景判定：闲聊默认关闭思考以压低延迟；长文/剧情/工具调用等复杂场景才允许思考。
  const reasoningScene =
    !!opts.agentEnabled ||
    userText.length >= 400 ||
    wantsPainting(userText) ||
    /剧情|长篇|写作|分析|推理|代码|debug|重构/i.test(userText);

  // 模型候选链：Bot 绑定模型优先，其余已启用模型按顺序兜底；熔断中的模型会被跳过。
  const chain = resolveProviderChain(boundBot, persona, reasoningScene ? "reasoning" : "chat");

  // 联网搜索：仅当 Bot 开启且配置了可用的搜索提供商时，才向模型暴露 web_search 工具。
  const searchProvider = (() => {
    if (!boundBot?.searchEnabled) return null;
    if (boundBot.searchProviderId) {
      const picked = searchProviderRepo.find(boundBot.searchProviderId);
      if (picked?.enabled) return picked;
    }
    return searchProviderRepo.listEnabled()[0] ?? null;
  })();

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

  const processed = applyCommands(persona, userText);
  // 三层提示词由统一构建器组装：角色层 / 用户层（按 userId 隔离）/ 记忆层（按 userId 隔离），
  // 记忆层组装时断言 userId 一致，从代码层面阻断跨用户串号。
  const messages = buildReplyMessages({
    persona,
    userId,
    processed,
    history: context.history,
    memoryFiles,
    coreMemories: core,
    schedule,
    contextSummary: context.summary,
    relevant,
    state: context.state,
    guardrail,
    agentEnabled: opts.agentEnabled,
    fileContext: opts.fileContext,
    imageContext: opts.imageContext,
    imageParts: opts.imageParts,
    hasFaces: opts.hasFaces,
    timezone: settings.timezone,
    now,
  });

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
    opts.onEvent?.({ type: "done", reply });
    return { reply, usage, modelId, painting };
  }

  try {
    const signal = opts.signal;
    let active: ProviderCandidate = chain[0];
    modelId = active.model?.id ?? null;

    sysLog.info(
      "pipeline",
      "开始生成回复",
      { personaId: persona.id, botId, userId, modelId, stage: "start" },
      {
        persona: persona.name,
        provider: active.model?.provider ?? null,
        model: active.model?.modelId ?? null,
        fallbackChain: chain.map((c) => c.model?.id ?? "mock"),
        historyCount: context.history.length,
        hasImages: !!opts.imageParts?.length,
        agentEnabled: !!opts.agentEnabled,
        userText,
      },
    );

    // 按 Bot 配置组装工具：shell 仅在该 Bot 开启 Agent 时暴露，搜索仅在开启且配置了提供商时暴露。
    const tools: AgentTool[] = [];
    if (opts.agentEnabled) tools.push(SHELL_AGENT_TOOL);
    if (searchProvider) {
      const providerConfig = searchProvider;
      tools.push({
        definition: WEB_SEARCH_TOOL,
        execute: async (args) => {
          const query = String((args as any)?.query ?? "").trim();
          if (!query) return { output: "错误：工具调用未提供 query 参数", ok: false };
          try {
            const results = await runWebSearch(providerConfig, query, Number((args as any)?.count) || undefined);
            return { output: formatSearchResults(query, results), ok: true };
          } catch (err) {
            return { output: `联网搜索失败：${(err as Error).message}`, ok: false };
          }
        },
      });
    }

    // 本轮已经吐出多少可见字符：一旦开始流式下发，就不能再静默重试/切换模型，否则会重复发送。
    let streamedChars = 0;

    const callModel = async (msgs: ChatMessage[], cand: ProviderCandidate) => {
      const { provider, model } = cand;
      const temperature = model?.temperature;
      // 复杂场景保留思考时需要足够预算，避免正文被推理 token 挤空；
      // 闲聊场景直接关闭思考，2048 已足够。
      const maxTokens = reasoningScene
        ? Math.max(model?.maxTokens ?? 2048, 4096)
        : model?.maxTokens;
      // 记录一次模型请求的完整上下文，便于事后复现与排查
      const startedAt = Date.now();
      const toolsEnabled = !!(tools.length && provider.supportsTools && provider.chatWithTools);
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
        const canStream = !toolsEnabled && !!opts.onEvent && typeof provider.chatStream === "function";
        if (canStream) {
          let text = "";
          let usage: LLMUsage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 };
          let modelName = provider.model;
          let firstTokenAt = 0;
          for await (const chunk of provider.chatStream!(msgs, {
            temperature,
            maxTokens,
            signal,
            thinking: reasoningScene,
          })) {
            if (chunk.delta) {
              text += chunk.delta;
              if (!firstTokenAt) firstTokenAt = Date.now();
              streamedChars += chunk.delta.length;
              opts.onEvent!({
                type: "delta",
                text,
                delta: chunk.delta,
                ttftMs: firstTokenAt - startedAt,
              });
            }
            if (chunk.usage) usage = chunk.usage;
            if (chunk.model) modelName = chunk.model;
          }
          const durationMs = Date.now() - startedAt;
          const ttftMs = firstTokenAt ? firstTokenAt - startedAt : null;
          sysLog.info(
            "model",
            `模型流式响应完成（${durationMs}ms，TTFT ${ttftMs ?? "?"}ms）`,
            {
              personaId: persona.id,
              botId,
              userId,
              modelId: model?.id ?? null,
              provider: model?.provider ?? null,
              stage: "response",
              durationMs,
            },
            { replyChars: text.length, ttftMs, usage },
          );
          return { content: text, usage, model: modelName };
        }

        const result = toolsEnabled
          ? await runToolLoop(provider, msgs, tools, { temperature, maxTokens, signal, thinking: reasoningScene })
          : await provider.chat(msgs, { temperature, maxTokens, signal, thinking: reasoningScene });
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
        const toolRuns = (result as { toolRuns?: { name: string; args: Record<string, unknown>; output: string; ok: boolean }[] })
          .toolRuns;
        if (toolRuns?.length) {
          sysLog.info(
            "pipeline",
            `模型调用工具：${toolRuns.map((r) => r.name).join("、")}`,
            { personaId: persona.id, botId, userId, modelId: model?.id ?? null, stage: "tool" },
            {
              toolRuns: toolRuns.map((r) => ({
                name: r.name,
                args: r.args,
                ok: r.ok,
                outputChars: r.output.length,
                output: r.name === WEB_SEARCH_TOOL.name ? r.output.slice(0, 2000) : undefined,
              })),
            },
          );
        }
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

    // 网络抖动 / 上游失败时静默重试；同一模型重试仍失败则切换候选模型（熔断中跳过）。
    // 候选数受控：主模型 2 次尝试，其余候选各 1 次，避免延迟爆炸。
    const callModelWithRetry = async (msgs: ChatMessage[]): Promise<{ run: Awaited<ReturnType<typeof callModel>>; candidate: ProviderCandidate }> => {
      const available = chain.filter((c) => !circuitBreaker.isOpen(c.model?.id));
      // 全部熔断时仍尝试主模型一次，避免长时间无回复。
      const candidates = available.length ? available : chain.slice(0, 1);
      let lastErr: unknown = null;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const maxAttempts = i === 0 ? 2 : 1;
        streamedChars = 0;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const run = await callModel(msgs, cand);
            circuitBreaker.recordSuccess(cand.model?.id);
            if (i > 0) {
              sysLog.warn(
                "model",
                `已切换到备用模型 ${cand.model?.modelId ?? "mock"}`,
                { personaId: persona.id, botId, userId, modelId: cand.model?.id ?? null, stage: "failover" },
                { from: active.model?.id ?? null, to: cand.model?.id ?? null },
              );
            }
            return { run, candidate: cand };
          } catch (err) {
            lastErr = err;
            const message = (err as Error)?.message ?? "";
            const aborted =
              message.includes("abort") || (err as Error)?.name === "AbortError" || !!signal?.aborted;
            if (aborted) throw err;
            // 已经开始向下游吐字，不能重试或切换模型，否则会出现重复气泡。
            if (streamedChars > 0) throw err;
            circuitBreaker.recordFailure(cand.model?.id);
            const hasNext = attempt < maxAttempts || i < candidates.length - 1;
            if (!hasNext) break;
            if (attempt < maxAttempts) {
              const delayMs = 700 * attempt * attempt;
              sysLog.warn(
                "model",
                `模型请求失败，${delayMs}ms 后重试（第 ${attempt} 次）`,
                { personaId: persona.id, botId, userId, modelId: cand.model?.id ?? null, stage: "retry" },
                { error: message, attempt, delayMs, modelId: cand.model?.id ?? null },
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "model request failed"));
    };

    try {
      const first = await callModelWithRetry(messages);
      active = first.candidate;
      modelId = active.model?.id ?? null;
      const run = first.run;
      reply = run.content.trim();
      usage = run.usage;
      if (!reply && opts.agentEnabled && active.provider.supportsTools && active.provider.chatWithTools) {
        reply = "（命令已经执行完了，不过我没有需要额外补充的。）";
      }
    } catch (err) {
      // 模型自报支持读图、上游却拒绝图片：用视觉副模型转述后重试一次纯文本请求。
      if (!opts.imageParts?.length || !isVisionRejection(err)) throw err;
      logger.warn({ personaId: persona.id, modelId: active.model?.id }, "upstream rejected image input, retrying with converted description");
      sysLog.warn(
        "vision",
        "上游拒绝图片输入，改用视觉副模型转述后重试",
        { personaId: persona.id, botId, userId, modelId, stage: "vision_fallback" },
        { error: (err as Error).message },
      );
      const described = await describeImagesWithFallback(opts.imageParts, { primaryModelId: active.model?.id, signal });
      if (!described) throw err;
      const retried = await callModelWithRetry(injectImageDescription(messages, described.text));
      active = retried.candidate;
      modelId = active.model?.id ?? null;
      reply = retried.run.content.trim();
      usage = retried.run.usage;
    }

    // 请求后拦截校验：作业未完成却输出催睡词 -> 丢弃并带强制警告重试一次
    if (guardrail && violatesGuardrail(reply, context.state)) {
      if (streamedChars > 0) {
        // 已经下发过气泡，无法撤回重试，只能在代码层清理违规句子。
        logger.warn({ personaId: persona.id, userId }, "streamed reply violated guardrail, sanitizing");
        reply = sanitizeReply(reply);
      } else {
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
      const retried = await callModelWithRetry(retryMessages);
      active = retried.candidate;
      modelId = active.model?.id ?? null;
      const retry = retried.run;
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
    }

    // 出站质量闸：明显异常的回复先重试一次，仍不通过则丢弃本轮，避免污染会话历史与长期记忆
    const previousAssistant = [...context.history].reverse().find((m) => m.role === "assistant");
    let issues = inspectReply(reply, previousAssistant ? contentToText(previousAssistant.content) : null);
    if (issues.length && streamedChars > 0) {
      // 已流式下发，不能整体重试；只做代码层清理，避免用户看到前后不一致的两版。
      logger.warn({ personaId: persona.id, userId }, "streamed reply failed quality gate, sanitizing");
      reply = sanitizeReply(reply);
      issues = inspectReply(reply, previousAssistant ? contentToText(previousAssistant.content) : null);
      if (issues.length) {
        sysLog.warn(
          "pipeline",
          "流式回复质量校验未完全通过，保留已下发内容",
          { personaId: persona.id, botId, userId, modelId, stage: "quality_gate" },
          { reply, issues },
        );
      }
    } else if (issues.length) {
      sysLog.warn(
        "pipeline",
        "回复质量校验未通过，带纠错指令重试",
        { personaId: persona.id, botId, userId, modelId, stage: "quality_gate" },
        { reply, issues },
      );
      const retried = await callModelWithRetry([
        ...messages,
        { role: "system", content: qualityRetryInstruction(issues) },
      ]);
      active = retried.candidate;
      modelId = active.model?.id ?? null;
      const retry = retried.run;
      usage = {
        inputTokens: usage.inputTokens + retry.usage.inputTokens,
        outputTokens: usage.outputTokens + retry.usage.outputTokens,
        cacheHitTokens: usage.cacheHitTokens + retry.usage.cacheHitTokens,
        cacheMissTokens: usage.cacheMissTokens + retry.usage.cacheMissTokens,
      };
      reply = retry.content.trim();
      issues = inspectReply(reply, previousAssistant ? contentToText(previousAssistant.content) : null);
      if (issues.length) {
        sysLog.error(
          "error",
          `回复质量校验二次失败，丢弃本轮回复：${issues.map((i) => i.message).join("；")}`,
          { personaId: persona.id, botId, userId, modelId, stage: "quality_gate" },
          { reply, issues },
        );
        throw new Error(`reply_quality_rejected: ${issues.map((i) => i.code).join(",")}`);
      }
    }
  } catch (err) {
    const message = (err as Error)?.message ?? "";
    const aborted = message.includes("abort") || (err as Error)?.name === "AbortError";
    if (aborted) {
      opts.onEvent?.({ type: "stop", reason: "aborted" });
      throw new Error("aborted");
    }
    sysLog.error(
      "error",
      `生成回复失败：${message}`,
      { personaId: persona.id, botId, userId, modelId, stage: "generate_reply" },
      {
        error: message,
        name: (err as Error).name,
        stack: (err as Error).stack,
        aborted: false,
      },
    );
    opts.onEvent?.({ type: "stop", reason: message || "generate_failed" });
    // 失败不再以「走神了」的形式写进会话历史：直接抛出，由调用方静默跳过本轮
    throw err;
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

  opts.onEvent?.({ type: "done", reply });
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
    notifyUserReplied(bot.id, event.authorId);
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
    if (imageUrls.length || attachments.some(isQQImageAttachment)) {
      const { model } = resolveProviderForBot(batch.bot, batch.persona);
      const supportsVision = !!model?.supportsVision;
      const fallback = supportsVision ? null : resolveVisionFallbackModel(model?.id);
      if (!supportsVision && !fallback) {
        logger.info({ key, modelId: model?.id }, "image received but no vision model available");
        await this.send(batch, "【当前模型不支持读图，且未配置视觉副模型。请切换支持读图的模型，或在设置中选择视觉副模型】");
        this.batches.delete(key);
        return;
      }

      // 优先使用原始附件：其中保留了 content_type / filename，避免仅凭 URL 猜类型
      // （QQ 的媒体地址常常没有扩展名，压成 imageUrls 后再判断会把图片全部丢掉）。
      const imageAtts = attachments.some(isQQImageAttachment)
        ? attachments
        : imageUrls.map((url) => ({ url }));
      const { images, overflow } = pickQQImages(imageAtts);
      if (overflow > 0) {
        logger.info({ key, overflow }, "qq attachment count exceeds platform limit, extra images ignored");
      }
      if (!images.length) {
        logger.warn({ key }, "no readable image attachment detected");
        if (!merged.trim() && !fileContext) {
          await this.send(batch, "【没能识别到可读取的图片，请重试或换一张图片】");
          this.batches.delete(key);
          return;
        }
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

    // 首条气泡：首个句子（按换行/。！？切分）一生成完就下发，其余内容继续流式补齐。
    const startedAt = Date.now();
    let firstBubbleSent = false;
    let sentPrefix = 0;
    let bubbleChain: Promise<void> = Promise.resolve();

    const onEvent = (event: StreamEvent) => {
      if (event.type !== "delta" || firstBubbleSent) return;
      const end = firstSentenceEnd(event.text);
      if (end <= 0) return;
      const head = event.text.slice(0, end).trim();
      if (!head) return;
      firstBubbleSent = true;
      sentPrefix = end;
      const atMs = Date.now() - startedAt;
      bubbleChain = bubbleChain
        .then(() => this.sendSegments(batch, head, 1))
        .catch((err) => logger.warn({ key, err: (err as Error).message }, "send first bubble failed"));
      sysLog.info(
        "pipeline",
        `首条气泡下发（${atMs}ms，TTFT ${event.ttftMs ?? "?"}ms）`,
        { personaId: batch.persona.id, botId: batch.bot.id, userId: batch.userId, stage: "first_bubble", durationMs: atMs },
        { ttftMs: event.ttftMs ?? null, firstBubbleMs: atMs },
      );
    };

    try {
      const { reply, painting } = await generateReply(batch.persona, batch.userId, merged, batch.bot.id, {
        agentEnabled: batch.bot.agentEnabled,
        fileContext,
        imageContext,
        imageParts,
        hasFaces: faceCount > 0,
        signal: abort.signal,
        onEvent,
      });
      await bubbleChain;
      if (abort.signal.aborted) return;
      if (firstBubbleSent) {
        const rest = reply.slice(sentPrefix).trim();
        if (rest) await this.sendSegments(batch, rest, 2);
      } else {
        await this.send(batch, reply, painting);
      }
    } catch (err) {
      if ((err as Error).message !== "aborted") {
        logger.error({ key, err: (err as Error).message }, "pipeline flush failed");
      }
      // 流式中断/超时也要给下游一个明确的 stop，而不是让人一直等空白。
      if (firstBubbleSent) {
        sysLog.warn(
          "pipeline",
          "流式生成中断",
          { personaId: batch.persona.id, botId: batch.bot.id, userId: batch.userId, stage: "stop" },
          { error: (err as Error).message },
        );
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
    const event = batch.lastEvent;
    try {
      if (painting?.ok && (painting.imageUrl || painting.imageBase64)) {
        const client = new QQApiClient(batch.bot);
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
      await this.sendSegments(batch, reply, 1);
    } catch (err) {
      logger.error({ botId: batch.bot.id, err: (err as Error).message }, "send reply failed");
    }
  }

  /**
   * 按段下发文本。startSeq 用于流式场景：首条气泡先用 1，剩余内容从 2 继续，
   * 保证 QQ 被动回复的 msg_seq 连续且不超过平台上限。
   */
  private async sendSegments(batch: Batch, text: string, startSeq: number): Promise<void> {
    const event = batch.lastEvent;
    const settings = settingsService.get();
    const client = new QQApiClient(batch.bot);
    // 被动回复上限：单聊 4 次 / 群聊 5 次，超出部分合并进最后一条。
    const sceneCap = event.type === "c2c" ? 4 : event.type === "group" ? 5 : settings.splitMaxMessages;
    const totalCap = Math.max(1, Math.min(settings.splitMaxMessages, sceneCap));
    const slots = Math.max(1, totalCap - (startSeq - 1));
    const segments = settings.splitMessages ? splitReply(text, slots) : [text.trim()].filter(Boolean);
    let seq = startSeq;
    for (const segment of segments) {
      if (!segment.trim()) continue;
      await this.deliver(client, event, segment, seq);
      seq += 1;
      if (seq <= totalCap) await sleep(300);
    }
  }

  private async deliver(client: QQApiClient, event: QQMessageEvent, segment: string, msgSeq: number): Promise<void> {
    if (event.type === "c2c") {
      await client.sendC2C(event.authorId, segment, event.msgId, msgSeq);
    } else if (event.type === "group") {
      await client.sendGroup(event.groupOpenid!, segment, event.msgId, msgSeq);
    } else if (event.type === "guild") {
      await client.sendGuildChannel(event.channelId!, segment, event.msgId);
    } else if (event.type === "direct") {
      await client.sendDirect(event.guildId!, segment, event.msgId);
    }
  }

  /** 本地模拟：不经 QQ，直接返回角色回复，用于后台调试。 */
  async simulate(personaId: string, userId: string, text: string): Promise<GenerateResult> {
    const persona = personaRepo.find(personaId);
    if (!persona) throw new Error("角色不存在");
    return generateReply(persona, userId, text);
  }

  /** 本地模拟（流式）：逐块回调，供后台页面做打字机效果与 stop 提示。 */
  async simulateStream(
    personaId: string,
    userId: string,
    text: string,
    onEvent: StreamEventListener,
    signal?: AbortSignal,
  ): Promise<GenerateResult> {
    const persona = personaRepo.find(personaId);
    if (!persona) throw new Error("角色不存在");
    return generateReply(persona, userId, text, undefined, { onEvent, signal });
  }

  activeCount(): number {
    return this.batches.size;
  }
}

export const messagePipeline = new MessagePipeline();
